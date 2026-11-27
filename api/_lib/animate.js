/**
 * 動畫製作（/animate/）的劇本生成：POST /api/animate/script
 *
 * 使用者用幾句話描述故事，這裡請 Gemini 寫成動畫劇本（JSON）。劇本只用動畫引擎會的角色、動作、場景，
 * 畫面由動畫製作的網頁在瀏覽器裡畫出來，換畫風不必重寫劇本。
 *
 * 詞彙表要和動畫製作 repo（chenyu0502/animation-studio）的 js/engine/script.js 一致；
 * 網頁端會再檢查一次劇本，不認得的東西換成最接近的並告訴使用者。
 * 金鑰與錯誤說明沿用旅遊規劃（flights.js 的 resolveKey、describeError）。
 */

import { describeError, resolveKey } from './flights.js';
import { searchJson } from './gemini-search.js';

export const PROMPT_MAX = 300;
const DURATIONS = [8, 12, 16];

const VOCAB = `scene（場景）：snow 雪地公園、beach 海邊、city 城市街道、forest 森林、park 草地公園、room 家裡客廳
time：day 白天、sunset 黃昏、night 晚上
weather：none、snow 下雪、rain 下雨、leaves 落葉、petals 花瓣、stars 星星
mood（決定配樂）：happy 歡樂、playful 俏皮、epic 熱血、calm 溫馨、tense 緊張、sad 感傷
characters.kind：person 人、cat 貓、dog 狗（最多 5 個）
characters 其他欄位：id（英文短代號）、name（台灣繁體中文名字）、color（衣服或毛色：red orange yellow green teal blue navy purple pink brown black white gray cream）、size（small、normal、big；小孩用 small）、hair（人才有：short long spiky bun pigtails bald）、hairColor、x（起始位置 0～100，0 是畫面最左）、facing（left、right）
actions.do：idle 站著、walk 走到、run 跑到、sneak 躡手躡腳走到、chase 追（to 填對象 id）、flee 逃跑（to 填位置）、jump 跳、wave 揮手、cheer 歡呼、dance 跳舞、talk 說話（text 填台詞）、laugh 大笑、cry 哭、angry 生氣跺腳、surprised 嚇一跳、think 思考、point 指向（target）、sit 坐下、sleep 睡覺、fall 跌倒、spin 轉圈、throw 丟（prop、target）、pickup 撿起（prop）、give 給（prop、target）、eat 吃（prop）、hug 擁抱（target）、look 看向（target）
actions 欄位：t（開始秒數）、who（角色 id）、do、dur（秒數，可省略）、to（移動類：位置 0～100 或角色、道具的 id）、target（對象角色 id）、prop（道具 id）、text（台詞）
props.kind：ball 球、snowball 雪球、fish 魚、bone 骨頭、gift 禮物、cake 蛋糕、flower 花、balloon 氣球、star 星星、heart 愛心、book 書、apple 蘋果、icecream 冰淇淋、umbrella 雨傘
props 欄位：id、kind、x（在地上的位置）或 holder（一開始拿在誰手上）、color
effects.kind：impact 撞擊、sparkle 閃亮、hearts 愛心、confetti 彩帶、question 問號、exclaim 驚嘆號、zzz 睡覺、sweat 汗滴、smoke 一陣煙；effects 欄位：t、kind、at（角色 id）
camera.shot：wide 全景、medium 中景、close 特寫；camera 欄位：t、shot、on（角色 id，全景不用）
captions 欄位：t、dur、text（台灣繁體中文，12 字以內）、pos（top、bottom、center）`;

const EXAMPLE = `{"title":"公園的球","duration":10,"mood":"happy","scene":"park","time":"sunset","weather":"none",
"characters":[{"id":"kid","kind":"person","name":"小明","color":"green","size":"small","hair":"short","x":20,"facing":"right"},{"id":"dog","kind":"dog","name":"旺財","color":"brown","x":32,"facing":"right"}],
"props":[{"id":"ball","kind":"ball","holder":"kid"}],
"actions":[{"t":0.5,"who":"kid","do":"talk","text":"旺財，去撿！","dur":1.4},{"t":2.0,"who":"kid","do":"throw","prop":"ball"},{"t":2.6,"who":"dog","do":"run","to":"ball","dur":1.3},{"t":4.0,"who":"dog","do":"pickup","prop":"ball"},{"t":4.9,"who":"dog","do":"run","to":"kid","dur":1.3},{"t":6.4,"who":"dog","do":"give","prop":"ball","target":"kid"},{"t":7.8,"who":"kid","do":"laugh","dur":1.2},{"t":7.8,"who":"dog","do":"jump"},{"t":8.7,"who":"dog","do":"dance","dur":1.3}],
"camera":[{"t":0,"shot":"medium","on":"kid"},{"t":2.5,"shot":"wide"},{"t":4.8,"shot":"medium","on":"dog"},{"t":7.6,"shot":"wide"}],
"captions":[{"t":8.4,"dur":1.6,"text":"好狗狗！","pos":"top"}],
"effects":[{"t":7.9,"kind":"hearts","at":"dog"}],
"note":""}`;

const SYSTEM_INSTRUCTION = `你是短篇動畫的編劇與分鏡師。使用者用幾句話描述故事，你把它寫成動畫引擎看得懂的劇本 JSON。
動畫引擎只會下面這些東西，劇本只能使用它們：
${VOCAB}

寫劇本的規則：
1. 故事要有起承轉合：開場交代角色與場景 → 發展 → 最精彩的一刻（追逐、丟中、驚喜）→ 溫暖或好笑的結尾（歡呼、擁抱、一起吃、一起睡）。
2. 每個角色都要有事做；同一個角色的動作不要重疊（下一個動作的 t 要大於等於上一個的 t + dur）。
3. 要和別人互動（hug、give、talk 給某人聽）之前，先用 walk、run 移動到對方旁邊。
4. 丟東西用 throw，道具要先在手上（holder）或先 pickup；丟雪球不用事先準備，prop 填 snowball 即可。
5. 鏡頭 3～6 個：從 wide 開始，在重要時刻用 medium 或 close 對準角色，最後回到 wide。
6. 台詞（talk 的 text）每句 14 字以內；字幕 1～2 句，12 字以內；全部用台灣繁體中文。
7. 使用者要的東西引擎沒有時，用最接近的代替（例如兔子→小狗、老虎→大貓、餐廳→家裡客廳），並在 note 用一句話說明替換了什麼；沒有替換時 note 留空。
8. title 是 12 字以內的片名。
只回覆一個 JSON 物件，不要其他文字。格式範例：
${EXAMPLE}`;

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt) return { error: '請描述你想看的故事' };
  if ([...prompt].length > PROMPT_MAX) return { error: `故事描述最多 ${PROMPT_MAX} 字` };
  const d = Math.round(Number(input?.duration) || 12);
  return { value: { prompt, duration: DURATIONS.includes(d) ? d : 12 } };
}

export function buildPrompt(v) {
  return `故事：${v.prompt}\n\n長度：${v.duration} 秒（duration 填 ${v.duration}，所有時間都在 0～${v.duration} 秒之內，結尾留 1～2 秒給歡呼或字幕）。`;
}

/** 模型回的劇本最基本的檢查：要是物件、要有角色與動作。細部的修正交給網頁端。 */
export function looksLikeScript(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.characters) && data.characters.length > 0 && Array.isArray(data.actions) && data.actions.length > 0;
}

/**
 * @param {object} input { prompt, duration }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ search?: typeof searchJson }} [deps] 測試用
 */
export async function animateScriptHandler(input, env = {}, ctx = {}, deps = {}) {
  const { search = searchJson } = deps;
  const parsed = parseInput(input);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const key = resolveKey(env, ctx);
  if (!key) return { status: 200, noStore: true, body: { available: false, reason: '網站尚未設定 Gemini 金鑰，請在下方填入你自己的金鑰。' } };

  let lastError = null;
  // 偶爾會回不完整的劇本：最多試兩次
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await search({
        apiKey: key.apiKey,
        model: env.GEMINI_MODEL,
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: buildPrompt(parsed.value),
        search: false,
        temperature: 0.9,
      });
    } catch (err) {
      lastError = err;
      if (/JSON/i.test(String(err?.message))) continue;
      return { status: 200, noStore: true, body: { available: false, reason: describeAnimateError(err, key.source) } };
    }
    if (looksLikeScript(result.data)) {
      const { note = '', ...script } = result.data;
      script.duration = parsed.value.duration;
      return { status: 200, noStore: true, body: { available: true, script, note: String(note ?? '').slice(0, 200), model: result.model } };
    }
    lastError = new Error('劇本格式不完整');
  }
  return { status: 200, noStore: true, body: { available: false, reason: describeAnimateError(lastError, key.source) } };
}

/** 動畫製作沒有「改用 claude.ai 查詢」，錯誤說明改成這裡的下一步 */
export function describeAnimateError(err, keySource) {
  const msg = String(err?.message ?? '');
  if (/劇本格式不完整|JSON/i.test(msg)) return 'AI 寫的劇本不完整，請再按一次「生成動畫」，或把故事寫得具體一點。';
  return describeError(err, keySource).replace(/，或按「改用 claude\.ai 查詢」。?/, '。').replace(/請按「改用 claude\.ai 查詢」。?/, '請稍後再試。');
}
