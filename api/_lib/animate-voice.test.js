// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  animateVoiceHandler, assignSlots, buildVoiceRequest, extractPcm, parseInput, splitByPauses, trimSilence, VOICE_MODELS,
} from './animate-voice.js';

const RATE = 24000;
/** 合成語音：segs 是 [秒數, 有聲音?] 的序列 */
const audio = (segs) => {
  const total = segs.reduce((s, [d]) => s + Math.round(d * RATE), 0);
  const buf = Buffer.alloc(total * 2);
  let at = 0;
  for (const [d, on] of segs) {
    const n = Math.round(d * RATE);
    if (on) for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 5) * 8000), (at + i) * 2);
    at += n;
  }
  return buf;
};
const secs = (b) => b.length / 2 / RATE;
const reply = (pcm, mime = 'audio/L16;codec=pcm;rate=24000') =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: pcm.toString('base64') } }] } }] }), { status: 200 });
const modelOf = (url) => decodeURIComponent(String(url).match(/models\/([^:]+):/)[1]);

// 四句對白：第二句與第三句中間有逗號（0.3 秒的短停頓），句與句之間停 1 秒
const DIALOG = audio([[0.2, 0], [1.3, 1], [1, 0], [0.9, 1], [0.3, 0], [0.9, 1], [1, 0], [1.0, 1], [0.3, 0], [1.2, 1], [1, 0], [1.6, 1], [0.2, 0]]);
const LINES = [
  { text: '爸爸回來了！', speaker: '小美', voice: 'girl' },
  { text: '乖孩子，爸爸好想你。', speaker: '爸爸', voice: 'man' },
  { text: '你看，我畫了一隻小狗！', speaker: '小美', voice: 'girl' },
  { text: '哇，畫得真好！', speaker: '爸爸', voice: 'man' },
];

describe('parseInput', () => {
  it('整理台詞，不認得的聲音與情緒用預設值', () => {
    const r = parseInput({ lines: [{ text: ' 汪汪！ ', speaker: '旺財', voice: 'dog' }, { text: '嗨', voice: 'alien' }], mood: '??' });
    expect(r.value.lines).toEqual([{ text: '汪汪！', speaker: '旺財', voice: 'dog' }, { text: '嗨', speaker: '角色2', voice: 'boy' }]);
    expect(r.value.mood).toBe('happy');
  });
  it('拒絕空清單、空白台詞與太多句', () => {
    expect(parseInput({ lines: [] }).error).toBeTruthy();
    expect(parseInput({ lines: [{ text: ' ' }] }).error).toMatch(/空白/);
    expect(parseInput({ lines: Array(13).fill({ text: 'a' }) }).error).toMatch(/12/);
  });
});

describe('assignSlots / buildVoiceRequest', () => {
  it('兩個說話者：各自一組聲音，用多角色設定，對白用角色名字', () => {
    const req = buildVoiceRequest(LINES, 'happy');
    const cfg = req.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
    expect(cfg.map((c) => c.speaker)).toEqual(['小美', '爸爸']);
    expect(cfg.map((c) => c.voiceConfig.prebuiltVoiceConfig.voiceName)).toEqual(['Leda', 'Charon']);
    expect(req.contents[0].parts[0].text).toContain('小美：爸爸回來了！\n爸爸：乖孩子，爸爸好想你。');
    expect(req.contents[0].parts[0].text).toContain('停頓一秒');
  });
  it('一個說話者：用單一聲音設定', () => {
    const req = buildVoiceRequest([{ text: '喵', speaker: '咪咪', voice: 'cat' }], 'calm');
    expect(req.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Leda');
  });
  it('超過兩個說話者：依小孩／大人、男／女併成兩組', () => {
    const { slots, slotOf } = assignSlots([
      { speaker: '小美', voice: 'girl' }, { speaker: '小明', voice: 'boy' }, { speaker: '爸爸', voice: 'man' }, { speaker: '旺財', voice: 'dog' },
    ]);
    expect(slots).toHaveLength(2);
    expect(slotOf['小美']).toBe(slotOf['小明']);
    expect(slotOf['旺財']).toBe(slotOf['小美']);
    expect(slotOf['爸爸']).not.toBe(slotOf['小美']);
  });
});

describe('切段', () => {
  it('取最長的停頓切開，句子裡的逗號不會被切斷', () => {
    const parts = splitByPauses(DIALOG, RATE, 4);
    expect(parts).toHaveLength(4);
    const lens = parts.map(secs);
    // 第 1 句 1.3 秒、第 2 句 0.9+0.3+0.9、第 3 句 1.0+0.3+1.2、第 4 句 1.6，各自加上前後保留的 0.08 秒
    [1.3, 2.1, 2.5, 1.6].forEach((want, i) => expect(Math.abs(lens[i] - want - 0.16)).toBeLessThan(0.1));
  });
  it('停頓不夠或分不出句間與句中停頓時拋出錯誤', () => {
    expect(() => splitByPauses(audio([[1, 1], [1, 0], [1, 1]]), RATE, 3)).toThrow(/SPLIT/);
    expect(() => splitByPauses(audio([[1, 1], [0.5, 0], [1, 1], [0.5, 0], [1, 1]]), RATE, 2)).toThrow(/分不開/);
  });
  it('去掉前後靜音', () => {
    expect(secs(trimSilence(audio([[0.8, 0], [1, 1], [1.2, 0]])))).toBeCloseTo(1.16, 1);
  });
  it('wav 去掉檔頭；沒有聲音時拋出錯誤', () => {
    const pcm = Buffer.from([1, 0, 2, 0]);
    const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(20), Buffer.from('data'), Buffer.alloc(4), pcm]);
    expect([...extractPcm({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] }).pcm]).toEqual([...pcm]);
    expect(() => extractPcm({ candidates: [{ finishReason: 'OTHER' }] })).toThrow(/OTHER/);
  });
});

describe('animateVoiceHandler', () => {
  it('整部動畫只送一個請求，切回每一句', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(DIALOG));
    const r = await animateVoiceHandler({ lines: LINES, mood: 'happy' }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(modelOf(fetchImpl.mock.calls[0][0])).toBe(VOICE_MODELS[0]);
    expect(r.body).toMatchObject({ available: true, model: VOICE_MODELS[0] });
    expect(r.body.clips).toHaveLength(4);
    expect(r.body.clips[0].sampleRate).toBe(RATE);
  });
  it('切不準（例如模型沒停頓）時換備援模型', async () => {
    const fetchImpl = vi.fn((url) => Promise.resolve(reply(modelOf(url) === VOICE_MODELS[0] ? audio([[6, 1]]) : DIALOG)));
    const r = await animateVoiceHandler({ lines: LINES }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.model).toBe(VOICE_MODELS[1]);
  });
  it('某句長度和字數不符（模型自己加詞）時判定失敗', async () => {
    const rambling = audio([[0.2, 0], [9, 1], [1, 0], [2, 1], [1, 0], [2.4, 1], [1, 0], [1.6, 1]]);
    const fetchImpl = vi.fn(async () => reply(rambling));
    const r = await animateVoiceHandler({ lines: LINES }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toMatch(/切不準/);
  });
  it('額度用完時說明，並提示改用瀏覽器語音', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('上游回應 429'));
    const r = await animateVoiceHandler({ lines: LINES }, { GEMINI_API_KEY: 'k' }, { geminiKey: 'mine' }, { fetchImpl });
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toMatch(/你的 Gemini 金鑰.*額度.*瀏覽器/);
  });
  it('沒有金鑰時提示填金鑰；輸入錯誤回 400', async () => {
    expect((await animateVoiceHandler({ lines: LINES }, {}, {})).body.reason).toMatch(/金鑰/);
    expect((await animateVoiceHandler({}, { GEMINI_API_KEY: 'k' })).status).toBe(400);
  });
});

describe('失敗說明', () => {
  it('第一個模型切不準、備援模型額度用完：說切段問題，不說額度', async () => {
    const fetchImpl = vi.fn(async (url) => { if (modelOf(url) === VOICE_MODELS[0]) return reply(audio([[6, 1]])); throw new Error('上游回應 429'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await animateVoiceHandler({ lines: LINES }, { GEMINI_API_KEY: 'k' }, {}, { fetchImpl });
    expect(r.body.reason).toMatch(/切不準/);
  });
});
