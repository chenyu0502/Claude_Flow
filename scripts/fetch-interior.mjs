/**
 * 抓取室內設計（Interior Studio）的最新版，放到 public/interior/，由 Claude Flow 一起發布在 /interior/。
 *
 * 來源是 GitHub 上 chenyu0502/Interior_Decoration 的 main 分支原始碼（不是 GitHub Pages），
 * 所以室內設計照原本的流程在自己的 repo 開發；Claude Flow 每次建置都拿最新版。
 * 室內設計是純前端靜態網站、路徑全是相對路徑，原樣放進子目錄即可運作。
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

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.INTERIOR_REPO || 'chenyu0502/Interior_Decoration';
const REF = process.env.INTERIOR_REF || 'main';
/** 網站執行需要的檔案與目錄（其餘如 .github、.claude、CLAUDE.md、README 都不發布） */
const SITE_ENTRIES = ['index.html', 'ar.html', 'css', 'js', 'vendor', 'LICENSE'];

export const GATE_SRC_BUILD = '/assets/interior-gate.js';
export const GATE_SRC_DEV = '/src/interior-gate.ts';
const GATE_START = '<!-- claude-flow-gate:start -->';
const GATE_END = '<!-- claude-flow-gate:end -->';

/**
 * 在 HTML 的 <head> 開頭插入登入檢查。已插入過的會先移除（可重複執行、可切換開發/建置路徑）。
 *
 * 先用 <style> 把整頁隱藏，登入檢查通過才移除：檢查是非同步的，不先隱藏，
 * 未登入的人會先看到一瞬間的畫面。檢查腳本載入失敗時頁面保持隱藏——拒絕，而不是放行。
 *
 * @param {string} html
 * @param {string} gateSrc
 * @returns {string}
 */
export function injectGate(html, gateSrc) {
  const cleaned = html.replace(new RegExp(`\\s*${GATE_START}[\\s\\S]*?${GATE_END}`), '');
  const head = /<head[^>]*>/i.exec(cleaned);
  if (!head) throw new Error('室內設計的 index.html 找不到 <head>，無法插入登入檢查');
  const block =
    `\n  ${GATE_START}\n` +
    `  <style id="cf-gate-style">html{visibility:hidden}</style>\n` +
    `  <script type="module" src="${gateSrc}"></script>\n` +
    `  ${GATE_END}`;
  const at = head.index + head[0].length;
  return cleaned.slice(0, at) + block + cleaned.slice(at);
}

/** 下載 GitHub 原始碼壓縮檔並解壓到暫存目錄，回傳解壓後的根目錄。 */
async function download() {
  const url = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載室內設計失敗：HTTP ${res.status}（${url}）`);
  const work = mkdtempSync(join(tmpdir(), 'interior-'));
  const archive = join(work, 'src.tar.gz');
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', work]);
  // 壓縮檔內只有一個頂層目錄（例如 Interior_Decoration-main）。
  const top = execFileSync('tar', ['-tzf', archive]).toString().split('\n')[0].split('/')[0];
  return { work, out: join(work, top) };
}

/** 取得來源 commit（只用於記錄，失敗不影響建置）。 */
async function sourceCommit() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${REF}`, {
      headers: { Accept: 'application/vnd.github.sha' },
    });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const gateSrc = args.has('--dev') ? GATE_SRC_DEV : GATE_SRC_BUILD;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = join(root, 'public', 'interior');
  const indexPath = join(target, 'index.html');

  if (args.has('--if-missing') && existsSync(indexPath)) {
    // 已經有一份：不重新下載，只確保登入檢查指向正確的路徑（建置後再開發時會從建置路徑切回開發路徑）。
    writeFileSync(indexPath, injectGate(readFileSync(indexPath, 'utf8'), gateSrc));
    console.log(`[interior] 沿用現有版本，登入檢查指向 ${gateSrc}`);
    return;
  }

  const { work, out } = await download();
  try {
    rmSync(target, { recursive: true, force: true });
    for (const entry of SITE_ENTRIES) {
      const from = join(out, entry);
      if (!existsSync(from)) throw new Error(`室內設計缺少 ${entry}，原始碼結構可能變了`);
      cpSync(from, join(target, entry), { recursive: true });
    }
    writeFileSync(indexPath, injectGate(readFileSync(indexPath, 'utf8'), gateSrc));
    const commit = await sourceCommit();
    writeFileSync(
      join(target, 'source.json'),
      JSON.stringify({ repo: REPO, ref: REF, commit, fetchedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`[interior] 已取得 ${REPO}@${REF}${commit ? `（${commit.slice(0, 7)}）` : ''}，登入檢查指向 ${gateSrc}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// 被測試 import 時不執行。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`[interior] ${err.message}`);
    process.exit(1);
  });
}
