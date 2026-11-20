import { act, fireEvent, render, screen } from '@testing-library/react';
import UpdateBanner, { hasNewVersion, POLL_INTERVAL_MS } from './UpdateBanner';

const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body } as Response);

describe('hasNewVersion', () => {
  it('伺服器版本不同 → true；相同 → false', async () => {
    expect(await hasNewVersion('aaa', respond({ buildId: 'bbb' }))).toBe(true);
    expect(await hasNewVersion('aaa', respond({ buildId: 'aaa' }))).toBe(false);
  });

  it('取不到、格式不對、離線都當成沒有新版（不誤報）', async () => {
    expect(await hasNewVersion('aaa', respond({}, false))).toBe(false);
    expect(await hasNewVersion('aaa', respond({ nope: 1 }))).toBe(false);
    expect(await hasNewVersion('aaa', respond('<!doctype html>'))).toBe(false);
    expect(await hasNewVersion('aaa', vi.fn().mockRejectedValue(new Error('offline')))).toBe(false);
  });

  it('請求帶時間戳並停用快取', async () => {
    const f = respond({ buildId: 'aaa' });
    await hasNewVersion('aaa', f);
    expect(f).toHaveBeenCalledWith(expect.stringMatching(/^\/version\.json\?t=\d+$/), { cache: 'no-store' });
  });
});

describe('UpdateBanner', () => {
  afterEach(() => vi.useRealTimers());

  it('有新版時顯示提示；按 × 收起', async () => {
    render(<UpdateBanner enabled buildId="old" fetchImpl={respond({ buildId: 'new' })} />);
    expect(await screen.findByText(/Claude Flow 有新版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '稍後再說' }));
    expect(screen.queryByText(/Claude Flow 有新版本/)).not.toBeInTheDocument();
  });

  it('版本相同不顯示；未啟用（開發模式）時完全不檢查', async () => {
    const same = respond({ buildId: 'v1' });
    render(<UpdateBanner enabled buildId="v1" fetchImpl={same} />);
    await act(async () => {});
    expect(same).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const off = respond({ buildId: 'v2' });
    render(<UpdateBanner enabled={false} buildId="v1" fetchImpl={off} />);
    await act(async () => {});
    expect(off).not.toHaveBeenCalled();
  });

  it('每 5 分鐘、以及切回分頁時再檢查', async () => {
    vi.useFakeTimers();
    const f = respond({ buildId: 'v1' });
    render(<UpdateBanner enabled buildId="v1" fetchImpl={f} />);
    await act(async () => {});
    expect(f).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(f).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(f).toHaveBeenCalledTimes(3);
  });
});
