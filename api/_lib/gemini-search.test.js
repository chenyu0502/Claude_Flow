// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, rankModels, resetModelMemory, searchJson, usableModel } from './gemini-search.js';
import { describeError, modelNote } from './flights.js';

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

describe('額度用完時自動換模型', () => {
  const quota = () => new Response(JSON.stringify({ error: { message: 'Resource has been exhausted (e.g. check quota). Quota exceeded for metric: generate_content_free_tier_requests, PerDay' } }), { status: 429 });
  const list = (names) => new Response(JSON.stringify({ models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: [n.includes('embed') ? 'embedContent' : 'generateContent'] })) }), { status: 200 });
  const isList = (url) => /\/models\?/.test(String(url));
  afterEach(() => resetModelMemory());

  it('只留查詢用的模型，版本新的與 flash 優先、pro 最後', () => {
    expect(['gemini-3.7-flash', 'gemini-3.7-flash-preview-tts', 'text-embedding-004', 'gemini-3.7-flash-image', 'gemini-2.5-pro', 'gemma-3-27b-it'].filter(usableModel))
      .toEqual(['gemini-3.7-flash', 'gemini-2.5-pro']);
    expect(rankModels(['gemini-2.5-pro', 'gemini-3.6-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.7-pro']))
      .toEqual(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.7-pro', 'gemini-2.5-pro']);
  });

  it('預設模型都用完時，改試金鑰可用的其他模型並記下原本的模型', async () => {
    const fetch = vi.fn(async (url) => {
      if (isList(url)) return list(['gemini-3.8-flash-lite', 'gemini-3.7-flash', 'text-embedding-004']);
      return modelOf(url) === 'gemini-3.8-flash-lite' ? ok({ x: 1 }) : quota();
    });
    vi.stubGlobal('fetch', fetch);
    const r = await searchJson({ apiKey: 'k1', systemInstruction: 's', prompt: 'p' });
    expect(r).toMatchObject({ data: { x: 1 }, model: 'gemini-3.8-flash-lite', fallbackFrom: DEFAULT_MODEL });
    const tried = fetch.mock.calls.filter(([u]) => !isList(u)).map(([u]) => modelOf(u));
    expect(tried[0]).toBe(DEFAULT_MODEL);
    expect(tried.at(-1)).toBe('gemini-3.8-flash-lite');
    expect(fetch.mock.calls.some(([u]) => /embedding/.test(String(u)))).toBe(false);
  });

  it('下一次查詢先試還有額度的模型，不再浪費時間在用完的模型', async () => {
    let n = 0;
    const fetch = vi.fn(async (url) => {
      if (isList(url)) return list(['gemini-3.8-flash-lite']);
      n += 1;
      return modelOf(url) === 'gemini-3.8-flash-lite' ? ok({ y: 2 }) : quota();
    });
    vi.stubGlobal('fetch', fetch);
    await searchJson({ apiKey: 'k2', systemInstruction: 's', prompt: 'p' });
    const first = n; n = 0;
    const r = await searchJson({ apiKey: 'k2', systemInstruction: 's', prompt: 'p' });
    expect(first).toBeGreaterThan(1);
    expect(n).toBe(1);
    expect(r.model).toBe('gemini-3.8-flash-lite');
    expect(fetch.mock.calls.filter(([u]) => isList(u))).toHaveLength(1); // 模型清單有快取
  });

  it('全部用完時說明試過幾個模型；列不出模型清單也照常用預設備援鏈', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (isList(url) ? new Response('x', { status: 500 }) : quota())));
    const err = await searchJson({ apiKey: 'k3', systemInstruction: 's', prompt: 'p' }).catch((e) => e);
    expect(err.triedModels).toHaveLength(4);
    expect(describeError(err, 'user')).toMatch(/已自動改試 4 個模型.*額度已用完.*清除改用網站共用金鑰/);
    expect(describeError(err, 'server')).toMatch(/改用自己的金鑰/);
  });

  it('自訂 models（例如動畫腳本）不加入其他模型', async () => {
    const fetch = vi.fn(async () => ok({ z: 1 }));
    vi.stubGlobal('fetch', fetch);
    await searchJson({ apiKey: 'k4', models: ['m1'], systemInstruction: 's', prompt: 'p', search: false });
    expect(fetch.mock.calls.some(([u]) => isList(u))).toBe(false);
  });

  it('改用備援模型時，結果說明開頭註記', () => {
    expect(modelNote('', { model: 'b' })).toBe('');
    expect(modelNote('原說明', { model: 'b', fallbackFrom: 'a' })).toBe('（a 額度用完或暫時無法使用，本次自動改用 b 查詢） 原說明');
  });
});
