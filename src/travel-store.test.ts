import { describe, expect, it } from 'vitest';
import { checkGeminiKey, searchFlights, searchHotels, searchRestaurants, searchTickets, searchTransport, serializeTrip, tripTitle, TRIP_JSON_MAX, TRIP_TITLE_MAX } from './travel-store';

describe('tripTitle', () => {
  it('取行程的標題並去除前後空白', () => {
    expect(tripTitle({ title: '  京都 5 日 ' })).toBe('京都 5 日');
  });

  it('沒有標題或不是字串時用預設名稱', () => {
    expect(tripTitle({})).toBe('未命名行程');
    expect(tripTitle({ title: 123 })).toBe('未命名行程');
    expect(tripTitle(null)).toBe('未命名行程');
  });

  it('截到規則允許的長度', () => {
    expect(tripTitle({ title: '長'.repeat(200) })).toHaveLength(TRIP_TITLE_MAX);
  });
});

describe('serializeTrip', () => {
  it('轉成 JSON 字串', () => {
    expect(JSON.parse(serializeTrip({ title: 'x', days: 3 }))).toEqual({ title: 'x', days: 3 });
  });

  it('空內容直接報錯', () => {
    expect(() => serializeTrip(null)).toThrow(/空/);
    expect(() => serializeTrip(undefined)).toThrow(/空/);
  });

  it('超過上限時報錯，不送出注定被規則拒絕的寫入', () => {
    expect(() => serializeTrip({ note: 'x'.repeat(TRIP_JSON_MAX) })).toThrow(/太大/);
  });
});

describe('searchFlights', () => {
  const params = { airline: '中華航空', from: 'TPE', to: 'KIX', outDate: '2026-12-03', backDate: '2026-12-07' };
  const json = (status: number, body: unknown) =>
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);

  it('帶登入憑證呼叫 /api/travel/flights，回傳結果', async () => {
    const fetchImpl = json(200, { available: true, airline: '中華航空', outbound: [], inbound: [] });
    const r = await searchFlights(async () => 'tok', params, fetchImpl);
    expect(r.available).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/travel/flights');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual(params);
  });

  it('伺服器回錯誤時轉成可讀的原因，不丟出例外', async () => {
    const r = await searchFlights(async () => 'tok', params, json(401, { error: '請先登入' }));
    expect(r).toEqual({ available: false, reason: '請先登入' });
  });

  it('取不到登入憑證或連不上伺服器時回報原因', async () => {
    expect((await searchFlights(async () => { throw new Error('x'); }, params, json(200, {}))).reason).toMatch(/登入狀態/);
    const down = vi.fn(async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect((await searchFlights(async () => 'tok', params, down)).reason).toMatch(/連不上/);
  });
});

describe('searchHotels', () => {
  it('呼叫 /api/travel/hotels 並帶登入憑證', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ available: true, hotels: [] }) }) as unknown as Response);
    const r = await searchHotels(async () => 'tok', { area: '京都站', adults: 2 }, fetchImpl);
    expect(r.available).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/travel/hotels');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});

describe('searchTickets', () => {
  it('呼叫 /api/travel/tickets 並帶登入憑證', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ available: true, attractions: [] }) }) as unknown as Response);
    const r = await searchTickets(async () => 'tok', { attractions: [{ name: '清水寺' }], adults: 2 }, fetchImpl);
    expect(r.available).toBe(true);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/travel/tickets');
  });
});

describe('searchTransport', () => {
  it('呼叫 /api/travel/transport 並帶登入憑證', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ available: true, passes: [] }) }) as unknown as Response);
    const r = await searchTransport(async () => 'tok', { legs: [{ day: 1, title: 'x' }], adults: 2 }, fetchImpl);
    expect(r.available).toBe(true);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/travel/transport');
  });
});

describe('searchRestaurants', () => {
  it('呼叫 /api/travel/restaurants 並帶登入憑證', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ available: true, restaurants: [] }) }) as unknown as Response);
    const r = await searchRestaurants(async () => 'tok', { area: '祇園', adults: 2 }, fetchImpl);
    expect(r.available).toBe(true);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/travel/restaurants');
  });
});

describe('使用者自己的 Gemini 金鑰', () => {
  const ok = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
  const headersOf = (f: ReturnType<typeof ok>) => (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

  it('有金鑰時放在 X-Gemini-Key 標頭，不放進請求內容', async () => {
    const fetchImpl = ok({ available: true });
    await searchHotels(async () => 'tok', { area: '京都站', adults: 2 }, fetchImpl, { geminiKey: 'AIzaUserKey_1234567890' });
    expect(headersOf(fetchImpl)['X-Gemini-Key']).toBe('AIzaUserKey_1234567890');
    expect(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain('AIzaUserKey');
  });

  it('沒有金鑰時不帶這個標頭', async () => {
    const fetchImpl = ok({ available: true });
    await searchFlights(async () => 'tok', { airline: 'x', from: 'TPE', to: 'KIX' }, fetchImpl);
    expect(headersOf(fetchImpl)).not.toHaveProperty('X-Gemini-Key');
  });

  it('checkGeminiKey 回報有效或無效的原因', async () => {
    expect(await checkGeminiKey(async () => 'tok', 'k', ok({ ok: true, models: 5, hasDefault: true }))).toEqual({ ok: true, models: 5, hasDefault: true });
    expect(await checkGeminiKey(async () => 'tok', 'k', ok({ ok: false, reason: '金鑰無效' }))).toEqual({ ok: false, reason: '金鑰無效' });
  });
});
