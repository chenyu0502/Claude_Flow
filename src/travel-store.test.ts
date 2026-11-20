import { describe, expect, it } from 'vitest';
import { serializeTrip, tripTitle, TRIP_JSON_MAX, TRIP_TITLE_MAX } from './travel-store';

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
