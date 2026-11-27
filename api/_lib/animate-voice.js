/**
 * 動畫製作（/animate/）的配音：POST /api/animate/voice
 *
 * 一部動畫的所有台詞只送「一個」請求：把對白寫成劇本，請 Gemini 語音模型用多角色聲音照順序念完、
 * 每句之間停頓一秒，再依停頓把錄音切回一句一句。回傳每句的 24kHz 單聲道 16 位元 PCM（base64），
 * 網頁端依每句的長度調整時間軸，並把語音混進配樂與匯出的 MP4。
 *
 * 為什麼整部一次念（2026-11 實測）：
 * - 免費額度每個語音模型每分鐘 3 次、每天 10 次（GenerateRequestsPerDayPerProjectPerModel-FreeTier = 10），
 *   逐句請求一部動畫就用掉 5～6 次，而且每分鐘 3 次會讓 6 句超過 Vercel 的 60 秒上限。
 * - gemini-2.5-flash-preview-tts 多角色念 4 句對白約 6 秒；句與句之間的停頓約 1 秒，
 *   句子裡的逗號只停 0.3 秒，取最長的「句數 − 1」個停頓切開，逐字稿與說話者完全對上。
 * - gemini-3.8-flash-tts 會自己即興（加笑聲、重複台詞），不使用。
 * - 多角色模式最多 2 種聲音：超過 2 個說話者時，依「小孩／大人、男／女」併成兩組。
 * 切段檢查不通過時換下一個模型；都失敗就回 available: false，網頁端改用瀏覽器內建語音預覽。
 */

import { fetchWithRetry } from './http.js';
import { resolveKey } from './flights.js';
import { isQuotaExhausted } from './gemini-search.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const VOICE_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];
export const SAMPLE_RATE = 24000;
export const MAX_LINES = 12;
export const TEXT_MAX = 40;
/** 整個請求的時間預算，要小於 vercel.json 的 maxDuration（60 秒） */
const BUDGET_MS = 50000;
const PER_CALL_MS = 40000;

/** 配音角色：Gemini 的預設聲音、給模型的聲音描述、併組時的分類 */
export const VOICES = {
  boy: { name: 'Puck', desc: '活潑的小男孩', group: 'kid' },
  girl: { name: 'Leda', desc: '可愛的小女孩', group: 'kid' },
  man: { name: 'Charon', desc: '溫和的成年男性', group: 'male' },
  woman: { name: 'Kore', desc: '親切的成年女性', group: 'female' },
  'old-man': { name: 'Orus', desc: '慈祥的老爺爺', group: 'male' },
  'old-woman': { name: 'Aoede', desc: '慈祥的老奶奶', group: 'female' },
  cat: { name: 'Leda', desc: '像小貓一樣嬌嗲可愛', group: 'kid' },
  dog: { name: 'Puck', desc: '像小狗一樣憨厚熱情', group: 'kid' },
};

const MOOD_TEXT = { happy: '開心', playful: '俏皮', epic: '激昂', calm: '溫柔', tense: '緊張', sad: '難過' };

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const raw = Array.isArray(input?.lines) ? input.lines : null;
  if (!raw || raw.length === 0) return { error: '沒有需要配音的台詞' };
  if (raw.length > MAX_LINES) return { error: `一次最多配音 ${MAX_LINES} 句` };
  const lines = raw.map((l, i) => ({
    text: [...String(l?.text ?? '').trim()].slice(0, TEXT_MAX).join(''),
    speaker: String(l?.speaker ?? '').trim().slice(0, 12) || `角色${i + 1}`,
    voice: VOICES[l?.voice] ? l.voice : 'boy',
  }));
  if (lines.some((l) => !l.text)) return { error: '台詞不能是空白' };
  const mood = MOOD_TEXT[input?.mood] ? input.mood : 'happy';
  return { value: { lines, mood } };
}

/**
 * 把說話者分成最多兩組聲音（多角色模式的上限）。
 * 回傳 { slots: [{ label, voice, members }], slotOf: { speaker: label } }
 */
export function assignSlots(lines) {
  const speakers = [];
  for (const l of lines) if (!speakers.some((s) => s.speaker === l.speaker)) speakers.push({ speaker: l.speaker, voice: l.voice });
  if (speakers.length <= 2) {
    const slots = speakers.map((s) => ({ label: s.speaker, voice: s.voice, members: [s.speaker] }));
    return { slots, slotOf: Object.fromEntries(speakers.map((s) => [s.speaker, s.speaker])) };
  }
  // 超過兩個：前兩個不同分類的說話者各自開一組，其他人併進同分類（找不到就併進聲音最接近的）
  const first = speakers[0];
  const second = speakers.find((s) => VOICES[s.voice].group !== VOICES[first.voice].group) ?? speakers[1];
  const slots = [first, second].map((s, i) => ({ label: i === 0 ? '甲' : '乙', voice: s.voice, members: [] }));
  const slotOf = {};
  for (const s of speakers) {
    const g = VOICES[s.voice].group;
    const slot = s === first ? slots[0] : s === second ? slots[1]
      : slots.find((x) => VOICES[x.voice].group === g) ?? (g === 'kid' ? slots[0] : slots[1]);
    slot.members.push(s.speaker);
    slotOf[s.speaker] = slot.label;
  }
  return { slots, slotOf };
}

/** 給語音模型的提示詞與多角色設定 */
export function buildVoiceRequest(lines, mood) {
  const { slots, slotOf } = assignSlots(lines);
  const cast = slots.map((s) => `${s.label}是${VOICES[s.voice].desc}`).join('，');
  const transcript = lines.map((l) => `${slotOf[l.speaker]}：${l.text}`).join('\n');
  const text = `以下是動畫裡的對白。請照順序把每一句念一次，不要加任何字、笑聲或語助詞；每句之間停頓一秒。${cast}，整體語氣${MOOD_TEXT[mood]}，台灣口音國語。\n\n${transcript}`;
  const speechConfig = slots.length === 1
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[slots[0].voice].name } } }
    : { multiSpeakerVoiceConfig: { speakerVoiceConfigs: slots.map((s) => ({ speaker: s.label, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[s.voice].name } } })) } };
  return { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } };
}

/** 從 Gemini 的回應取出 16 位元 PCM（wav 去掉檔頭）；格式不對時拋出錯誤 */
export function extractPcm(json) {
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`Gemini 沒有回傳聲音（${json?.candidates?.[0]?.finishReason ?? '無內容'}）`);
  const { mimeType = '', data } = part.inlineData;
  let buf = Buffer.from(data, 'base64');
  if (/wav/i.test(mimeType)) {
    const at = buf.indexOf('data');
    buf = at >= 0 ? buf.subarray(at + 8) : buf.subarray(44);
  }
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] ?? SAMPLE_RATE);
  return { pcm: buf.subarray(0, buf.length - (buf.length % 2)), rate };
}

/** 台詞合理的秒數範圍：每字約 0.12～0.6 秒，上限再多給 2 秒 */
export const minSeconds = (text) => Math.max(0.2, [...text].length * 0.12);
export const maxSeconds = (text) => [...text].length * 0.6 + 2;

const WIN = 0.02; // 音量分析的視窗（秒）
/** 每 20ms 是否有聲音 */
function loudness(pcm, rate, threshold = 500) {
  const n = Math.floor(pcm.length / 2), w = Math.max(1, Math.round(rate * WIN)), out = [];
  for (let i = 0; i + w <= n; i += w) {
    let sum = 0;
    for (let k = i; k < i + w; k++) { const v = pcm.readInt16LE(k * 2); sum += v * v; }
    out.push(Math.sqrt(sum / w) > threshold);
  }
  return out;
}

/** 去掉開頭與結尾的靜音（前後各留 0.08 秒） */
export function trimSilence(pcm, rate = SAMPLE_RATE) {
  const loud = loudness(pcm, rate), w = Math.round(rate * WIN);
  const a = loud.indexOf(true), b = loud.lastIndexOf(true);
  if (a < 0) return pcm;
  const pad = Math.round(rate * 0.08);
  return pcm.subarray(Math.max(0, a * w - pad) * 2, Math.min(pcm.length / 2, (b + 1) * w + pad) * 2);
}

/**
 * 依停頓把整段錄音切成 count 句：找出句中的靜音段（0.2 秒以上，不含頭尾），取最長的 count − 1 個，
 * 在每個停頓的中間切開。句與句之間的停頓（約 1 秒）要明顯比句子裡的逗號（約 0.3 秒）長，
 * 否則判定切不準，拋出錯誤。
 */
export function splitByPauses(pcm, rate, count) {
  if (count <= 1) return [trimSilence(pcm, rate)];
  const loud = loudness(pcm, rate), first = loud.indexOf(true), last = loud.lastIndexOf(true);
  if (first < 0) throw new Error('SPLIT 沒有聲音');
  const gaps = [];
  for (let i = first, run = 0; i <= last + 1; i++) {
    if (i <= last && !loud[i]) { run++; continue; }
    if (run * WIN >= 0.2) gaps.push({ at: i - run, len: run });
    run = 0;
  }
  if (gaps.length < count - 1) throw new Error(`SPLIT 停頓只有 ${gaps.length} 個，需要 ${count - 1} 個`);
  const sorted = [...gaps].sort((a, b) => b.len - a.len);
  const chosen = sorted.slice(0, count - 1), next = sorted[count - 1];
  const shortest = chosen[chosen.length - 1].len * WIN;
  if (shortest < 0.45) throw new Error(`SPLIT 句間停頓太短（${shortest.toFixed(2)}s）`);
  if (next && next.len * WIN > shortest * 0.75) throw new Error('SPLIT 句間停頓和句中停頓分不開');
  const w = Math.round(rate * WIN);
  const cuts = chosen.map((g) => (g.at + g.len / 2) * w).sort((a, b) => a - b);
  const bounds = [0, ...cuts, pcm.length / 2];
  return bounds.slice(0, -1).map((a, i) => trimSilence(pcm.subarray(Math.round(a) * 2, Math.round(bounds[i + 1]) * 2), rate));
}

/** 呼叫一個模型、切段並檢查每句長度；不合格時拋出錯誤 */
async function speakAll(model, lines, mood, apiKey, deadline, fetchImpl) {
  const res = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(buildVoiceRequest(lines, mood)),
    timeoutMs: PER_CALL_MS,
    retries: 0,
    deadline,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try { detail = JSON.parse(text)?.error?.message ?? detail; } catch { /* 保留原文 */ }
    throw new Error(`Gemini 回應 ${res.status}：${detail}`);
  }
  const { pcm, rate } = extractPcm(JSON.parse(text));
  const parts = splitByPauses(pcm, rate, lines.length);
  parts.forEach((p, i) => {
    const secs = p.length / 2 / rate;
    if (secs < minSeconds(lines[i].text) || secs > maxSeconds(lines[i].text)) {
      throw new Error(`SPLIT 第 ${i + 1} 句長 ${secs.toFixed(1)}s，和台詞字數不符`);
    }
  });
  return parts.map((p) => ({ sampleRate: rate, pcm: p.toString('base64') }));
}

/**
 * @param {object} input { lines: [{ text, speaker, voice }], mood }
 * @param {Record<string,string|undefined>} env
 * @param {{ geminiKey?: string|null }} ctx
 * @param {{ fetchImpl?: typeof fetchWithRetry }} [deps] 測試用
 */
export async function animateVoiceHandler(input, env = {}, ctx = {}, deps = {}) {
  const { fetchImpl = fetchWithRetry } = deps;
  const parsed = parseInput(input);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const key = resolveKey(env, ctx);
  if (!key) return { status: 200, noStore: true, body: { available: false, reason: '網站尚未設定 Gemini 金鑰，請填入你自己的金鑰。' } };

  const { lines, mood } = parsed.value;
  const deadline = Date.now() + BUDGET_MS;
  const errors = [];
  for (const model of VOICE_MODELS) {
    if (deadline - Date.now() < 8000) break;
    try {
      const clips = await speakAll(model, lines, mood, key.apiKey, deadline, fetchImpl);
      return { status: 200, noStore: true, body: { available: true, clips, model } };
    } catch (err) {
      errors.push(err);
      console.warn(`[animate-voice] ${model} 失敗：${String(err?.message).slice(0, 160)}`);
    }
  }
  // 說明以最有參考價值的原因為準：有切段問題就說切段（備援模型的額度錯誤會蓋掉真正的原因）
  const reason = errors.find((e) => /SPLIT/.test(e?.message)) ?? errors[0] ?? null;
  return { status: 200, noStore: true, body: { available: false, reason: describeVoiceError(reason, key.source) } };
}

export function describeVoiceError(err, keySource) {
  const m = String(err?.message ?? '');
  const whose = keySource === 'user' ? '你的 Gemini 金鑰' : '網站的 Gemini 金鑰';
  if (/\b429\b/.test(m) || isQuotaExhausted(m)) return `${whose}今天的配音額度已用完（免費版每天約 10 次），先改用瀏覽器內建的語音。`;
  if (/api key not valid|API_KEY_INVALID|permission|401|403/i.test(m)) return `${whose}無效或沒有權限使用語音模型，先改用瀏覽器內建的語音。`;
  if (/SPLIT/.test(m)) return 'AI 配音的句子切不準，先改用瀏覽器內建的語音；可以再按一次「AI 配音」重試。';
  if (/abort|timeout|逾時/i.test(m)) return '配音逾時，先改用瀏覽器內建的語音。';
  return '配音失敗，先改用瀏覽器內建的語音。';
}
