#!/usr/bin/env node
/**
 * 把 Claude_Animate 做好的動畫（pieces/snowball-*\/index.html）匯入動畫工作室（/studio）。
 *
 * 用法：node scripts/import-animations.mjs <Claude_Animate 資料夾> [--no-thumbs]
 *
 * 每支動畫都是單一 HTML：一個 <canvas>，window.renderFrame(t) 畫出 t 秒的畫面，
 * window.buildScore(sampleRate) 用 OfflineAudioContext 合成配樂。工作室把它放進 iframe 控制播放與匯出。
 *
 * 匯入時做兩件事：
 * 1. 把畫面上的名字與字幕字串換成 CFX('鍵', '原字')，執行時從網址參數 ?cf=<JSON> 讀使用者填的內容，
 *    沒填就用原字。只換整個字串字面值，逐字畫的動畫（史詩、和風、素描本）也會跟著換。
 * 2. 用 Playwright 拍每支的縮圖（public/animations/thumbs/<id>.jpg）。
 *
 * 輸出到 public/animations/，執行完要提交這些檔案（Vercel 建置時沒有 Claude_Animate）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = process.argv[2];
const noThumbs = process.argv.includes('--no-thumbs');
if (!src || !fs.existsSync(path.join(src, 'pieces'))) {
  console.error('用法：node scripts/import-animations.mjs <Claude_Animate 資料夾> [--no-thumbs]');
  process.exit(1);
}

/** 畫風 id → Claude_Animate 的 piece 資料夾；縮圖時間挑該畫風最有代表性的一格 */
const PIECES = {
  papercut: { dir: 'snowball-fight', thumb: 2.8 },
  pixel: { dir: 'snowball-pixel', thumb: 2.8 },
  riso: { dir: 'snowball-riso', thumb: 2.8 },
  sketch: { dir: 'snowball-sketch', thumb: 2.8 },
  ink: { dir: 'snowball-ink', thumb: 2.8 },
  iso: { dir: 'snowball-iso', thumb: 6.3 },
  math: { dir: 'snowball-math', thumb: 2.8 },
  cozy: { dir: 'snowball-cozy', thumb: 2.8 },
  anime: { dir: 'snowball-anime', thumb: 2.8 },
  wafu: { dir: 'snowball-wafu', thumb: 6.3 },
  ocean: { dir: 'snowball-ocean', thumb: 2.8 },
  mecha: { dir: 'snowball-mecha', thumb: 2.8 },
  epic: { dir: 'snowball-epic', thumb: 2.8 },
  rpg: { dir: 'snowball-rpg', thumb: 2.8 },
  pastoral: { dir: 'snowball-pastoral', thumb: 2.8 },
};

/** 可替換的字串字面值 → 參數鍵。像素風的字型只有大寫英文，用 n1u 等鍵（只接受英文名字）。 */
const LITERALS = [
  ["'下雪天，最開心！'", 'end'],
  ["'啪！'", 'hit'],
  ["'Eugene'", 'n1'],
  ["'Max'", 'n2'],
  ["'Hannah'", 'n3'],
  ["'EUGENE'", 'n1u'],
  ["'MAX'", 'n2u'],
  ["'HANNAH'", 'n3u'],
];

/** 插在第一段 <script> 最前面：讀 ?cf=，提供 CFX(鍵, 原字)。 */
const PRELUDE = `
// ---- Claude Flow 動畫工作室：可替換的名字與字幕（scripts/import-animations.mjs 插入） ----
const CF_TEXT = (() => {
  try { const v = JSON.parse(new URLSearchParams(location.search).get('cf') || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
})();
function CFX(key, fallback) {
  const v = CF_TEXT[key];
  if (typeof v !== 'string' || !v.trim()) return fallback;
  if (key.endsWith('u')) return /^[A-Za-z]{1,8}$/.test(v.trim()) ? v.trim().toUpperCase() : fallback;
  return v;
}
`;

const outDir = path.resolve('public/animations');
fs.mkdirSync(path.join(outDir, 'thumbs'), { recursive: true });

const summary = {};
for (const [id, { dir }] of Object.entries(PIECES)) {
  const file = path.join(src, 'pieces', dir, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  for (const [lit, key] of LITERALS) {
    const n = html.split(lit).length - 1;
    if (!n) continue;
    html = html.split(lit).join(`CFX('${key}', ${lit})`);
    keys.add(key.replace(/u$/, ''));
  }
  const at = html.indexOf('"use strict";');
  if (at < 0) throw new Error(`${dir}: 找不到 "use strict";`);
  const cut = at + '"use strict";'.length;
  html = html.slice(0, cut) + PRELUDE + html.slice(cut);
  // 工作室自己控制播放：canvas 不需要「點一下播放」的游標
  html = html.replace('cursor: pointer;', '');
  fs.writeFileSync(path.join(outDir, `${id}.html`), html);
  summary[id] = [...keys];
}
console.log('可替換的欄位：', JSON.stringify(summary));

if (!noThumbs) {
  // Playwright 不是專案的相依套件：先找專案內的，找不到就用全域安裝的（npm i -g playwright）。
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    const { execSync } = await import('node:child_process');
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    pw = await import(pathToFileURL(path.join(globalRoot, 'playwright', 'index.mjs')).href);
  }
  const { chromium } = pw;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, { thumb }] of Object.entries(PIECES)) {
    await page.goto(`${pathToFileURL(path.join(outDir, `${id}.html`)).href}?export=1`);
    await page.waitForFunction(() => typeof window.renderFrame === 'function');
    const data = await page.evaluate((t) => {
      window.renderFrame(t);
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 270;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(document.getElementById('c'), 0, 0, 480, 270);
      return c.toDataURL('image/jpeg', 0.82).split(',')[1];
    }, thumb);
    fs.writeFileSync(path.join(outDir, 'thumbs', `${id}.jpg`), Buffer.from(data, 'base64'));
  }
  await browser.close();
  console.log('縮圖完成');
}
