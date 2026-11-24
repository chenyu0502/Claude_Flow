/**
 * 旅遊規劃（/travel/）的飯店查詢：/api/travel/hotels
 *
 * 由後端呼叫 Gemini 並開啟 Google 搜尋，查指定地區或景點附近、適合這組旅伴的飯店，
 * 整理成固定格式回傳給網頁。金鑰與錯誤說明沿用航班查詢（flights.js）。
 */

import { describeError, resolveKey } from './flights.js';
import { searchJson } from './gemini-search.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HOTELS = 12;
const DAY_MS = 86400000;

const SYSTEM_INSTRUCTION = `你是旅遊住宿顧問。使用 Google 搜尋查詢真實存在、目前營業中的飯店，只根據搜尋到的網頁回答。
規則：
1. 不編造飯店、價格、評分或交通時間；查不到的欄位留空或填 0。
2. 依旅伴組成判斷需要幾間、什麼房型，價格以「全體每晚」計算。
3. 每間飯店都附上實際查到資料的網頁網址（source）。
4. 說明文字使用台灣繁體中文。`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const area = str(input?.area, 60);
  const city = str(input?.city, 40);
  const checkIn = str(input?.checkIn, 10);
  const checkOut = str(input?.checkOut, 10);
  const adults = Math.round(Number(input?.adults) || 0);
  const seniors = Math.round(Number(input?.seniors) || 0);
  const kids = Math.round(Number(input?.kids) || 0);
  if (!area) return { error: '請提供地區或景點' };
  if (checkIn && !DATE_RE.test(checkIn)) return { error: '入住日期格式應為 YYYY-MM-DD' };
  if (checkOut && !DATE_RE.test(checkOut)) return { error: '退房日期格式應為 YYYY-MM-DD' };
  if (checkIn && checkOut && checkOut <= checkIn) return { error: '退房日期必須晚於入住日期' };
  const people = adults + seniors + kids;
  if (people < 1 || people > 20 || [adults, seniors, kids].some((n) => n < 0)) return { error: '旅客人數應為 1～20 人' };
  return {
    value: {
      area, city, checkIn, checkOut, adults, seniors, kids,
      kidAges: str(input?.kidAges, 30),
      level: str(input?.level, 30),
      budgetPerNight: Math.max(0, Math.round(Number(input?.budgetPerNight) || 0)),
      notes: str(input?.notes, 200),
    },
  };
}

export const nightsOf = (checkIn, checkOut) =>
  checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS) : 0;

export function buildPrompt(v) {
  const who = [v.adults && `成人 ${v.adults}`, v.seniors && `長輩（65 歲以上）${v.seniors}`,
    v.kids && `兒童 ${v.kids}${v.kidAges ? `（${v.kidAges} 歲）` : ''}`].filter(Boolean).join('、');
  const nights = nightsOf(v.checkIn, v.checkOut);
  return `請上網搜尋「${v.city ? v.city + ' ' : ''}${v.area}」附近適合的飯店，列出 6～10 間讓我比較。

- 入住：${v.checkIn || '未定'}；退房：${v.checkOut || '未定'}${nights ? `（${nights} 晚）` : ''}
- 旅客：${who}
- 住宿等級：${v.level || '不限'}
- 每晚預算（全體，新台幣）：${v.budgetPerNight || '不限'}
- 其他需求：${v.notes || '無'}

規則：
1. 以「${v.area}」為中心，步行或搭車 20 分鐘內為主；walkMin 是步行到該地點或最近車站的分鐘數，access 寫最近的車站與步行時間。
2. 涵蓋不同價位；有長輩或兒童時，優先列出有家庭房、電梯、離車站近的飯店。
3. pricePerNightTwd 是這組旅伴「全體每晚」的參考價（新台幣整數，含稅），以這個日期或最接近日期在訂房網站、官網看到的價格為準；查不到填 0，不要估算。rooms 是需要幾間房，roomNote 寫房型（例如「家庭房 4 人 1 間」「雙人房 2 間」）。
4. rating 是訂房網站或 Google 的評分，照原本的分數填寫，並在 ratingNote 寫明來源與滿分（例如「Booking.com 10 分制」「Google 5 分制」），查不到填 0。
5. highlights 寫 1～2 句優點；cautions 寫需要注意的地方（例如房間小、無電梯、需另付清潔費），沒有就留空。
6. nameLocal 寫飯店的當地語言或英文正式名稱，方便地圖與訂房網站搜尋。

最後只回覆一個 \`\`\`json 程式碼區塊，格式：
{"hotels":[{"name":"","nameLocal":"","area":"","access":"","walkMin":0,"pricePerNightTwd":0,"rooms":1,"roomNote":"","rating":0,"ratingNote":"","highlights":"","cautions":"","source":"https://..."}],"note":""}`;
}

/** 檢查模型回傳的單一飯店，格式不對的欄位清空，沒有名稱的整筆捨棄。 */
function normalizeHotel(x) {
  const name = String(x?.name ?? '').trim().slice(0, 80);
  if (!name) return null;
  const int = (v, max) => { const n = Math.round(Number(v) || 0); return n > 0 && n <= max ? n : null; };
  const num1 = (v, max) => { const n = Math.round((Number(v) || 0) * 10) / 10; return n > 0 && n <= max ? n : null; };
  const source = String(x?.source ?? '');
  return {
    name,
    nameLocal: String(x?.nameLocal ?? '').trim().slice(0, 100),
    area: String(x?.area ?? '').slice(0, 40),
    access: String(x?.access ?? '').slice(0, 80),
    walkMin: int(x?.walkMin, 120),
    pricePerNightTwd: int(x?.pricePerNightTwd, 500000),
    rooms: int(x?.rooms, 10) ?? 1,
    roomNote: String(x?.roomNote ?? '').slice(0, 60),
    rating: num1(x?.rating, 10),
    ratingNote: String(x?.ratingNote ?? '').slice(0, 40),
    highlights: String(x?.highlights ?? '').slice(0, 160),
    cautions: String(x?.cautions ?? '').slice(0, 160),
    source: /^https?:\/\/[^\s"'<>]+$/i.test(source) ? source : '',
  };
}

export function normalizeResult(data) {
  const hotels = (Array.isArray(data?.hotels) ? data.hotels : []).map(normalizeHotel).filter(Boolean).slice(0, MAX_HOTELS);
  return { hotels, note: String(data?.note ?? '').slice(0, 300) };
}

/**
 * @param {object} input { area, city, checkIn, checkOut, adults, seniors, kids, kidAges, level, budgetPerNight, notes }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson, now?: () => Date }} [deps] 測試用
 */
export async function hotelsHandler(input, env = {}, ctx = {}, deps = {}) {
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
      area: v.area,
      checkIn: v.checkIn,
      checkOut: v.checkOut,
      ...normalizeResult(result.data),
      sources: result.sources ?? [],
      model: result.model,
      fetchedAt: now().toISOString().slice(0, 10),
    },
  };
}
