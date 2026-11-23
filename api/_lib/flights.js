/**
 * 旅遊規劃（/travel/）的航班查詢：/api/travel/flights
 *
 * 由後端呼叫 Gemini 並開啟 Google 搜尋，查指定航空公司在出發日、回程日的直飛航班，
 * 整理成固定格式回傳給網頁。金鑰只在伺服器端：
 * - 使用者在請求帶自己的 Gemini 金鑰（X-Gemini-Key）時優先使用；
 * - 否則使用伺服器的 GEMINI_API_KEY（免費額度，所有登入的 Claude Flow 使用者共用）。
 */

import { isLocationBlocked, isQuotaExhausted, isSearchNotAllowed, searchJson } from './gemini-search.js';

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const FLIGHT_NO_RE = /^[A-Z0-9]{2}\s?\d{1,4}[A-Z]?$/;
const MAX_FLIGHTS = 20;

const SYSTEM_INSTRUCTION = `你是航班資料查核員。使用 Google 搜尋查詢真實的定期航班資料，只根據搜尋到的網頁回答。
規則：
1. 不編造班號、時刻或航線；查不到就回傳空陣列並說明。
2. 只列指定航空公司自己執飛的直飛班次，不列其他航空公司執飛的共用班號，不列轉機航班。
3. 時間一律是當地時間（HH:MM）。
4. 每一班都附上實際查到的網頁網址（source）。
5. 說明文字使用台灣繁體中文。`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const airline = String(input?.airline ?? '').trim();
  const from = String(input?.from ?? '').trim().toUpperCase();
  const to = String(input?.to ?? '').trim().toUpperCase();
  const outDate = String(input?.outDate ?? '').trim();
  const backDate = String(input?.backDate ?? '').trim();
  if (!airline || airline.length > 30) return { error: '請提供航空公司名稱（30 字以內）' };
  if (!IATA_RE.test(from) || !IATA_RE.test(to) || from === to) return { error: '出發地與目的地必須是不同的三碼機場代碼' };
  if (outDate && !DATE_RE.test(outDate)) return { error: '出發日期格式應為 YYYY-MM-DD' };
  if (backDate && !DATE_RE.test(backDate)) return { error: '回程日期格式應為 YYYY-MM-DD' };
  return { value: { airline, from, to, outDate, backDate } };
}

export function buildPrompt({ airline, from, to, outDate, backDate }) {
  return `請上網搜尋「${airline}」在以下日期的直飛定期航班：
- 去程：${outDate || '日期未定（列出目前班表）'}，${from} → ${to}
- 回程：${backDate || '日期未定（列出目前班表）'}，${to} → ${from}

優先參考航空公司官網時刻表、機場航班時刻表，其次是 FlyTeam、Trip.com、FlightConnections、Airportia 等航班動態或航線頁面。
若這兩天的正式班表還沒公布，用最接近日期的班表推估，並在該班的 note 寫明依據哪一天或哪個航季。
查不到這家航空在此航線有直飛航班時，outbound、inbound 回傳空陣列，在 note 說明。

最後只回覆一個 \`\`\`json 程式碼區塊，格式如下（durationMin 為飛行分鐘數，days 寫每週飛哪幾天，不確定留空）：
{"outbound":[{"flightNo":"","depart":"HH:MM","arrive":"HH:MM","durationMin":0,"days":"","note":"","source":"https://..."}],"inbound":[{"flightNo":"","depart":"HH:MM","arrive":"HH:MM","durationMin":0,"days":"","note":"","source":"https://..."}],"note":""}`;
}

/** 檢查模型回傳的單一航班，格式不對的欄位清空，班號不合理的整筆捨棄。 */
function normalizeFlight(x) {
  const flightNo = String(x?.flightNo ?? '').trim().toUpperCase();
  if (!FLIGHT_NO_RE.test(flightNo)) return null;
  const source = String(x?.source ?? '');
  const time = (t) => (TIME_RE.test(t ?? '') ? t.padStart(5, '0') : ''); // 9:45 → 09:45，排序才正確
  return {
    flightNo: flightNo.replace(/\s+/g, ''),
    depart: time(x?.depart),
    arrive: time(x?.arrive),
    durationMin: Math.max(0, Math.round(Number(x?.durationMin) || 0)) || null,
    days: String(x?.days ?? '').slice(0, 30),
    note: String(x?.note ?? '').slice(0, 160),
    source: /^https?:\/\/[^\s"'<>]+$/i.test(source) ? source : '',
  };
}

export function normalizeResult(data) {
  const list = (arr) =>
    (Array.isArray(arr) ? arr : []).map(normalizeFlight).filter(Boolean).slice(0, MAX_FLIGHTS)
      .sort((a, b) => a.depart.localeCompare(b.depart));
  return {
    outbound: list(data?.outbound),
    inbound: list(data?.inbound),
    note: String(data?.note ?? '').slice(0, 300),
  };
}

/** 決定這次用哪把金鑰：使用者自己的優先，否則用伺服器的。 */
export function resolveKey(env, ctx) {
  if (ctx?.geminiKey) return { apiKey: ctx.geminiKey, source: 'user' };
  if (env?.GEMINI_API_KEY) return { apiKey: env.GEMINI_API_KEY, source: 'server' };
  return null;
}

/** 把上游錯誤翻譯成使用者看得懂、知道下一步怎麼做的說明。 */
export function describeError(err, keySource) {
  const m = String(err?.message ?? '');
  const whose = keySource === 'user' ? '你的 Gemini 金鑰' : '網站的 Gemini 金鑰';
  if (isLocationBlocked(m)) return 'Gemini 不服務伺服器所在的地區，請管理員確認 Vercel 函式的區域設定。';
  if (isQuotaExhausted(m)) return `${whose}今日的免費查詢額度已用完，請明天再試，或按「改用 claude.ai 查詢」。`;
  if (/api key not valid|API_KEY_INVALID|permission|401|403/i.test(m)) return `${whose}無效或沒有權限，請管理員確認設定。`;
  if (isSearchNotAllowed(m)) return `${whose}的方案不能使用 Google 搜尋，請按「改用 claude.ai 查詢」。`;
  if (/JSON/i.test(m)) return '查詢結果格式不完整，請再試一次。';
  if (/abort|timeout|逾時/i.test(m)) return '查詢逾時（超過約 50 秒），請再試一次。';
  return '查詢失敗，請稍後再試，或按「改用 claude.ai 查詢」。';
}

/**
 * @param {object} input { airline, from, to, outDate, backDate }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson, now?: () => Date }} [deps] 測試用
 */
export async function flightsHandler(input, env = {}, ctx = {}, deps = {}) {
  const { search = searchJson, now = () => new Date() } = deps;
  const parsed = parseInput(input);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  const key = resolveKey(env, ctx);
  if (!key) {
    return { status: 200, noStore: true, body: { available: false, reason: '網站尚未設定 Gemini 金鑰，請按「改用 claude.ai 查詢」。' } };
  }

  let result;
  try {
    result = await search({
      apiKey: key.apiKey,
      model: env.GEMINI_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: buildPrompt(parsed.value),
    });
  } catch (err) {
    return { status: 200, noStore: true, body: { available: false, reason: describeError(err, key.source) } };
  }

  return {
    status: 200,
    noStore: true,
    body: {
      available: true,
      airline: parsed.value.airline,
      ...normalizeResult(result.data),
      sources: result.sources ?? [],
      model: result.model,
      fetchedAt: now().toISOString().slice(0, 10),
    },
  };
}
