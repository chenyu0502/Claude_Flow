/**
 * 動畫製作（/animate/）的配音：POST /api/animate/voice
 *
 * 輸入劇本裡的台詞清單，每句請 Gemini 語音模型念出來，回傳 24kHz 單聲道 16 位元 PCM（base64）。
 * 網頁端會依每句的長度調整時間軸，並把語音混進配樂與匯出的 MP4。
 *
 * 模型選擇（2026-11 實測）：
 * - gemini-3.1-flash-tts-preview：五到九個字的台詞約 1.4～3.3 秒，照台詞念，可用。
 * - gemini-3.8-flash-tts：會自己即興（加笑聲、重複台詞、喊「耶」），五個字念到 8 秒以上，
 *   提示詞要求「只念一次」反而更長，所以只當備援。
 * 免費額度對語音模型的每分鐘請求數很低（同時 20 個請求有 7 個回 429），所以一次最多送 2 句，
 * 遇到 429 等一下再試。
 */

import { fetchWithRetry } from './http.js';
import { resolveKey } from './flights.js';
import { isQuotaExhausted } from './gemini-search.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const VOICE_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts'];
export const SAMPLE_RATE = 24000;
export const MAX_LINES = 12;
export const TEXT_MAX = 40;
/** 整個請求的時間預算，要小於 vercel.json 的 maxDuration（60 秒） */
const BUDGET_MS = 50000;
const PER_CALL_MS = 20000;
const CONCURRENCY = 2;

/** 配音角色：Gemini 的預設聲音與給模型的聲音描述 */
export const VOICES = {
  boy: { name: 'Puck', desc: '活潑的小男孩' },
  girl: { name: 'Leda', desc: '可愛的小女孩' },
  man: { name: 'Charon', desc: '溫和的成年男性' },
  woman: { name: 'Kore', desc: '親切的成年女性' },
  'old-man': { name: 'Orus', desc: '慈祥的老爺爺' },
  'old-woman': { name: 'Aoede', desc: '慈祥的老奶奶' },
  cat: { name: 'Leda', desc: '像小貓一樣嬌嗲可愛' },
  dog: { name: 'Puck', desc: '像小狗一樣憨厚熱情' },
};

const MOOD_TEXT = { happy: '開心', playful: '俏皮', epic: '激昂', calm: '溫柔', tense: '緊張', sad: '難過' };

/** 檢查並整理輸入；有問題時回傳錯誤訊息。 */
export function parseInput(input) {
  const raw = Array.isArray(input?.lines) ? input.lines : null;
  if (!raw || raw.length === 0) return { error: '沒有需要配音的台詞' };
  if (raw.length > MAX_LINES) return { error: `一次最多配音 ${MAX_LINES} 句` };
  const lines = raw.map((l) => ({
    text: [...String(l?.text ?? '').trim()].slice(0, TEXT_MAX).join(''),
    voice: VOICES[l?.voice] ? l.voice : 'boy',
    mood: MOOD_TEXT[l?.mood] ? l.mood : 'happy',
  }));
  if (lines.some((l) => !l.text)) return { error: '台詞不能是空白' };
  return { value: { lines } };
}

/** 給語音模型的提示詞：嚴格要求只念台詞（實測寬鬆的寫法會讓模型自己加詞） */
export function buildVoicePrompt(line) {
  const v = VOICES[line.voice];
  return `請只念出引號內的台詞一次，不要重複、不要加任何字、笑聲或語助詞。聲音：${v.desc}；語氣：${MOOD_TEXT[line.mood]}；台灣口音國語。台詞：「${line.text}」`;
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

/** 台詞合理的最長秒數：每字約 0.6 秒再加 2 秒。超過代表模型自己加詞、重複或哼唱 */
export const maxSeconds = (text) => [...text].length * 0.6 + 2;

/** 去掉開頭與結尾的靜音（前後各留 0.08 秒），回傳新的 Buffer */
export function trimSilence(pcm, rate = SAMPLE_RATE, threshold = 500) {
  const n = Math.floor(pcm.length / 2), win = Math.max(1, Math.floor(rate * 0.02));
  const loud = (i) => { let sum = 0; for (let k = i; k < Math.min(n, i + win); k++) { const v = pcm.readInt16LE(k * 2); sum += v * v; } return Math.sqrt(sum / win) > threshold; };
  let a = 0, b = n;
  while (a < n && !loud(a)) a += win;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  if (a >= b) return pcm;
  const pad = Math.floor(rate * 0.08);
  return pcm.subarray(Math.max(0, a - pad) * 2, Math.min(n, b + pad) * 2);
}

async function speakOne(line, apiKey, deadline, fetchImpl) {
  let lastError;
  for (const model of VOICE_MODELS) {
    // 429（每分鐘請求數用完）：同一個模型等一下再試，最多兩次
    for (let attempt = 0; attempt < 3; attempt++) {
      if (deadline - Date.now() < 4000) throw lastError ?? new Error('配音逾時');
      try {
        const res = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildVoicePrompt(line) }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[line.voice].name } } },
            },
          }),
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
        const out = extractPcm(JSON.parse(text));
        out.pcm = trimSilence(out.pcm, out.rate);
        const secs = out.pcm.length / 2 / out.rate;
        if (secs > maxSeconds(line.text)) throw new Error(`TOO_LONG ${secs.toFixed(1)}s`);
        return { ...out, model };
      } catch (err) {
        lastError = err;
        // 429：等一下再試；念太長：同一個模型重念一次（實測多半是偶發的即興）
        if (/\b429\b/.test(err.message) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        if (/TOO_LONG/.test(err.message) && attempt < 1) continue;
        break; // 其他錯誤換下一個模型
      }
    }
  }
  throw lastError ?? new Error('配音失敗');
}

/**
 * @param {object} input { lines: [{ text, voice, mood }] }
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

  const { lines } = parsed.value;
  const deadline = Date.now() + BUDGET_MS;
  const clips = new Array(lines.length).fill(null);
  let next = 0, lastError = null, model = null;
  const worker = async () => {
    while (next < lines.length) {
      const i = next++;
      try {
        const r = await speakOne(lines[i], key.apiKey, deadline, fetchImpl);
        clips[i] = { sampleRate: r.rate, pcm: r.pcm.toString('base64'), model: r.model };
        model ??= r.model;
      } catch (err) { lastError = err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));

  const done = clips.filter(Boolean).length;
  if (!done) return { status: 200, noStore: true, body: { available: false, reason: describeVoiceError(lastError, key.source) } };
  return {
    status: 200, noStore: true,
    body: { available: true, clips, model, ...(done < lines.length ? { reason: `有 ${lines.length - done} 句沒配到音，會用原本的音效代替。` } : {}) },
  };
}

export function describeVoiceError(err, keySource) {
  const m = String(err?.message ?? '');
  const whose = keySource === 'user' ? '你的 Gemini 金鑰' : '網站的 Gemini 金鑰';
  if (/\b429\b/.test(m) || isQuotaExhausted(m)) return `${whose}的配音額度暫時用完，請過一分鐘再試，或明天再試。`;
  if (/api key not valid|API_KEY_INVALID|permission|401|403/i.test(m)) return `${whose}無效或沒有權限使用語音模型。`;
  if (/abort|timeout|逾時/i.test(m)) return '配音逾時，請再試一次。';
  return '配音失敗，請稍後再試。';
}
