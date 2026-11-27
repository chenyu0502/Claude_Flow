/**
 * 呼叫 Gemini 並開啟「Google 搜尋」（grounding），讓模型上網查資料後回答。
 *
 * 與台股分析的 gemini.js 同一套做法（金鑰放標頭、模型備援鏈、整段時間預算），差別是：
 * - 開啟 tools: [{ google_search: {} }]，模型會自行搜尋網頁；
 * - 搜尋與 responseSchema 不一定能同時使用，因此請模型在文字中回覆 JSON，再由這裡解析；
 * - 一併回傳 groundingMetadata 中實際查過的網頁（sources），讓使用者能核對。
 */

import { createHash } from 'node:crypto';
import { fetchWithRetry } from './http.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** 預設模型，可用 GEMINI_MODEL 環境變數覆寫。與台股分析相同。 */
export const DEFAULT_MODEL = 'gemini-3.7-flash';

/** 免費方案每個模型各自計算額度；配額用盡、模型退役或逾時時依序換下一個。順序同台股分析。 */
export const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-flash-latest'];

/** 整段流程的時間預算，必須小於 vercel.json 的 maxDuration（60 秒）。 */
const TOTAL_BUDGET_MS = 52000;
const MIN_MODEL_ATTEMPT_MS = 8000;
/** 搜尋需要多輪網頁讀取，比純生成慢，單一模型給足時間。 */
const PER_MODEL_TIMEOUT_MS = 48000;

export const isLocationBlocked = (m) => /location is not supported/i.test(m);
const isModelUnavailable = (m) => /no longer available|not found|is not supported/i.test(m);
export const isQuotaExhausted = (m) => /429|quota|RESOURCE_EXHAUSTED/i.test(m);
const isTransient = (m) => /abort|timeout|逾時|50[023]|overload|UNAVAILABLE/i.test(m);
/** 這把金鑰（或這個方案）不能使用搜尋功能 */
export const isSearchNotAllowed = (m) => /google_search|grounding|search.*not (supported|enabled|available)|billing/i.test(m);

/* ---------- 額度用完時自動換模型 ---------- */

/** 備援鏈最多試幾個模型（每個配額用盡的回應約 1 秒，時間預算仍以 TOTAL_BUDGET_MS 為準） */
export const MAX_CHAIN = 10;
/** 模型清單快取多久；額度用完的模型多久內先不試（排到最後） */
const LIST_TTL_MS = 6 * 60 * 60 * 1000;
const EXHAUSTED_LONG_MS = 60 * 60 * 1000;
const EXHAUSTED_SHORT_MS = 2 * 60 * 1000;

/** 函式實例存活期間的記憶（以金鑰雜湊區分，不保存金鑰本身） */
const modelCache = new Map(); // keyId -> { at, models }
const exhausted = new Map(); // keyId -> Map(model -> until)
const keyId = (apiKey) => createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);

/** 測試用：清除記憶 */
export function resetModelMemory() {
  modelCache.clear();
  exhausted.clear();
}

/** 只留適合查詢的 Gemini 文字模型（排除語音、圖片、嵌入、即時等專用模型） */
export function usableModel(name) {
  return /^gemini-/.test(name) && /flash|pro/.test(name)
    && !/tts|image|live|audio|embed|vision|computer|robotics|native|thinking|exp(-|$)/.test(name);
}

/** 排序：版本新的先；同版本 flash → flash-lite → pro（pro 慢且免費額度少，放最後） */
export function rankModels(names) {
  const ver = (n) => Number((n.match(/^gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  const tier = (n) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2);
  return [...names].sort((a, b) => tier(a) === 2 || tier(b) === 2 ? tier(a) - tier(b) || ver(b) - ver(a)
    : ver(b) - ver(a) || tier(a) - tier(b) || a.length - b.length);
}

/** 列出這把金鑰可用的模型（快取；失敗時回空陣列，不影響查詢） */
async function discoverModels(apiKey, deadline) {
  const id = keyId(apiKey);
  const hit = modelCache.get(id);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.models;
  let models = [];
  try {
    const res = await fetchWithRetry(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey }, timeoutMs: 5000, retries: 0, deadline,
    });
    if (res.ok) {
      const json = await res.json();
      models = rankModels((json?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => String(m.name ?? '').replace(/^models\//, ''))
        .filter(usableModel));
    }
  } catch {
    /* 列不出來就只用預設的備援鏈 */
  }
  if (models.length) modelCache.set(id, { at: Date.now(), models });
  return models;
}

function markExhausted(apiKey, model, message) {
  const id = keyId(apiKey);
  if (!exhausted.has(id)) exhausted.set(id, new Map());
  // 每分鐘的限制很快恢復；每日額度用完則一小時內先不試
  const short = /per ?minute|PerMinute|retry in \d{1,2}(\.\d+)?s/i.test(message) && !/per ?day|PerDay/i.test(message);
  exhausted.get(id).set(model, Date.now() + (short ? EXHAUSTED_SHORT_MS : EXHAUSTED_LONG_MS));
}

/** 最近額度用完的模型移到最後（仍保留，萬一其他都不行還能再試） */
function deprioritize(apiKey, chain) {
  const m = exhausted.get(keyId(apiKey));
  if (!m) return chain;
  const now = Date.now();
  const tired = (x) => (m.get(x) ?? 0) > now;
  return [...chain.filter((x) => !tired(x)), ...chain.filter(tired)];
}

/**
 * 從模型的文字回覆取出 JSON 物件：優先取最後一個 ```json 區塊，否則取第一個 { 到最後一個 }。
 * @param {string} text
 * @returns {object}
 */
export function extractJsonObject(text) {
  const s = String(text ?? '');
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  const body = (fences.length ? fences[fences.length - 1][1] : s).trim();
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Gemini 回傳的內容沒有 JSON');
    try {
      return JSON.parse(body.slice(a, b + 1));
    } catch {
      throw new Error('Gemini 回傳的內容不是有效的 JSON');
    }
  }
}

/**
 * 取出模型實際查過的網頁（去除重複），最多 15 筆。
 * @param {object} candidate
 * @returns {{ title: string, uri: string }[]}
 */
export function groundingSources(candidate) {
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ title: String(c.web.title ?? '').slice(0, 120), uri });
    if (out.length >= 15) break;
  }
  return out;
}

async function callModel(target, { apiKey, systemInstruction, prompt, deadline, search = true, temperature, perModelTimeoutMs }) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(target)}:generateContent`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // search: false 時不上網（例如動畫製作寫劇本），直接要求模型回 JSON
      ...(search ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: search
        ? { temperature: temperature ?? 0.1 }
        : { temperature: temperature ?? 0.9, responseMimeType: 'application/json' },
    }),
    timeoutMs: perModelTimeoutMs ?? PER_MODEL_TIMEOUT_MS,
    retries: 0, // 備援鏈本身就是重試
    deadline,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text)?.error?.message ?? detail;
    } catch {
      /* 保留原始文字 */
    }
    throw new Error(`Gemini 回應 ${res.status}：${detail}`);
  }
  const json = JSON.parse(text);
  const candidate = json?.candidates?.[0];
  if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new Error(`Gemini 未正常結束：${candidate.finishReason}`);
  }
  const payload = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!payload) throw new Error('Gemini 回傳空內容');
  return { data: extractJsonObject(payload), sources: groundingSources(candidate) };
}

/**
 * 開啟 Google 搜尋，請模型查詢後以 JSON 回覆。
 * @param {{ apiKey: string, model?: string, models?: string[], systemInstruction: string, prompt: string, search?: boolean, temperature?: number,
 *           perModelTimeoutMs?: number, deadline?: number }} params
 *   search 預設 true（開啟 Google 搜尋）；false 時不上網、要求模型直接回 JSON。
 *   models：自訂備援順序（取代預設的 DEFAULT_MODEL + FALLBACK_MODELS，model 仍排第一）。
 *   perModelTimeoutMs：單一模型最多等多久；不上網時回得快，縮短才能在模型卡住時還有時間換下一個。
 *   discover：預設 true；未指定 models 時，先列出這把金鑰可用的模型接在預設備援鏈後面。
 *   deadline：呼叫端自己的整段截止時間（Date.now() 基準），例如同一個請求裡要重試時共用；會再被 TOTAL_BUDGET_MS 夾住。
 * @returns {Promise<{ data: object, sources: {title:string, uri:string}[], model: string, fallbackFrom?: string }>}
 *   fallbackFrom：前面的模型失敗（例如額度用完）而改用其他模型時，記下原本的第一個模型。
 */
export async function searchJson(params) {
  const custom = !!params.models?.length;
  const base = custom ? params.models : [DEFAULT_MODEL, ...FALLBACK_MODELS];
  const primary = params.model || base[0];
  const deadline = Math.min(Date.now() + TOTAL_BUDGET_MS, params.deadline ?? Infinity);
  let chain = [primary, ...base.filter((m) => m !== primary)];
  // 預設備援鏈之後，再接上這把金鑰實際可用的其他模型（新模型上線、舊模型退役都能跟上）
  if (!custom && params.discover !== false) {
    const extra = await discoverModels(params.apiKey, deadline);
    chain = [...chain, ...extra.filter((m) => !chain.includes(m))];
  }
  chain = deprioritize(params.apiKey, chain).slice(0, MAX_CHAIN);
  let lastError;
  const tried = [];
  for (const model of chain) {
    if (deadline - Date.now() <= MIN_MODEL_ATTEMPT_MS) break;
    tried.push(model);
    try {
      return { ...(await callModel(model, { ...params, deadline })), model, ...(tried.length > 1 ? { fallbackFrom: tried[0] } : {}) };
    } catch (err) {
      lastError = err;
      if (isLocationBlocked(err.message)) throw err;
      if (isQuotaExhausted(err.message)) markExhausted(params.apiKey, model, err.message);
      const worthRetrying =
        isModelUnavailable(err.message) || isQuotaExhausted(err.message) || isTransient(err.message);
      if (!worthRetrying) throw err;
    }
  }
  const err = lastError ?? new Error('已逾時，來不及送出請求');
  err.triedModels = tried;
  throw err;
}
