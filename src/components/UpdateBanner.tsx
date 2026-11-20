import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/** 定時檢查的間隔。太短沒有意義，部署本身就要一兩分鐘。 */
export const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 伺服器上的版本是否和目前這份程式不同。
 * 取不到、格式不對都當成「沒有新版」：離線或暫時失敗不能誤報。
 */
export async function hasNewVersion(currentBuildId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    // 查詢字串加上時間戳並停用快取，否則檢查本身可能拿到快取的舊版本號。
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    const buildId = (data as { buildId?: unknown } | null)?.buildId;
    return typeof buildId === 'string' && buildId !== '' && buildId !== currentBuildId;
  } catch {
    return false;
  }
}

interface Props {
  /** 只在正式建置檢查：開發模式沒有 version.json（測試時可打開） */
  enabled?: boolean;
  buildId?: string;
  fetchImpl?: typeof fetch;
}

/**
 * 新版本提示列（見 vite-plugin-version.ts）。
 *
 * 載入時、每 5 分鐘、以及分頁重新回到前景時檢查。最後一項最重要：
 * 分頁放著好幾天再回來看是最常見的情境，只靠定時檢查會先看到舊畫面。
 *
 * 不自動重新載入：使用者可能正在填表單（例如修改密碼、個人資料），突然重整會讓輸入到一半的內容消失。
 */
export default function UpdateBanner({ enabled = import.meta.env.PROD, buildId = __BUILD_ID__, fetchImpl }: Props) {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const check = async () => {
      if (await hasNewVersion(buildId, fetchImpl)) {
        if (!cancelled) setHasUpdate(true);
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, buildId, fetchImpl]);

  if (!hasUpdate || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-inner">
        <span className="update-banner-text">Claude Flow 有新版本，重新整理後才會套用最新內容。</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={14} aria-hidden="true" /> 立即更新
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => setDismissed(true)}
          aria-label="稍後再說"
          title="稍後再說"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
