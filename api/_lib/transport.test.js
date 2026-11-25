// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, MAX_LEGS, normalizeResult, parseInput, transportHandler } from './transport.js';

const INPUT = {
  city: '京都・大阪',
  legs: [
    { day: 1, date: '2026-12-03', from: '関西空港駅', to: '京都駅', mode: 'JR 特急 HARUKA', title: 'JR 特急 HARUKA' },
    { day: 3, date: '2026-12-05', from: '京都駅', to: '嵯峨嵐山駅', mode: 'transit' },
    { day: 5, title: '南海電鐵 rapi:t 特急' },
    { day: 2, from: '', to: '', title: '' },
  ],
  adults: 2, seniors: 1, kids: 0,
  knownPasses: ['ICOCA & HARUKA', 'ICOCA 交通卡'],
};

describe('parseInput', () => {
  it('整理移動段，捨棄沒有內容的，日期格式錯誤清空', () => {
    const v = parseInput(INPUT).value;
    expect(v.legs).toHaveLength(3);
    expect(v.legs[0]).toMatchObject({ day: 1, date: '2026-12-03', from: '関西空港駅', to: '京都駅' });
    expect(v.legs[2]).toMatchObject({ day: 5, date: '', title: '南海電鐵 rapi:t 特急' });
    expect(v.knownPasses).toEqual(['ICOCA & HARUKA', 'ICOCA 交通卡']);
  });
  it('拒絕沒有移動段、超過上限、人數不合理', () => {
    expect(parseInput({ ...INPUT, legs: [] }).error).toMatch(/沒有可以分析/);
    expect(parseInput({ ...INPUT, legs: Array.from({ length: MAX_LEGS + 1 }, () => ({ title: 'x' })) }).error).toMatch(/最多/);
    expect(parseInput({ ...INPUT, adults: 0, seniors: 0 }).error).toMatch(/人數/);
  });
});

describe('buildPrompt', () => {
  it('列出每天的移動段、旅客與原本的票券，並要求比較單買與 JSON', () => {
    const p = buildPrompt(parseInput(INPUT).value);
    expect(p).toContain('Day 1（2026-12-03）：関西空港駅 → 京都駅（JR 特急 HARUKA）');
    expect(p).toContain('Day 5：南海電鐵 rapi:t 特急');
    expect(p).toContain('ICOCA & HARUKA、ICOCA 交通卡');
    expect(p).toContain('savingsNote');
    expect(p).toContain('strategy');
    expect(p).toContain('```json');
  });
});

describe('normalizeResult', () => {
  it('整理類型、建議、使用天數、價格、合計與網址', () => {
    const r = normalizeResult({ strategy: '買 ICOCA & HARUKA', strategyTotalTwd: 3200, passes: [
      { name: 'ICOCA & HARUKA', type: 'airport', verdict: 'recommended', useDays: [1, 1, 99, '3'], priceTypes: [{ label: '成人', price: 3800, currency: 'jpy' }, { label: '', price: 1, currency: 'JPY' }],
        partyTotalTwd: 2394, needReservation: false, channels: [{ name: '官網', url: 'https://www.westjr.co.jp/' }, { name: '壞', url: 'javascript:1' }], source: 'https://a.example' },
      { name: '關西廣域周遊券', type: '亂寫', verdict: '亂寫', partyTotalTwd: -1, source: 'ftp://x' },
      { type: 'pass' },
    ] });
    expect(r.strategyTotalTwd).toBe(3200);
    expect(r.passes).toHaveLength(2);
    expect(r.passes[0]).toMatchObject({ type: 'airport', verdict: 'recommended', useDays: [1, 3], partyTotalTwd: 2394 });
    expect(r.passes[0].priceTypes).toEqual([{ label: '成人', price: 3800, currency: 'JPY' }]);
    expect(r.passes[0].channels).toHaveLength(1);
    expect(r.passes[1]).toMatchObject({ type: 'pass', verdict: 'optional', partyTotalTwd: null, source: '' });
  });
});

describe('transportHandler', () => {
  const env = { GEMINI_API_KEY: 'k' };
  it('輸入錯誤回 400，不呼叫 Gemini', async () => {
    const search = vi.fn();
    expect((await transportHandler({ ...INPUT, legs: [] }, env, {}, { search })).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it('沒有金鑰時回報無法查詢', async () => {
    expect((await transportHandler(INPUT, {}, {}, { search: vi.fn() })).body.available).toBe(false);
  });
  it('成功時回傳策略、票券與來源', async () => {
    const search = vi.fn(async () => ({ data: { strategy: 's', passes: [{ name: 'ICOCA', type: 'ic', verdict: 'recommended' }] }, sources: [], model: 'm' }));
    const res = await transportHandler(INPUT, env, {}, { search, now: () => new Date('2026-11-25T00:00:00Z') });
    expect(res.body).toMatchObject({ available: true, strategy: 's', fetchedAt: '2026-11-25' });
    expect(res.body.passes[0]).toMatchObject({ name: 'ICOCA', type: 'ic' });
  });
  it('上游失敗時回報原因，不丟出例外', async () => {
    const search = vi.fn(async () => { throw new Error('Gemini 回應 429：quota'); });
    expect((await transportHandler(INPUT, env, {}, { search })).body.reason).toMatch(/額度/);
  });
});
