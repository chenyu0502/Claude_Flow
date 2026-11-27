// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchJson } from './gemini-search.js';

const ok = (obj) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
/** 模擬一直不回應的模型：只有被中止（逾時）時才結束 */
const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted'))));
const modelOf = (url) => decodeURIComponent(String(url).match(/models\/([^:]+):/)[1]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('searchJson 的模型順序與時間', () => {
  it('models 取代預設順序，model 排第一', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ a: 1 }));
    vi.stubGlobal('fetch', fetch);
    const r = await searchJson({ apiKey: 'k', models: ['m1', 'm2'], model: 'm2', systemInstruction: 's', prompt: 'p', search: false });
    expect(modelOf(fetch.mock.calls[0][0])).toBe('m2');
    expect(r).toMatchObject({ data: { a: 1 }, model: 'm2' });
  });

  it('第一個模型卡住時，在 perModelTimeoutMs 後換下一個', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((url, init) => (modelOf(url) === 'slow' ? hang(url, init) : Promise.resolve(ok({ b: 2 }))));
    vi.stubGlobal('fetch', fetch);
    const p = searchJson({ apiKey: 'k', models: ['slow', 'fast'], systemInstruction: 's', prompt: 'p', search: false, perModelTimeoutMs: 22000 });
    await vi.advanceTimersByTimeAsync(22000);
    await expect(p).resolves.toMatchObject({ data: { b: 2 }, model: 'fast' });
    expect(fetch.mock.calls.map(([u]) => modelOf(u))).toEqual(['slow', 'fast']);
  });

  it('呼叫端的 deadline 比預算短時，以 deadline 為準', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(hang));
    const p = searchJson({ apiKey: 'k', models: ['a', 'b', 'c'], systemInstruction: 's', prompt: 'p', search: false, perModelTimeoutMs: 22000, deadline: Date.now() + 20000 });
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await caught).toBeInstanceOf(Error);
  });
});
