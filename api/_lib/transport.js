/**
 * 旅遊規劃（/travel/）的交通票券分析：/api/travel/transport
 *
 * 網頁把行程中的移動段（哪一天、從哪到哪、搭什麼）送過來，由後端呼叫 Gemini 並開啟 Google 搜尋，
 * 查詢可用的周遊券、IC 卡、機場交通與需劃位的車票，與單買比較後推薦最划算的組合。
 * 網站不代售票券；金鑰與錯誤說明沿用航班查詢（flights.js）。
 */

import { describeError, resolveKey } from './flights.js';
import { searchJson } from './gemini-search.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
export const MAX_LEGS = 40;
export const MAX_PASSES = 8;
export const TYPES = ['pass', 'ic', 'airport', 'reserved', 'single'];
export const VERDICTS = ['recommended', 'optional', 'not_needed'];

const SYSTEM_INSTRUCTION = `你是熟悉各國鐵道與交通票券的旅遊顧問。使用 Google 搜尋查詢官方與購票平台的最新票價與規定，只根據搜尋到的網頁回答。
規則：
1. 不編造票券、價格、適用範圍、購買方式或網址；查不到的欄位留空或填 0。
2. 比較「買票券」與「單買」時，要依實際移動段計算，並說明依據。
3. 價格以當地貨幣原價填寫並註明幣別；全體合計換算新台幣並寫出匯率。
4. 每種票券都附上實際查到資料的網頁網址（source）。
5. 說明文字使用台灣繁體中文。`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const legs = (Array.isArray(input?.legs) ? input.legs : [])
    .map((l) => ({
      day: Math.max(1, Math.min(60, Math.round(Number(l?.day) || 1))),
      date: DATE_RE.test(str(l?.date, 10)) ? str(l?.date, 10) : '',
      from: str(l?.from, 60),
      to: str(l?.to, 60),
      mode: str(l?.mode, 40),
      title: str(l?.title, 60),
    }))
    .filter((l) => l.title || (l.from && l.to));
  if (!legs.length) return { error: '行程中沒有可以分析的移動段' };
  if (legs.length > MAX_LEGS) return { error: `移動段最多 ${MAX_LEGS} 段，請縮短行程後再分析` };
  const adults = Math.round(Number(input?.adults) || 0);
  const seniors = Math.round(Number(input?.seniors) || 0);
  const kids = Math.round(Number(input?.kids) || 0);
  if ([adults, seniors, kids].some((n) => n < 0) || adults + seniors + kids < 1 || adults + seniors + kids > 20) {
    return { error: '旅客人數應為 1～20 人' };
  }
  const known = (Array.isArray(input?.knownPasses) ? input.knownPasses : []).map((p) => str(p, 40)).filter(Boolean).slice(0, 10);
  return { value: { legs, city: str(input?.city, 40), adults, seniors, kids, kidAges: str(input?.kidAges, 30), knownPasses: known } };
}

export function buildPrompt(v) {
  const who = [v.adults && `成人 ${v.adults}`, v.seniors && `長輩（65 歲以上）${v.seniors}`,
    v.kids && `兒童 ${v.kids}${v.kidAges ? `（${v.kidAges} 歲）` : ''}`].filter(Boolean).join('、');
  const legs = v.legs.map((l) => `- Day ${l.day}${l.date ? `（${l.date}）` : ''}：${l.from && l.to ? `${l.from} → ${l.to}` : l.title}${l.mode ? `（${l.mode}）` : ''}${l.title && l.from ? `　${l.title}` : ''}`).join('\n');
  return `以下是${v.city ? `${v.city}` : ''}旅遊行程中的所有移動段，旅客為${who}：
${legs}
${v.knownPasses.length ? `\n行程原本規劃的票券：${v.knownPasses.join('、')}（請一併評估是否划算）\n` : ''}
請上網查詢可用的交通票券（周遊券、一日券、IC 卡、機場交通優惠票、需劃位的特急或觀光列車），依實際移動段與單買比較，列出最多 ${MAX_PASSES} 項：
1. type：周遊券或一日券填 "pass"；IC 卡填 "ic"；機場交通（含機場特急、機場巴士優惠票）填 "airport"；需事先劃位或預約的車票填 "reserved"；建議單買的填 "single"。
2. verdict：建議購買填 "recommended"；看情況填 "optional"；不划算或用不到填 "not_needed"，並在 savingsNote 說明原因。
3. coverage 寫適用範圍（路線或區域）；validity 寫效期（例如「連續 3 日」「單程」）；useDays 列出用得到的天數（例如 [1, 2]）。
4. priceTypes：各票種與當地貨幣原價（price 數字、currency 幣別代碼）；partyTotalTwd：依旅客組成計算全體合計並換算新台幣整數，fxNote 寫匯率；IC 卡填建議儲值總額。查不到填 0。
5. savingsNote：與單買相比省或多多少，以及計算依據（例如「單買 HARUKA＋JR 約 ¥3,600，省 ¥1,400」）。
6. buyWhere 寫購買地點與方式（例如「關西機場 JR 售票處出示護照購買」）；needReservation：需要事先線上預約或劃位填 true；bookingWindow 寫何時要買或劃位（例如「出發前線上預約，抵達後兌換」），不需要就留空。
7. channels：購買管道最多 3 個（官網、Klook、KKday 等）附網址；tips、cautions；source 是主要資料網址。
8. strategy 用 2～3 句話寫整體建議（買哪些、哪幾天用、還有哪些段單買或用 IC 卡）；strategyTotalTwd 是推薦組合的全體合計（新台幣整數，查不到填 0）。

最後只回覆一個 \`\`\`json 程式碼區塊，格式：
{"strategy":"","strategyTotalTwd":0,"passes":[{"name":"","nameLocal":"","type":"pass","verdict":"recommended","coverage":"","validity":"","useDays":[1],"priceTypes":[{"label":"成人","price":0,"currency":"JPY"}],"partyTotalTwd":0,"fxNote":"","savingsNote":"","buyWhere":"","needReservation":false,"bookingWindow":"","channels":[{"name":"官網","url":"https://..."}],"tips":"","cautions":"","source":"https://..."}],"note":""}`;
}

/** 檢查模型回傳的單一票券；沒有名稱的整筆捨棄。 */
function normalizePass(x) {
  const name = String(x?.name ?? '').trim().slice(0, 60);
  if (!name) return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const priceTypes = (Array.isArray(x?.priceTypes) ? x.priceTypes : [])
    .map((t) => {
      const price = Math.round((Number(t?.price) || 0) * 100) / 100;
      const currency = String(t?.currency ?? '').trim().toUpperCase();
      const label = str(t?.label, 20).trim();
      return label && price >= 0 && price < 10000000 && /^[A-Z]{3}$/.test(currency) ? { label, price, currency } : null;
    })
    .filter(Boolean).slice(0, 6);
  const total = Math.round(Number(x?.partyTotalTwd) || 0);
  const useDays = [...new Set((Array.isArray(x?.useDays) ? x.useDays : []).map((d) => Math.round(Number(d))).filter((d) => d >= 1 && d <= 60))].sort((a, b) => a - b);
  const source = String(x?.source ?? '');
  return {
    name,
    nameLocal: str(x?.nameLocal, 80).trim(),
    type: TYPES.includes(x?.type) ? x.type : 'pass',
    verdict: VERDICTS.includes(x?.verdict) ? x.verdict : 'optional',
    coverage: str(x?.coverage, 120),
    validity: str(x?.validity, 40),
    useDays,
    priceTypes,
    partyTotalTwd: total > 0 && total <= 1000000 ? total : null,
    fxNote: str(x?.fxNote, 40),
    savingsNote: str(x?.savingsNote, 160),
    buyWhere: str(x?.buyWhere, 120),
    needReservation: x?.needReservation === true,
    bookingWindow: str(x?.bookingWindow, 80),
    channels: (Array.isArray(x?.channels) ? x.channels : [])
      .map((c) => ({ name: str(c?.name, 20).trim(), url: String(c?.url ?? '') }))
      .filter((c) => c.name && URL_RE.test(c.url)).slice(0, 3),
    tips: str(x?.tips, 160),
    cautions: str(x?.cautions, 160),
    source: URL_RE.test(source) ? source : '',
  };
}

export function normalizeResult(data) {
  const passes = (Array.isArray(data?.passes) ? data.passes : []).map(normalizePass).filter(Boolean).slice(0, MAX_PASSES);
  const total = Math.round(Number(data?.strategyTotalTwd) || 0);
  return {
    strategy: String(data?.strategy ?? '').slice(0, 400),
    strategyTotalTwd: total > 0 && total <= 2000000 ? total : null,
    passes,
    note: String(data?.note ?? '').slice(0, 300),
  };
}

/**
 * @param {object} input { legs: [{day, date, from, to, mode, title}], city, adults, seniors, kids, kidAges, knownPasses }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson, now?: () => Date }} [deps] 測試用
 */
export async function transportHandler(input, env = {}, ctx = {}, deps = {}) {
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
