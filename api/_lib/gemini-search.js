/**
 * 呼叫 Gemini 並開啟「Google 搜尋」（grounding），讓模型上網查資料後回答。
 *
 * 與台股分析的 gemini.js 同一套做法（金鑰放標頭、模型備援鏈、整段時間預算），差別是：
 * - 開啟 tools: [{ google_search: {} }]，模型會自行搜尋網頁；
 * - 搜尋與 responseSchema 不一定能同時使用，因此請模型在文字中回覆 JSON，再由這裡解析；
 * - 一併回傳 groundingMetadata 中實際查過的網頁（sources），讓使用者能核對。
 */

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

async function callModel(target, { apiKey, systemInstruction, prompt, deadline, search = true, temperature }) {
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
    timeoutMs: PER_MODEL_TIMEOUT_MS,
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
 * @param {{ apiKey: string, model?: string, systemInstruction: string, prompt: string, search?: boolean, temperature?: number }} params
 *   search 預設 true（開啟 Google 搜尋）；false 時不上網、要求模型直接回 JSON。
 * @returns {Promise<{ data: object, sources: {title:string, uri:string}[], model: string }>}
 */
export async function searchJson(params) {
  const primary = params.model || DEFAULT_MODEL;
  const chain = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastError;
  for (const model of chain) {
    if (deadline - Date.now() <= MIN_MODEL_ATTEMPT_MS) break;
    try {
      return { ...(await callModel(model, { ...params, deadline })), model };
    } catch (err) {
      lastError = err;
      if (isLocationBlocked(err.message)) throw err;
      const worthRetrying =
        isModelUnavailable(err.message) || isQuotaExhausted(err.message) || isTransient(err.message);
      if (!worthRetrying) throw err;
    }
  }
  throw lastError ?? new Error('已逾時，來不及送出請求');
}
