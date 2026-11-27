/**
 * 旅遊規劃（/travel/）的餐廳查詢：/api/travel/restaurants
 *
 * 由後端呼叫 Gemini 並開啟 Google 搜尋，依地區或景點、日期與時間、哪一餐、料理、預算、
 * 飲食限制與旅伴，查詢附近的餐廳與訂位方式。網站不代為訂位；
 * 金鑰與錯誤說明沿用航班查詢（flights.js），評比格式沿用飯店查詢（hotels.js）。
 */

import { describeError, modelNote, resolveKey } from './flights.js';
import { searchJson } from './gemini-search.js';

const withModel = (r, result) => ({ ...r, note: modelNote(r.note, result) });
import { normalizeRatings } from './hotels.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
export const MAX_RESTAURANTS = 10;
export const MEALS = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
export const RESERVATION = ['required', 'recommended', 'walkin', 'not_accepted'];

const SYSTEM_INSTRUCTION = `你是熟悉當地餐飲的旅遊顧問。使用 Google 搜尋查詢真實存在、目前營業中的餐廳，只根據搜尋到的網頁回答。
規則：
1. 不編造餐廳、價格、評分、營業時間、訂位方式或網址；查不到的欄位留空或填 0。
2. 一定要遵守客人的飲食限制，無法配合的餐廳不要列入；能部分配合的在 dietNote 說明。
3. 價格以當地貨幣填寫並註明幣別；全體估算換算新台幣並寫出匯率。
4. 每家餐廳都附上實際查到資料的網頁網址（source）。
5. 說明文字使用台灣繁體中文。`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const area = str(input?.area, 60);
  const date = str(input?.date, 10);
  const time = str(input?.time, 5);
  const meal = str(input?.meal, 4);
  if (!area) return { error: '請提供地區或景點' };
  if (date && !DATE_RE.test(date)) return { error: '日期格式應為 YYYY-MM-DD' };
  if (time && !TIME_RE.test(time)) return { error: '時間格式應為 HH:MM' };
  if (meal && !MEALS.includes(meal)) return { error: `用餐時段應為${MEALS.join('、')}其中之一` };
  const adults = Math.round(Number(input?.adults) || 0);
  const seniors = Math.round(Number(input?.seniors) || 0);
  const kids = Math.round(Number(input?.kids) || 0);
  if ([adults, seniors, kids].some((n) => n < 0) || adults + seniors + kids < 1 || adults + seniors + kids > 20) {
    return { error: '用餐人數應為 1～20 人' };
  }
  return {
    value: {
      area, date, time, meal, city: str(input?.city, 40), cuisine: str(input?.cuisine, 40),
      budgetPerPersonTwd: Math.max(0, Math.round(Number(input?.budgetPerPersonTwd) || 0)),
      diet: str(input?.diet, 100), notes: str(input?.notes, 200),
      adults, seniors, kids, kidAges: str(input?.kidAges, 30),
    },
  };
}

export function buildPrompt(v) {
  const who = [v.adults && `成人 ${v.adults}`, v.seniors && `長輩（65 歲以上）${v.seniors}`,
    v.kids && `兒童 ${v.kids}${v.kidAges ? `（${v.kidAges} 歲）` : ''}`].filter(Boolean).join('、');
  return `請上網搜尋「${v.city ? v.city + ' ' : ''}${v.area}」附近適合的餐廳，列出 5～8 家讓我比較。

- 日期與時間：${v.date || '未定'} ${v.time || ''}${v.meal ? `（${v.meal}）` : ''}
- 用餐人數：${who}
- 想吃的料理：${v.cuisine || '不限，以當地特色為主'}
- 每人預算（新台幣）：${v.budgetPerPersonTwd || '不限'}
- 飲食限制：${v.diet || '無'}
- 其他需求：${v.notes || '無'}

規則：
1. 以「${v.area}」為中心，步行 15 分鐘內為主；walkMin 是步行分鐘數，access 寫最近的車站或地標。
2. 涵蓋不同價位與料理；有長輩或兒童時，優先列出有座位、不需久候、提供兒童餐或座椅的店，寫在 familyNote。
3. priceMin、priceMax 是每人價位（當地貨幣，currency 為幣別代碼）；partyEstimateTwd 是全體估算（新台幣整數），fxNote 寫匯率；查不到填 0。
4. ratings 列出網路評比，每個網站一筆（優先 Google、Tabelog、TripAdvisor，最多 3 個）：site、score 原始分數、outOf 滿分（5 或 10）、reviews 評論數。只填實際查到的。
5. reservation：必須訂位填 "required"；建議訂位填 "recommended"；不需訂位、現場排隊填 "walkin"；不接受訂位填 "not_accepted"。reservationHow 寫訂位方式（官網、Tabelog、TableCheck、電話等）；bookingWindow 寫何時開放訂位（例如「1 個月前開放」），不需要就留空。
6. openingHours、closedDays；若查詢日期當天公休或${v.time ? ` ${v.time} 不在營業時間內` : '時段不營業'}，在 cautions 明確寫出。
7. signature 寫招牌菜；dietNote 寫能否配合飲食限制；tips、cautions；channels 是訂位或資訊管道（最多 3 個，附網址）；source 是主要資料網址；nameLocal 寫當地語言或英文正式名稱。

最後只回覆一個 \`\`\`json 程式碼區塊，格式：
{"restaurants":[{"name":"","nameLocal":"","cuisine":"","area":"","access":"","walkMin":0,"priceMin":0,"priceMax":0,"currency":"JPY","partyEstimateTwd":0,"fxNote":"","ratings":[{"site":"Google","score":0,"outOf":5,"reviews":0}],"reservation":"recommended","reservationHow":"","bookingWindow":"","openingHours":"","closedDays":"","signature":"","familyNote":"","dietNote":"","tips":"","cautions":"","channels":[{"name":"Tabelog","url":"https://..."}],"source":"https://..."}],"note":""}`;
}

/** 檢查模型回傳的單一餐廳；沒有名稱的整筆捨棄。 */
function normalizeRestaurant(x) {
  const name = String(x?.name ?? '').trim().slice(0, 80);
  if (!name) return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const int = (v, max) => { const n = Math.round(Number(v) || 0); return n > 0 && n <= max ? n : null; };
  const currency = String(x?.currency ?? '').trim().toUpperCase();
  let priceMin = int(x?.priceMin, 10000000);
  let priceMax = int(x?.priceMax, 10000000);
  if (priceMin && priceMax && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  const source = String(x?.source ?? '');
  return {
    name,
    nameLocal: str(x?.nameLocal, 100).trim(),
    cuisine: str(x?.cuisine, 30),
    area: str(x?.area, 40),
    access: str(x?.access, 80),
    walkMin: int(x?.walkMin, 120),
    priceMin, priceMax,
    currency: /^[A-Z]{3}$/.test(currency) && (priceMin || priceMax) ? currency : '',
    partyEstimateTwd: int(x?.partyEstimateTwd, 1000000),
    fxNote: str(x?.fxNote, 40),
    ratings: normalizeRatings(x),
    reservation: RESERVATION.includes(x?.reservation) ? x.reservation : 'walkin',
    reservationHow: str(x?.reservationHow, 80),
    bookingWindow: str(x?.bookingWindow, 80),
    openingHours: str(x?.openingHours, 80),
    closedDays: str(x?.closedDays, 60),
    signature: str(x?.signature, 80),
    familyNote: str(x?.familyNote, 120),
    dietNote: str(x?.dietNote, 120),
    tips: str(x?.tips, 160),
    cautions: str(x?.cautions, 160),
    channels: (Array.isArray(x?.channels) ? x.channels : [])
      .map((c) => ({ name: str(c?.name, 20).trim(), url: String(c?.url ?? '') }))
      .filter((c) => c.name && URL_RE.test(c.url)).slice(0, 3),
    source: URL_RE.test(source) ? source : '',
  };
}

export function normalizeResult(data) {
  const list = (Array.isArray(data?.restaurants) ? data.restaurants : []).map(normalizeRestaurant).filter(Boolean);
  return { restaurants: list.slice(0, MAX_RESTAURANTS), note: String(data?.note ?? '').slice(0, 300) };
}

/**
 * @param {object} input { area, city, date, time, meal, cuisine, budgetPerPersonTwd, diet, notes, adults, seniors, kids, kidAges }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson, now?: () => Date }} [deps] 測試用
 */
export async function restaurantsHandler(input, env = {}, ctx = {}, deps = {}) {
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

  const v = parsed.value;
  return {
    status: 200,
    noStore: true,
    body: {
      available: true,
      area: v.area, date: v.date, time: v.time, meal: v.meal,
      ...withModel(normalizeResult(result.data), result),
      sources: result.sources ?? [],
      model: result.model,
      ...(result.fallbackFrom ? { fallbackFrom: result.fallbackFrom } : {}),
      fetchedAt: now().toISOString().slice(0, 10),
    },
  };
}
