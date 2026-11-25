/**
 * 旅遊規劃（/travel/）的金鑰檢查：/api/travel/key-check
 *
 * 使用者在網頁輸入自己的 Gemini 金鑰後，按「測試金鑰」會呼叫這裡。
 * 只列出這把金鑰能用的模型（不做搜尋、不產生內容），確認金鑰有效且有 Gemini API 權限，不消耗查詢額度。
 * 金鑰由請求標頭 X-Gemini-Key 帶入（adapter 已檢查格式），只轉給 Google，不記錄。
 */

import { DEFAULT_MODEL, isLocationBlocked } from './gemini-search.js';
import { fetchWithRetry } from './http.js';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';

/**
 * @param {object} _input 未使用
 * @param {Record<string,string|undefined>} _env 未使用
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ fetchImpl?: typeof fetchWithRetry }} [deps] 測試用
 */
export async function keyCheckHandler(_input, _env = {}, ctx = {}, deps = {}) {
  const { fetchImpl = fetchWithRetry } = deps;
  const fail = (reason) => ({ status: 200, noStore: true, body: { ok: false, reason } });
  if (!ctx.geminiKey) return fail('金鑰格式不正確：應為 20～200 個英數字、底線或連字號，通常以 AIza 開頭。');

  let res;
  try {
    res = await fetchImpl(MODELS_URL, { headers: { 'x-goog-api-key': ctx.geminiKey }, timeoutMs: 15000, retries: 0 });
  } catch {
    return fail('暫時連不上 Google，請稍後再試。');
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON 回應 */
  }
  if (!res.ok) {
    const msg = String(json?.error?.message ?? '');
    if (isLocationBlocked(msg)) return fail('Gemini 不服務伺服器所在的地區，請管理員確認 Vercel 函式的區域設定。');
    if (res.status === 400 || /api key not valid|API_KEY_INVALID/i.test(msg)) return fail('金鑰無效，請確認是否完整複製。');
    if (res.status === 403) return fail('這把金鑰沒有 Gemini API 的權限，請到 Google AI Studio 確認金鑰所屬專案已啟用 Gemini API。');
    if (res.status === 429) return fail('這把金鑰目前的用量已達上限，請稍後再試。');
    return fail(`Google 回應錯誤（HTTP ${res.status}），請稍後再試。`);
  }

  const models = (json?.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((n) => n.startsWith('gemini'));
  if (!models.length) return fail('這把金鑰看不到任何 Gemini 模型，請確認金鑰所屬專案已啟用 Gemini API。');
  return {
    status: 200,
    noStore: true,
    body: { ok: true, models: models.length, hasDefault: models.includes(DEFAULT_MODEL) },
  };
}
