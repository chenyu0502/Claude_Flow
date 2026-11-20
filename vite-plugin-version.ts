/**
 * 產生版本識別碼，讓前端偵測到新版部署（src/components/UpdateBanner.tsx）。
 *
 * 建置時把識別碼同時寫進兩個地方：
 * 1. 編譯進程式的 __BUILD_ID__ 常數，代表「這份程式碼是哪一版」
 * 2. dist/version.json，代表「伺服器上目前是哪一版」
 * 前端比對兩者，不同就表示有新版可載入。
 *
 * 需要這個機制的原因：Claude Flow 是單頁應用程式，分頁開著時在站內切換頁面不會重新載入程式，
 * 網站更新後，已經開著的分頁會一直停在舊版（實際發生過：新增旅遊規劃後，舊分頁的首頁看不到）。
 */
import type { Plugin } from 'vite';

/** Vercel 提供 commit SHA，最精確；本機建置沒有，改用時間戳，同樣能區分不同次建置。 */
export function resolveBuildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 12) : `local-${Date.now()}`;
}

export default function versionPlugin(buildId: string): Plugin {
  return {
    name: 'build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
      });
    },
  };
}
