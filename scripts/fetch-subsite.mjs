/**
 * 子網站共用的抓取流程：下載子網站 repo 的最新原始碼，只複製網站需要的檔案到 public/<目錄>/，
 * 並在 index.html 插入 Claude Flow 的登入檢查。
 *
 * 室內設計（fetch-interior.mjs）與旅遊規劃師（fetch-travel.mjs）都用這份流程，各自只提供設定。
 * 子網站必須是純前端靜態網站、路徑全是相對路徑，原樣放進子目錄即可運作。
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
 * @param {string} [label] 錯誤訊息中的子網站名稱
 * @returns {string}
 */
export function injectGate(html, gateSrc, label = '室內設計') {
  const cleaned = html.replace(new RegExp(`\\s*${GATE_START}[\\s\\S]*?${GATE_END}`), '');
  const head = /<head[^>]*>/i.exec(cleaned);
  if (!head) throw new Error(`${label}的 index.html 找不到 <head>，無法插入登入檢查`);
  const block =
    `\n  ${GATE_START}\n` +
    `  <style id="cf-gate-style">html{visibility:hidden}</style>\n` +
    `  <script type="module" src="${gateSrc}"></script>\n` +
    `  ${GATE_END}`;
  const at = head.index + head[0].length;
  return cleaned.slice(0, at) + block + cleaned.slice(at);
}

/** 下載 GitHub 原始碼壓縮檔並解壓到暫存目錄，回傳解壓後的根目錄。 */
async function download(repo, ref, label, tmpPrefix) {
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載${label}失敗：HTTP ${res.status}（${url}）`);
  const work = mkdtempSync(join(tmpdir(), tmpPrefix));
  const archive = join(work, 'src.tar.gz');
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', work]);
  // 壓縮檔內只有一個頂層目錄（例如 Interior_Decoration-main）。
  const top = execFileSync('tar', ['-tzf', archive]).toString().split('\n')[0].split('/')[0];
  return { work, out: join(work, top) };
}

/** 取得來源 commit（只用於記錄，失敗不影響建置）。 */
async function sourceCommit(repo, ref) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
      headers: { Accept: 'application/vnd.github.sha' },
    });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.repo        GitHub repo（owner/name）
 * @param {string} opts.ref         分支
 * @param {string[]} opts.entries   要發布的檔案與目錄（其餘如 .github、README 都不發布）
 * @param {string} opts.target      輸出目錄（public/<子網站>）
 * @param {string} opts.gateSrc     插進 index.html 的登入檢查路徑
 * @param {string} opts.label       顯示用名稱（訊息與錯誤）
 * @param {string} opts.tag         記錄前綴，例如 interior
 * @param {boolean} opts.ifMissing  已有一份時不重新下載，只更新登入檢查路徑
 */
export async function fetchSubsite({ repo, ref, entries, target, gateSrc, label, tag, ifMissing }) {
  const indexPath = join(target, 'index.html');

  if (ifMissing && existsSync(indexPath)) {
    // 已經有一份：不重新下載，只確保登入檢查指向正確的路徑（建置後再開發時會從建置路徑切回開發路徑）。
    writeFileSync(indexPath, injectGate(readFileSync(indexPath, 'utf8'), gateSrc, label));
    console.log(`[${tag}] 沿用現有版本，登入檢查指向 ${gateSrc}`);
    return;
  }

  const { work, out } = await download(repo, ref, label, `${tag}-`);
  try {
    rmSync(target, { recursive: true, force: true });
    for (const entry of entries) {
      const from = join(out, entry);
      if (!existsSync(from)) throw new Error(`${label}缺少 ${entry}，原始碼結構可能變了`);
      cpSync(from, join(target, entry), { recursive: true });
    }
    writeFileSync(indexPath, injectGate(readFileSync(indexPath, 'utf8'), gateSrc, label));
    const commit = await sourceCommit(repo, ref);
    writeFileSync(
      join(target, 'source.json'),
      JSON.stringify({ repo, ref, commit, fetchedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`[${tag}] 已取得 ${repo}@${ref}${commit ? `（${commit.slice(0, 7)}）` : ''}，登入檢查指向 ${gateSrc}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 給各子網站腳本的進入點：解析 --dev / --if-missing，失敗時以非零結束碼中止建置。 */
export function runCli({ tag, gateSrcBuild, gateSrcDev, ...config }) {
  const args = new Set(process.argv.slice(2));
  fetchSubsite({
    ...config,
    tag,
    gateSrc: args.has('--dev') ? gateSrcDev : gateSrcBuild,
    ifMissing: args.has('--if-missing'),
  }).catch((err) => {
    console.error(`[${tag}] ${err.message}`);
    process.exit(1);
  });
}
