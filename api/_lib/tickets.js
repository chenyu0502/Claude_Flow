/**
 * 旅遊規劃（/travel/）的景點門票查詢：/api/travel/tickets
 *
 * 由後端呼叫 Gemini 並開啟 Google 搜尋，一次查詢最多 8 個景點的門票：
 * 是否需要預約、票種與價格、這組旅伴的合計、營業時間與公休日、開賣時間、購買管道。
 * 網站不代售門票；金鑰與錯誤說明沿用航班查詢（flights.js）。
 */

import { describeError, resolveKey } from './flights.js';
import { searchJson } from './gemini-search.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
export const MAX_ATTRACTIONS = 8;
export const STATUSES = ['required', 'recommended', 'onsite', 'free'];

const SYSTEM_INSTRUCTION = `你是旅遊行程顧問，負責查核景點門票。使用 Google 搜尋查詢景點官網與購票平台的最新資訊，只根據搜尋到的網頁回答。
規則：
1. 不編造價格、營業時間、開賣規則或網址；查不到的欄位留空或填 0。
2. 價格以當地貨幣原價填寫，並註明幣別。
3. 每個景點都附上實際查到資料的網頁網址（source）。
4. 說明文字使用台灣繁體中文。`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const raw = Array.isArray(input?.attractions) ? input.attractions : [];
  const attractions = [];
  const seen = new Set();
  for (const a of raw) {
    const name = str(a?.name, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const date = str(a?.date, 10);
    attractions.push({ name, date: DATE_RE.test(date) ? date : '', place: str(a?.place, 80) });
  }
  if (!attractions.length) return { error: '請提供至少一個景點' };
  if (attractions.length > MAX_ATTRACTIONS) return { error: `一次最多查詢 ${MAX_ATTRACTIONS} 個景點` };
  const adults = Math.round(Number(input?.adults) || 0);
  const seniors = Math.round(Number(input?.seniors) || 0);
  const kids = Math.round(Number(input?.kids) || 0);
  if ([adults, seniors, kids].some((n) => n < 0) || adults + seniors + kids < 1 || adults + seniors + kids > 20) {
    return { error: '旅客人數應為 1～20 人' };
  }
  return { value: { attractions, city: str(input?.city, 40), adults, seniors, kids, kidAges: str(input?.kidAges, 30) } };
}

export function buildPrompt(v) {
  const who = [v.adults && `成人 ${v.adults}`, v.seniors && `長輩（65 歲以上）${v.seniors}`,
    v.kids && `兒童 ${v.kids}${v.kidAges ? `（${v.kidAges} 歲）` : ''}`].filter(Boolean).join('、');
  const list = v.attractions.map((a, i) => `${i + 1}. ${a.name}${a.place ? `（${a.place}）` : ''}：${a.date || '日期未定'}`).join('\n');
  return `請上網查詢以下${v.city ? `${v.city}的` : ''}景點門票資訊，旅客為${who}：
${list}

每個景點回傳一筆，name 照上面的名稱填寫：
1. status：必須事先預約或購票才能入場填 "required"；可現場購買但旺季常售完、建議先買填 "recommended"；現場購票即可填 "onsite"；免費參觀填 "free"。
2. ticketTypes：各票種與價格（例如成人、兒童、65 歲以上），price 為當地貨幣原價數字，currency 為幣別代碼（例如 JPY）。免費景點給空陣列。
3. partyTotalTwd：依上面的旅客組成計算全體門票合計，換算成新台幣整數；fxNote 寫使用的匯率（例如「1 JPY ≈ 0.21 TWD」）。查不到價格填 0。
4. openingHours 寫營業時間；closedDays 寫公休日；若該景點在查詢日期當天公休或有特殊休館，在 cautions 明確寫出。
5. timeSlot：需要預約入場時段填 true。bookingWindow 寫開賣規則（例如「入場日前 1 個月的 10:00 開賣」「入場前 2 天截止」），不需要預約就留空。
6. channels：可以購票的管道，最多 3 個（官網、Klook、KKday 等），附實際網址。
7. tips 寫 1～2 句對這組旅伴實用的建議；cautions 寫需要注意的事；source 是查到主要資料的網址。
8. 查不到這個景點時，status 填 "onsite"，其餘欄位留空，在 cautions 寫「查不到資料，請確認名稱」。

最後只回覆一個 \`\`\`json 程式碼區塊，格式：
{"attractions":[{"name":"","nameLocal":"","status":"required","ticketTypes":[{"label":"成人","price":0,"currency":"JPY"}],"partyTotalTwd":0,"fxNote":"","openingHours":"","closedDays":"","timeSlot":false,"bookingWindow":"","channels":[{"name":"官網","url":"https://..."}],"tips":"","cautions":"","source":"https://..."}],"note":""}`;
}

/** 檢查模型回傳的單一景點；沒有名稱的整筆捨棄。 */
function normalizeAttraction(x) {
  const name = String(x?.name ?? '').trim().slice(0, 60);
  if (!name) return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const status = STATUSES.includes(x?.status) ? x.status : 'onsite';
  const ticketTypes = (Array.isArray(x?.ticketTypes) ? x.ticketTypes : [])
    .map((t) => {
      const price = Math.round((Number(t?.price) || 0) * 100) / 100;
      const currency = String(t?.currency ?? '').trim().toUpperCase();
      const label = str(t?.label, 20).trim();
      return label && price >= 0 && price < 10000000 && /^[A-Z]{3}$/.test(currency) ? { label, price, currency } : null;
    })
    .filter(Boolean).slice(0, 6);
  const total = Math.round(Number(x?.partyTotalTwd) || 0);
  const channels = (Array.isArray(x?.channels) ? x.channels : [])
    .map((c) => ({ name: str(c?.name, 20).trim(), url: String(c?.url ?? '') }))
    .filter((c) => c.name && URL_RE.test(c.url)).slice(0, 3);
  const source = String(x?.source ?? '');
  return {
    name,
    nameLocal: str(x?.nameLocal, 80).trim(),
    status,
    ticketTypes: status === 'free' ? [] : ticketTypes,
    partyTotalTwd: status !== 'free' && total > 0 && total <= 1000000 ? total : null,
    fxNote: str(x?.fxNote, 40),
    openingHours: str(x?.openingHours, 80),
    closedDays: str(x?.closedDays, 60),
    timeSlot: x?.timeSlot === true,
    bookingWindow: str(x?.bookingWindow, 80),
    channels,
    tips: str(x?.tips, 160),
    cautions: str(x?.cautions, 160),
    source: URL_RE.test(source) ? source : '',
  };
}

export function normalizeResult(data) {
  const list = (Array.isArray(data?.attractions) ? data.attractions : []).map(normalizeAttraction).filter(Boolean);
  return { attractions: list.slice(0, MAX_ATTRACTIONS), note: String(data?.note ?? '').slice(0, 300) };
}

/**
 * @param {object} input { attractions: [{name, date, place}], city, adults, seniors, kids, kidAges }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson, now?: () => Date }} [deps] 測試用
 */
export async function ticketsHandler(input, env = {}, ctx = {}, deps = {}) {
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
      ...normalizeResult(result.data),
      sources: result.sources ?? [],
      model: result.model,
      fetchedAt: now().toISOString().slice(0, 10),
    },
  };
}
