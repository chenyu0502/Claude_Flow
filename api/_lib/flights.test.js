// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, describeError, flightsHandler, normalizeResult, parseInput, resolveKey } from './flights.js';
import { extractJsonObject, groundingSources } from './gemini-search.js';

const INPUT = { airline: '中華航空', from: 'tpe', to: 'KIX', outDate: '2026-12-03', backDate: '2026-12-07' };

describe('parseInput', () => {
  it('整理輸入，機場代碼轉大寫', () => {
    expect(parseInput(INPUT).value).toEqual({ ...INPUT, from: 'TPE' });
  });
  it('拒絕缺少航空公司、錯誤代碼、相同起訖、錯誤日期', () => {
    expect(parseInput({ ...INPUT, airline: '' }).error).toMatch(/航空公司/);
    expect(parseInput({ ...INPUT, from: 'TAIPEI' }).error).toMatch(/三碼/);
    expect(parseInput({ ...INPUT, to: 'TPE' }).error).toMatch(/不同/);
    expect(parseInput({ ...INPUT, outDate: '12/3' }).error).toMatch(/出發日期/);
  });
  it('日期可以省略', () => {
    expect(parseInput({ ...INPUT, outDate: '', backDate: '' }).value).toBeTruthy();
  });
});

describe('buildPrompt', () => {
  it('要求查詢參考票價與託運行李', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('fareTwd');
    expect(p).toContain('baggage');
    expect(p).toMatch(/查不到就填 0，不要估算/);
  });
  it('包含航空公司、兩個方向與日期，並要求 JSON', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('「中華航空」');
    expect(p).toContain('2026-12-03，TPE → KIX');
    expect(p).toContain('2026-12-07，KIX → TPE');
    expect(p).toContain('```json');
  });
});

describe('normalizeResult', () => {
  it('捨棄不合理的班號、清掉格式錯誤的欄位與不安全的網址，並依起飛時間排序', () => {
    const r = normalizeResult({
      outbound: [
        { flightNo: 'ci 172', depart: '14:20', arrive: '17:50', durationMin: 150, source: 'https://a.example/x' },
        { flightNo: 'CI152', depart: '9:45', arrive: 'noon', source: 'javascript:alert(1)' },
        { flightNo: '隨便', depart: '10:00' },
      ],
      inbound: 'not-an-array',
      note: '依冬季班表',
    });
    expect(r.outbound.map((f) => f.flightNo)).toEqual(['CI152', 'CI172']);
    const ci152 = r.outbound.find((f) => f.flightNo === 'CI152');
    expect(ci152.arrive).toBe('');
    expect(ci152.source).toBe('');
    expect(r.inbound).toEqual([]);
    expect(r.note).toBe('依冬季班表');
  });
});

describe('normalizeResult：票價與行李', () => {
  it('保留合理的票價與行李，不合理的票價視為查不到', () => {
    const r = normalizeResult({ outbound: [
      { flightNo: 'CI152', depart: '09:45', fareTwd: 6800, fareNote: '官網促銷價', baggage: '託運 23 公斤 1 件' },
      { flightNo: 'IT210', depart: '06:40', fareTwd: '3,200' },
      { flightNo: 'IT212', depart: '15:15', fareTwd: 0, baggage: '基本票價不含託運，需加購' },
      { flightNo: 'JX820', depart: '07:40', fareTwd: 999999 },
    ] });
    const by = Object.fromEntries(r.outbound.map((f) => [f.flightNo, f]));
    expect(by.CI152).toMatchObject({ fareTwd: 6800, fareNote: '官網促銷價', baggage: '託運 23 公斤 1 件' });
    expect(by.IT210.fareTwd).toBeNull();
    expect(by.IT212.fareTwd).toBeNull();
    expect(by.IT212.baggage).toMatch(/不含託運/);
    expect(by.JX820.fareTwd).toBeNull();
  });
});

describe('resolveKey', () => {
  it('使用者的金鑰優先，其次伺服器的，都沒有時為 null', () => {
    expect(resolveKey({ GEMINI_API_KEY: 's' }, { geminiKey: 'u' })).toEqual({ apiKey: 'u', source: 'user' });
    expect(resolveKey({ GEMINI_API_KEY: 's' }, {})).toEqual({ apiKey: 's', source: 'server' });
    expect(resolveKey({}, {})).toBeNull();
  });
});

describe('describeError', () => {
  it('配額、搜尋不可用、地區、逾時各有可行動的說明', () => {
    expect(describeError(new Error('Gemini 回應 429：RESOURCE_EXHAUSTED'), 'server')).toMatch(/額度已用完/);
    expect(describeError(new Error('Gemini 回應 400：Search Grounding is not supported'), 'server')).toMatch(/不能使用 Google 搜尋/);
    expect(describeError(new Error('User location is not supported'), 'server')).toMatch(/地區/);
    expect(describeError(new Error('The operation was aborted'), 'user')).toMatch(/逾時/);
  });
});

describe('flightsHandler', () => {
  const env = { GEMINI_API_KEY: 'server-key' };
  const now = () => new Date('2026-11-23T10:00:00Z');

  it('輸入錯誤回 400，不呼叫 Gemini', async () => {
    const search = vi.fn();
    const res = await flightsHandler({ ...INPUT, from: 'X' }, env, {}, { search });
    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('沒有任何金鑰時回報無法查詢', async () => {
    const res = await flightsHandler(INPUT, {}, {}, { search: vi.fn() });
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/尚未設定/);
  });

  it('成功時回傳整理後的航班、來源與模型', async () => {
    const search = vi.fn(async () => ({
      data: { outbound: [{ flightNo: 'CI152', depart: '09:45', arrive: '13:20', source: 'https://a.example' }], inbound: [], note: 'n' },
      sources: [{ title: 'FlyTeam', uri: 'https://flyteam.jp/x' }],
      model: 'gemini-3.7-flash',
    }));
    const res = await flightsHandler(INPUT, env, {}, { search, now });
    expect(search.mock.calls[0][0].apiKey).toBe('server-key');
    expect(res.body).toMatchObject({ available: true, airline: '中華航空', model: 'gemini-3.7-flash', fetchedAt: '2026-11-23' });
    expect(res.body.outbound[0].flightNo).toBe('CI152');
    expect(res.body.sources).toHaveLength(1);
    expect(res.noStore).toBe(true);
  });

  it('上游失敗時回報原因，不丟出例外', async () => {
    const search = vi.fn(async () => { throw new Error('Gemini 回應 429：quota'); });
    const res = await flightsHandler(INPUT, env, {}, { search });
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/額度/);
  });
});

describe('gemini-search 解析', () => {
  it('取最後一個 JSON 區塊；沒有區塊時取大括號範圍', () => {
    expect(extractJsonObject('說明\n```json\n{"a":1}\n```\n再說明\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('結果如下 {"a":3} 以上')).toEqual({ a: 3 });
    expect(() => extractJsonObject('沒有資料')).toThrow(/JSON/);
  });
  it('來源去除重複與非 http 網址', () => {
    const c = { groundingMetadata: { groundingChunks: [
      { web: { uri: 'https://a.example', title: 'A' } },
      { web: { uri: 'https://a.example', title: 'A' } },
      { web: { uri: 'ftp://b', title: 'B' } },
    ] } };
    expect(groundingSources(c)).toEqual([{ title: 'A', uri: 'https://a.example' }]);
  });
});
