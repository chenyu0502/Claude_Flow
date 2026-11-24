// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, hotelsHandler, nightsOf, normalizeResult, parseInput } from './hotels.js';

const INPUT = { area: '京都站', city: '京都', checkIn: '2026-12-03', checkOut: '2026-12-06', adults: 2, seniors: 1, kids: 0, level: '舒適', budgetPerNight: 8000 };

describe('parseInput', () => {
  it('整理輸入', () => {
    expect(parseInput(INPUT).value).toMatchObject({ area: '京都站', checkIn: '2026-12-03', checkOut: '2026-12-06', adults: 2, seniors: 1 });
  });
  it('拒絕缺少地點、錯誤日期、退房早於入住、人數不合理', () => {
    expect(parseInput({ ...INPUT, area: '' }).error).toMatch(/地區或景點/);
    expect(parseInput({ ...INPUT, checkIn: '12/3' }).error).toMatch(/入住日期/);
    expect(parseInput({ ...INPUT, checkOut: '2026-12-03' }).error).toMatch(/晚於/);
    expect(parseInput({ ...INPUT, adults: 0, seniors: 0 }).error).toMatch(/人數/);
    expect(parseInput({ ...INPUT, adults: 30 }).error).toMatch(/人數/);
  });
  it('日期可以省略', () => {
    expect(parseInput({ ...INPUT, checkIn: '', checkOut: '' }).value).toBeTruthy();
  });
});

describe('buildPrompt', () => {
  it('包含地點、晚數、旅伴、預算，並要求全體每晚價格與 JSON', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('「京都 京都站」');
    expect(p).toContain('（3 晚）');
    expect(p).toContain('長輩（65 歲以上）1');
    expect(p).toContain('8000');
    expect(p).toContain('全體每晚');
    expect(p).toContain('```json');
  });
  it('晚數計算', () => {
    expect(nightsOf('2026-12-03', '2026-12-06')).toBe(3);
    expect(nightsOf('', '2026-12-06')).toBe(0);
  });
});

describe('normalizeResult', () => {
  it('捨棄沒有名稱的飯店，清掉不合理的數字與不安全的網址', () => {
    const r = normalizeResult({ hotels: [
      { name: 'MIMARU 京都站', pricePerNightTwd: 7800, rooms: 1, rating: 8.9, walkMin: 5, source: 'https://a.example' },
      { name: '', pricePerNightTwd: 5000 },
      { name: '某旅館', pricePerNightTwd: -1, rating: 99, walkMin: 999, rooms: 0, source: 'javascript:alert(1)' },
    ], note: 'n' });
    expect(r.hotels).toHaveLength(2);
    expect(r.hotels[0]).toMatchObject({ name: 'MIMARU 京都站', pricePerNightTwd: 7800, rating: 8.9, walkMin: 5, rooms: 1 });
    expect(r.hotels[1]).toMatchObject({ pricePerNightTwd: null, rating: null, walkMin: null, rooms: 1, source: '' });
  });
});

describe('hotelsHandler', () => {
  const env = { GEMINI_API_KEY: 'k' };
  it('輸入錯誤回 400，不呼叫 Gemini', async () => {
    const search = vi.fn();
    const res = await hotelsHandler({ ...INPUT, area: '' }, env, {}, { search });
    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it('沒有金鑰時回報無法查詢', async () => {
    const res = await hotelsHandler(INPUT, {}, {}, { search: vi.fn() });
    expect(res.body).toMatchObject({ available: false });
  });
  it('成功時回傳整理後的飯店、日期與來源', async () => {
    const search = vi.fn(async () => ({ data: { hotels: [{ name: 'A', pricePerNightTwd: 6000 }] }, sources: [{ title: 'x', uri: 'https://x' }], model: 'm' }));
    const res = await hotelsHandler(INPUT, env, {}, { search, now: () => new Date('2026-11-24T00:00:00Z') });
    expect(res.body).toMatchObject({ available: true, area: '京都站', checkIn: '2026-12-03', checkOut: '2026-12-06', fetchedAt: '2026-11-24', model: 'm' });
    expect(res.body.hotels[0].name).toBe('A');
  });
  it('上游失敗時回報原因，不丟出例外', async () => {
    const search = vi.fn(async () => { throw new Error('Gemini 回應 429：quota'); });
    const res = await hotelsHandler(INPUT, env, {}, { search });
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/額度/);
  });
});
