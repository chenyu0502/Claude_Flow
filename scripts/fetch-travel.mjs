/**
 * 抓取旅遊規劃師（行程手冊 Roadbook）的最新版，放到 public/travel/，由 Claude Flow 一起發布在 /travel/。
 *
 * 來源是 GitHub 上 chenyu0502/travel-planner 的 main 分支原始碼。旅遊規劃師在自己的 repo 開發，
 * 合併到 main 後由它的 GitHub Actions 透過 Deploy Hook 通知 Claude Flow 重新部署。
 * 下載、複製與插入登入檢查的流程與室內設計共用 scripts/fetch-subsite.mjs。
 *
 * 旅遊規劃師沒有公開分享頁：index.html 一律要求登入（行程含出發日期與住宿，不對外公開）。
 *
 * 用法：
 *   node scripts/fetch-travel.mjs                     建置用（npm run build），登入檢查指向建置後的 /assets/travel-gate.js
 *   node scripts/fetch-travel.mjs --dev --if-missing  開發用（npm run dev 前自動執行），指向 Vite 開發伺服器的原始碼
 *   node scripts/fetch-travel.mjs --dev               開發時強制重新下載最新版
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from './fetch-subsite.mjs';

export const GATE_SRC_BUILD = '/assets/travel-gate.js';
export const GATE_SRC_DEV = '/src/travel-gate.ts';
/** 網站執行需要的檔案與目錄（README、CHANGELOG、start.bat、.github 都不發布） */
export const SITE_ENTRIES = ['index.html', 'css', 'js'];

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runCli({
    repo: process.env.TRAVEL_REPO || 'chenyu0502/travel-planner',
    ref: process.env.TRAVEL_REF || 'main',
    entries: SITE_ENTRIES,
    target: join(root, 'public', 'travel'),
    gateSrcBuild: GATE_SRC_BUILD,
    gateSrcDev: GATE_SRC_DEV,
    label: '旅遊規劃師',
    tag: 'travel',
  });
}
