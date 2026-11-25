// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { keyCheckHandler } from './keycheck.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const KEY = 'AIzaSyTestKey_0123456789abcdef';

describe('keyCheckHandler', () => {
  it('沒有金鑰（或格式不對）時不呼叫 Google', async () => {
    const fetchImpl = vi.fn();
    const r = await keyCheckHandler({}, {}, { geminiKey: null }, { fetchImpl });
    expect(r.body).toMatchObject({ ok: false });
    expect(r.body.reason).toMatch(/格式不正確/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('有效的金鑰：回報可用的 Gemini 模型數，金鑰放在標頭', async () => {
    const fetchImpl = reply(200, { models: [
      { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] });
    const r = await keyCheckHandler({}, {}, { geminiKey: KEY }, { fetchImpl });
    expect(r.body).toEqual({ ok: true, models: 2, hasDefault: true });
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe(KEY);
    expect(fetchImpl.mock.calls[0][0]).not.toContain(KEY);
  });

  it('無效、無權限、地區限制、額度用盡各有說明', async () => {
    const cases = [
      [reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), /無效/],
      [reply(403, { error: { message: 'Permission denied' } }), /權限/],
      [reply(400, { error: { message: 'User location is not supported for the API use.' } }), /地區/],
      [reply(429, { error: { message: 'quota' } }), /上限/],
      [reply(200, { models: [] }), /看不到任何 Gemini 模型/],
    ];
    for (const [fetchImpl, re] of cases) {
      const r = await keyCheckHandler({}, {}, { geminiKey: KEY }, { fetchImpl });
      expect(r.body.ok).toBe(false);
      expect(r.body.reason).toMatch(re);
    }
  });

  it('連不上 Google 時回報，不丟出例外', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network'); });
    const r = await keyCheckHandler({}, {}, { geminiKey: KEY }, { fetchImpl });
    expect(r.body.reason).toMatch(/連不上/);
  });
});
