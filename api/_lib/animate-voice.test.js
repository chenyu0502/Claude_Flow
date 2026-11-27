// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { animateVoiceHandler, buildVoicePrompt, extractPcm, parseInput, VOICE_MODELS } from './animate-voice.js';

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const ok = (mime = 'audio/l16; rate=24000; channels=1', data = pcm) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: data.toString('base64') } }] } }] }), { status: 200 });
const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(20), Buffer.from('data'), Buffer.alloc(4), pcm]);
const modelOf = (url) => decodeURIComponent(String(url).match(/models\/([^:]+):/)[1]);

describe('parseInput', () => {
  it('整理台詞、不認得的聲音與情緒用預設值', () => {
    const r = parseInput({ lines: [{ text: ' 汪汪！ ', voice: 'dog', mood: 'happy' }, { text: '嗨', voice: 'alien', mood: '??' }] });
    expect(r.value.lines).toEqual([{ text: '汪汪！', voice: 'dog', mood: 'happy' }, { text: '嗨', voice: 'boy', mood: 'happy' }]);
  });
  it('拒絕空清單、空白台詞與太多句', () => {
    expect(parseInput({ lines: [] }).error).toBeTruthy();
    expect(parseInput({ lines: [{ text: ' ' }] }).error).toMatch(/空白/);
    expect(parseInput({ lines: Array(13).fill({ text: 'a' }) }).error).toMatch(/12/);
  });
});

describe('buildVoicePrompt / extractPcm', () => {
  it('提示詞要求只念台詞，並帶聲音與語氣', () => {
    const p = buildVoicePrompt({ text: '爸爸回來了！', voice: 'girl', mood: 'happy' });
    expect(p).toContain('「爸爸回來了！」');
    expect(p).toContain('只念出');
    expect(p).toContain('小女孩');
  });
  it('l16 直接回傳、wav 去掉檔頭', () => {
    expect([...extractPcm(JSON.parse(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/l16; rate=24000', data: pcm.toString('base64') } }] } }] }))).pcm]).toEqual([...pcm]);
    const w = extractPcm({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] });
    expect([...w.pcm]).toEqual([...pcm]);
    expect(w.rate).toBe(24000);
  });
  it('沒有聲音時拋出錯誤', () => {
    expect(() => extractPcm({ candidates: [{ finishReason: 'OTHER' }] })).toThrow(/OTHER/);
  });
});

describe('animateVoiceHandler', () => {
  it('每句都配到音，先用 3.1 模型，回傳 base64 PCM', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => ok());
    const r = await animateVoiceHandler({ lines: [{ text: '一' }, { text: '二' }, { text: '三' }] }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.available).toBe(true);
    expect(r.body.clips).toHaveLength(3);
    expect(Buffer.from(r.body.clips[0].pcm, 'base64')).toEqual(pcm);
    expect(modelOf(fetchImpl.mock.calls[0][0])).toBe(VOICE_MODELS[0]);
  });
  it('429 時等一下重試同一個模型', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('上游回應 429')).mockResolvedValue(ok());
    const r = await animateVoiceHandler({ lines: [{ text: '一' }] }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.available).toBe(true);
    expect(fetchImpl.mock.calls.map(([u]) => modelOf(u))).toEqual([VOICE_MODELS[0], VOICE_MODELS[0]]);
  });
  it('第一個模型沒有聲音時換備援模型', async () => {
    const fetchImpl = vi.fn((url) => Promise.resolve(modelOf(url) === VOICE_MODELS[0]
      ? new Response(JSON.stringify({ candidates: [{ finishReason: 'OTHER' }] }), { status: 200 }) : ok()));
    const r = await animateVoiceHandler({ lines: [{ text: '一' }] }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.available).toBe(true);
    expect(r.body.model).toBe(VOICE_MODELS[1]);
  });
  it('部分失敗時回傳已配好的，並說明', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => { n++; if (n === 1) return ok(); return new Response('{"error":{"message":"bad"}}', { status: 400 }); });
    const r = await animateVoiceHandler({ lines: [{ text: '一' }, { text: '二' }] }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.available).toBe(true);
    expect(r.body.clips.filter(Boolean)).toHaveLength(1);
    expect(r.body.reason).toMatch(/1 句/);
  });
  it('全部失敗時說明原因；沒有金鑰時提示填金鑰', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('上游回應 429'));
    const r = await animateVoiceHandler({ lines: [{ text: '一' }] }, { GEMINI_API_KEY: 'k' }, { geminiKey: 'mine' }, { fetchImpl });
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toMatch(/你的 Gemini 金鑰.*額度/);
    expect((await animateVoiceHandler({ lines: [{ text: '一' }] }, {}, {})).body.reason).toMatch(/金鑰/);
  }, 15000);
  it('輸入錯誤回 400', async () => {
    expect((await animateVoiceHandler({}, { GEMINI_API_KEY: 'k' })).status).toBe(400);
  });
});

describe('長度與靜音', () => {
  const tone = (secs, silenceBefore = 0, silenceAfter = 0) => {
    const n = Math.round(secs * 24000), a = Math.round(silenceBefore * 24000), b = Math.round(silenceAfter * 24000);
    const buf = Buffer.alloc((a + n + b) * 2);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 5) * 8000), (a + i) * 2);
    return buf;
  };
  it('去掉前後靜音，前後各留約 0.08 秒', async () => {
    const { trimSilence } = await import('./animate-voice.js');
    const out = trimSilence(tone(1, 0.8, 1.2));
    expect(out.length / 2 / 24000).toBeGreaterThan(1.1);
    expect(out.length / 2 / 24000).toBeLessThan(1.3);
  });
  it('念太長（模型自己加詞）時重念；兩次都太長就換備援模型', async () => {
    const { animateVoiceHandler, VOICE_MODELS } = await import('./animate-voice.js');
    const long = tone(12), short = tone(1.5);
    const fetchImpl = vi.fn((url) => Promise.resolve(ok('audio/l16; rate=24000', modelOf(url) === VOICE_MODELS[0] ? long : short)));
    const r = await animateVoiceHandler({ lines: [{ text: '爸爸回來了！' }] }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(fetchImpl.mock.calls.map(([u]) => modelOf(u))).toEqual([VOICE_MODELS[0], VOICE_MODELS[0], VOICE_MODELS[1]]);
    expect(r.body.clips[0].model).toBe(VOICE_MODELS[1]);
  });
});
