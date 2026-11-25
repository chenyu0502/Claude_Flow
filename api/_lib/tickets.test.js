// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, MAX_ATTRACTIONS, normalizeResult, parseInput, ticketsHandler } from './tickets.js';

const INPUT = {
  city: '京都',
  attractions: [
    { name: '清水寺', date: '2026-12-04', place: '東山' },
    { name: '嵯峨野觀光小火車', date: '2026-12-05' },
  ],
  adults: 2, seniors: 1, kids: 0,
};

describe('parseInput', () => {
  it('整理景點清單，去除重複與空白名稱，錯誤日期清空', () => {
    const v = parseInput({ ...INPUT, attractions: [...INPUT.attractions, { name: '清水寺' }, { name: ' ' }, { name: '伏見稻荷大社', date: '12/6' }] }).value;
    expect(v.attractions.map((a) => a.name)).toEqual(['清水寺', '嵯峨野觀光小火車', '伏見稻荷大社']);
    expect(v.attractions[2].date).toBe('');
  });
  it('拒絕沒有景點、超過上限、人數不合理', () => {
    expect(parseInput({ ...INPUT, attractions: [] }).error).toMatch(/至少一個/);
    expect(parseInput({ ...INPUT, attractions: Array.from({ length: MAX_ATTRACTIONS + 1 }, (_, i) => ({ name: `景點${i}` })) }).error).toMatch(/最多/);
    expect(parseInput({ ...INPUT, adults: 0, seniors: 0 }).error).toMatch(/人數/);
  });
});

describe('buildPrompt', () => {
  it('列出每個景點與日期、旅客組成，並要求預約狀態、開賣規則與 JSON', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('1. 清水寺（東山）：2026-12-04');
    expect(p).toContain('2. 嵯峨野觀光小火車：2026-12-05');
    expect(p).toContain('長輩（65 歲以上）1');
    expect(p).toContain('"required"');
    expect(p).toContain('bookingWindow');
    expect(p).toContain('```json');
  });
});

describe('normalizeResult', () => {
  it('整理狀態、票種、合計、購買管道與網址', () => {
    const r = normalizeResult({ attractions: [
      { name: '嵯峨野觀光小火車', status: 'required', ticketTypes: [{ label: '成人', price: 880, currency: 'jpy' }, { label: '兒童', price: 440, currency: 'JPY' }, { label: '', price: 1, currency: 'JPY' }, { label: '錯誤', price: 100, currency: '日圓' }],
        partyTotalTwd: 555, timeSlot: true, bookingWindow: '乘車日前 1 個月 10:00 開賣',
        channels: [{ name: '官網', url: 'https://www.sagano-kanko.co.jp/' }, { name: '壞', url: 'javascript:alert(1)' }], source: 'https://a.example' },
      { name: '八坂神社', status: 'free', ticketTypes: [{ label: '成人', price: 0, currency: 'JPY' }], partyTotalTwd: 300 },
      { name: '不明景點', status: '亂寫', partyTotalTwd: -5, source: 'ftp://x' },
      { status: 'onsite' },
    ], note: 'n' });
    expect(r.attractions).toHaveLength(3);
    const [a, b, c] = r.attractions;
    expect(a).toMatchObject({ status: 'required', partyTotalTwd: 555, timeSlot: true, bookingWindow: '乘車日前 1 個月 10:00 開賣' });
    expect(a.ticketTypes).toEqual([{ label: '成人', price: 880, currency: 'JPY' }, { label: '兒童', price: 440, currency: 'JPY' }]);
    expect(a.channels).toEqual([{ name: '官網', url: 'https://www.sagano-kanko.co.jp/' }]);
    expect(b).toMatchObject({ status: 'free', ticketTypes: [], partyTotalTwd: null });
    expect(c).toMatchObject({ status: 'onsite', partyTotalTwd: null, source: '' });
  });
});

describe('ticketsHandler', () => {
  const env = { GEMINI_API_KEY: 'k' };
  it('輸入錯誤回 400，不呼叫 Gemini', async () => {
    const search = vi.fn();
    expect((await ticketsHandler({ ...INPUT, attractions: [] }, env, {}, { search })).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it('沒有金鑰時回報無法查詢', async () => {
    expect((await ticketsHandler(INPUT, {}, {}, { search: vi.fn() })).body.available).toBe(false);
  });
  it('成功時回傳整理後的景點與來源', async () => {
    const search = vi.fn(async () => ({ data: { attractions: [{ name: '清水寺', status: 'onsite', ticketTypes: [{ label: '成人', price: 500, currency: 'JPY' }], partyTotalTwd: 315 }] }, sources: [{ title: 's', uri: 'https://s' }], model: 'm' }));
    const res = await ticketsHandler(INPUT, env, {}, { search, now: () => new Date('2026-11-25T00:00:00Z') });
    expect(res.body).toMatchObject({ available: true, fetchedAt: '2026-11-25', model: 'm' });
    expect(res.body.attractions[0]).toMatchObject({ name: '清水寺', partyTotalTwd: 315 });
  });
  it('上游失敗時回報原因，不丟出例外', async () => {
    const search = vi.fn(async () => { throw new Error('Gemini 回應 429：quota'); });
    const res = await ticketsHandler(INPUT, env, {}, { search });
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/額度/);
  });
});
