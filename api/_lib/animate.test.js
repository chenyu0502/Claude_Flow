// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ANIMATE_BUDGET_MS, ANIMATE_MODELS, ANIMATE_MODEL_TIMEOUT_MS, animateScriptHandler, buildPrompt, describeAnimateError, looksLikeScript, parseInput } from './animate.js';

const SCRIPT = { title: '測試', characters: [{ id: 'a', kind: 'cat' }], actions: [{ t: 0, who: 'a', do: 'jump' }], note: '兔子改成小狗' };

describe('parseInput', () => {
  it('整理輸入，長度只接受 8、12、16', () => {
    expect(parseInput({ prompt: ' 貓咪搶魚 ', duration: 16 }).value).toEqual({ prompt: '貓咪搶魚', duration: 16 });
    expect(parseInput({ prompt: '貓咪', duration: 99 }).value.duration).toBe(12);
    expect(parseInput({ prompt: '貓咪' }).value.duration).toBe(12);
  });
  it('拒絕空白與過長的描述', () => {
    expect(parseInput({ prompt: '  ' }).error).toMatch(/描述/);
    expect(parseInput({ prompt: '字'.repeat(301) }).error).toMatch(/300/);
  });
});

describe('buildPrompt / looksLikeScript', () => {
  it('提示詞帶故事與秒數', () => {
    const p = buildPrompt({ prompt: '小狗追球', duration: 8 });
    expect(p).toContain('小狗追球');
    expect(p).toContain('duration 填 8');
  });
  it('要有角色與動作才算劇本', () => {
    expect(looksLikeScript(SCRIPT)).toBe(true);
    expect(looksLikeScript({ characters: [], actions: [] })).toBe(false);
    expect(looksLikeScript(null)).toBe(false);
  });
});

describe('animateScriptHandler', () => {
  it('輸入錯誤回 400', async () => {
    expect((await animateScriptHandler({ prompt: '' }, { GEMINI_API_KEY: 'k' })).status).toBe(400);
  });
  it('沒有任何金鑰時回 available: false', async () => {
    const r = await animateScriptHandler({ prompt: '貓' }, {}, {});
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toMatch(/金鑰/);
  });
  it('優先用使用者的金鑰、不開搜尋，回傳劇本與 note，duration 以請求為準', async () => {
    const search = vi.fn().mockResolvedValue({ data: { ...SCRIPT, duration: 30 }, model: 'm1' });
    const r = await animateScriptHandler({ prompt: '貓', duration: 8 }, { GEMINI_API_KEY: 'server' }, { geminiKey: 'mine' }, { search });
    expect(search.mock.calls[0][0]).toMatchObject({ apiKey: 'mine', search: false });
    expect(r.body).toMatchObject({ available: true, note: '兔子改成小狗', model: 'm1' });
    expect(r.body.script.duration).toBe(8);
    expect(r.body.script.note).toBeUndefined();
  });
  it('用寫劇本專用的模型順序與單一模型時限，可用 ANIMATE_GEMINI_MODEL 指定第一個', async () => {
    const search = vi.fn().mockResolvedValue({ data: SCRIPT, model: 'm' });
    await animateScriptHandler({ prompt: '貓' }, { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'travel-only', ANIMATE_GEMINI_MODEL: 'x' }, {}, { search, now: () => 1000 });
    expect(search.mock.calls[0][0]).toMatchObject({ model: 'x', models: ANIMATE_MODELS, perModelTimeoutMs: ANIMATE_MODEL_TIMEOUT_MS, deadline: 1000 + ANIMATE_BUDGET_MS });
    expect(ANIMATE_MODELS[0]).not.toBe('gemini-3.7-flash');
  });
  it('重試和第一次共用截止時間，剩下的時間不夠就不重試', async () => {
    let t = 0;
    const search = vi.fn(async () => { t += 45000; return { data: { title: 'x' }, model: 'm' }; });
    const r = await animateScriptHandler({ prompt: '貓' }, { GEMINI_API_KEY: 'k' }, {}, { search, now: () => t });
    expect(search).toHaveBeenCalledTimes(1);
    expect(r.body.available).toBe(false);
  });
  it('第一次回不完整的劇本時重試一次', async () => {
    const search = vi.fn().mockResolvedValueOnce({ data: { title: 'x' }, model: 'm' }).mockResolvedValueOnce({ data: SCRIPT, model: 'm' });
    const r = await animateScriptHandler({ prompt: '貓' }, { GEMINI_API_KEY: 'k' }, {}, { search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(r.body.available).toBe(true);
  });
  it('兩次都不完整時說明請再試一次', async () => {
    const search = vi.fn().mockResolvedValue({ data: { title: 'x' }, model: 'm' });
    const r = await animateScriptHandler({ prompt: '貓' }, { GEMINI_API_KEY: 'k' }, {}, { search });
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toMatch(/再按一次/);
  });
  it('額度用完的說明不提 claude.ai', async () => {
    const search = vi.fn().mockRejectedValue(new Error('Gemini 回應 429：RESOURCE_EXHAUSTED'));
    const r = await animateScriptHandler({ prompt: '貓' }, { GEMINI_API_KEY: 'k' }, { geminiKey: 'mine' }, { search });
    expect(r.body.reason).toMatch(/你的 Gemini 金鑰/);
    expect(r.body.reason).not.toMatch(/claude\.ai/);
  });
  it('describeAnimateError 處理一般錯誤', () => {
    expect(describeAnimateError(new Error('boom'), 'server')).not.toMatch(/claude\.ai/);
  });
});
