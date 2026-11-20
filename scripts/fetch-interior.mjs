/**
 * 抓取室內設計（Interior Studio）的最新版，放到 public/interior/，由 Claude Flow 一起發布在 /interior/。
 *
 * 來源是 GitHub 上 chenyu0502/Interior_Decoration 的 main 分支原始碼（不是 GitHub Pages），
 * 所以室內設計照原本的流程在自己的 repo 開發；Claude Flow 每次建置都拿最新版。
 * 下載、複製與插入登入檢查的流程共用 scripts/fetch-subsite.mjs。
 *
 * 只複製網站執行需要的檔案（index.html、ar.html、css、js、vendor）與 LICENSE（MIT 授權要求保留）。
 *
 * 並在 index.html 插入 Claude Flow 的登入檢查（src/interior-gate.ts）：
 * 檢查完成前整頁隱藏，未登入導向 /login。ar.html 不插入——手機掃 QR code 開 AR 不該要求登入。
 *
 * 用法：
 *   node scripts/fetch-interior.mjs                     建置用（npm run build），登入檢查指向建置後的 /assets/interior-gate.js
 *   node scripts/fetch-interior.mjs --dev --if-missing  開發用（npm run dev 前自動執行），指向 Vite 開發伺服器的原始碼
 *   node scripts/fetch-interior.mjs --dev               開發時強制重新下載最新版
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { injectGate, runCli } from './fetch-subsite.mjs';

export { injectGate };

export const GATE_SRC_BUILD = '/assets/interior-gate.js';
export const GATE_SRC_DEV = '/src/interior-gate.ts';

// 被測試 import 時不執行。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runCli({
    repo: process.env.INTERIOR_REPO || 'chenyu0502/Interior_Decoration',
    ref: process.env.INTERIOR_REF || 'main',
    entries: ['index.html', 'ar.html', 'css', 'js', 'vendor', 'LICENSE'],
    target: join(root, 'public', 'interior'),
    gateSrcBuild: GATE_SRC_BUILD,
    gateSrcDev: GATE_SRC_DEV,
    label: '室內設計',
    tag: 'interior',
  });
}
