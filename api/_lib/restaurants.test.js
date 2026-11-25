// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, normalizeResult, parseInput, restaurantsHandler } from './restaurants.js';

const INPUT = { area: '祇園', city: '京都', date: '2026-12-04', time: '11:45', meal: '午餐', cuisine: '京料理', budgetPerPersonTwd: 1500, diet: '不吃牛', adults: 2, seniors: 1, kids: 0 };

describe('parseInput', () => {
  it('整理輸入', () => {
    expect(parseInput(INPUT).value).toMatchObject({ area: '祇園', meal: '午餐', diet: '不吃牛', seniors: 1 });
  });
  it('拒絕缺少地點、錯誤日期與時間、不支援的用餐時段、人數不合理', () => {
    expect(parseInput({ ...INPUT, area: '' }).error).toMatch(/地區或景點/);
    expect(parseInput({ ...INPUT, date: '12/4' }).error).toMatch(/日期/);
    expect(parseInput({ ...INPUT, time: '中午' }).error).toMatch(/時間/);
    expect(parseInput({ ...INPUT, meal: '點心' }).error).toMatch(/用餐時段/);
    expect(parseInput({ ...INPUT, adults: 0, seniors: 0 }).error).toMatch(/人數/);
  });
});

describe('buildPrompt', () => {
  it('包含地點、時段、人數、料理、預算與飲食限制，並要求訂位資訊與 JSON', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('「京都 祇園」');
    expect(p).toContain('2026-12-04 11:45（午餐）');
    expect(p).toContain('長輩（65 歲以上）1');
    expect(p).toContain('京料理');
    expect(p).toContain('飲食限制：不吃牛');
    expect(p).toContain('reservation');
    expect(p).toContain('```json');
  });
});

describe('normalizeResult', () => {
  it('整理價位、評比、訂位狀態、管道與網址', () => {
    const r = normalizeResult({ restaurants: [
      { name: '祇園 京料理 A', priceMin: 5000, priceMax: 3000, currency: 'jpy', partyEstimateTwd: 2500,
        ratings: [{ site: 'Tabelog', score: 3.6, outOf: 5, reviews: 320 }, { site: 'Google', score: 9, outOf: 5 }],
        reservation: 'required', bookingWindow: '1 個月前開放', channels: [{ name: 'Tabelog', url: 'https://tabelog.com/x' }, { name: '壞', url: 'javascript:1' }], source: 'https://a.example' },
      { name: '無價格店', reservation: '亂寫', priceMin: 0, currency: 'JPY', source: 'ftp://x' },
      { name: '' },
    ] });
    expect(r.restaurants).toHaveLength(2);
    expect(r.restaurants[0]).toMatchObject({ priceMin: 3000, priceMax: 5000, currency: 'JPY', partyEstimateTwd: 2500, reservation: 'required' });
    expect(r.restaurants[0].ratings).toEqual([{ site: 'Tabelog', score: 3.6, outOf: 5, reviews: 320 }]);
    expect(r.restaurants[0].channels).toHaveLength(1);
    expect(r.restaurants[1]).toMatchObject({ reservation: 'walkin', priceMin: null, currency: '', source: '' });
  });
});

describe('restaurantsHandler', () => {
  const env = { GEMINI_API_KEY: 'k' };
  it('輸入錯誤回 400，不呼叫 Gemini', async () => {
    const search = vi.fn();
    expect((await restaurantsHandler({ ...INPUT, area: '' }, env, {}, { search })).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it('沒有金鑰時回報無法查詢', async () => {
    expect((await restaurantsHandler(INPUT, {}, {}, { search: vi.fn() })).body.available).toBe(false);
  });
  it('成功時回傳餐廳、查詢條件與來源', async () => {
    const search = vi.fn(async () => ({ data: { restaurants: [{ name: 'A', reservation: 'recommended' }] }, sources: [], model: 'm' }));
    const res = await restaurantsHandler(INPUT, env, {}, { search, now: () => new Date('2026-11-25T00:00:00Z') });
    expect(res.body).toMatchObject({ available: true, area: '祇園', date: '2026-12-04', time: '11:45', meal: '午餐', fetchedAt: '2026-11-25' });
    expect(res.body.restaurants[0].name).toBe('A');
  });
  it('上游失敗時回報原因，不丟出例外', async () => {
    const search = vi.fn(async () => { throw new Error('Gemini 回應 429：quota'); });
    expect((await restaurantsHandler(INPUT, env, {}, { search })).body.reason).toMatch(/額度/);
  });
});
