/**
 * 抓取動畫製作（animation-studio）的最新版，放到 public/animate/，由 Claude Flow 一起發布在 /animate/。
 *
 * 來源是 GitHub 上 chenyu0502/animation-studio 的 main 分支原始碼。動畫製作在自己的 repo 開發，
 * 合併到 main 後由它的 GitHub Actions 透過 Deploy Hook 通知 Claude Flow 重新部署。
 * 下載、複製與插入登入檢查的流程與其他子網站共用 scripts/fetch-subsite.mjs。
 *
 * 一律要求登入：劇本由 Gemini 生成，呼叫 /api/animate/script 需要 Claude Flow 的登入憑證。
 *
 * 用法：
 *   node scripts/fetch-animate.mjs                     建置用（npm run build），登入檢查指向建置後的 /assets/animate-gate.js
 *   node scripts/fetch-animate.mjs --dev --if-missing  開發用（npm run dev 前自動執行），指向 Vite 開發伺服器的原始碼
 *   node scripts/fetch-animate.mjs --dev               開發時強制重新下載最新版
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from './fetch-subsite.mjs';

export const GATE_SRC_BUILD = '/assets/animate-gate.js';
export const GATE_SRC_DEV = '/src/animate-gate.ts';
/** 網站執行需要的檔案與目錄（tools、tests、README、.github 都不發布） */
export const SITE_ENTRIES = ['index.html', 'css', 'js', 'vendor'];

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runCli({
    repo: process.env.ANIMATE_REPO || 'chenyu0502/animation-studio',
    ref: process.env.ANIMATE_REF || 'main',
    entries: SITE_ENTRIES,
    target: join(root, 'public', 'animate'),
    gateSrcBuild: GATE_SRC_BUILD,
    gateSrcDev: GATE_SRC_DEV,
    label: '動畫製作',
    tag: 'animate',
  });
}
