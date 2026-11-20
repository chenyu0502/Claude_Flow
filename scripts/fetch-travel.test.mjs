// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GATE_SRC_BUILD, GATE_SRC_DEV, SITE_ENTRIES } from './fetch-travel.mjs';
import { GATE_SRC_BUILD as INTERIOR_GATE } from './fetch-interior.mjs';
import { injectGate } from './fetch-subsite.mjs';

const HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>行程手冊 Roadbook</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body><script src="js/app.js"></script></body>
</html>`;

describe('旅遊規劃師的抓取設定', () => {
  it('登入檢查指向自己的檔案，與室內設計分開', () => {
    expect(GATE_SRC_BUILD).toBe('/assets/travel-gate.js');
    expect(GATE_SRC_DEV).toBe('/src/travel-gate.ts');
    expect(GATE_SRC_BUILD).not.toBe(INTERIOR_GATE);
  });

  it('只發布網站需要的檔案，不發布 README、start.bat 等開發用檔案', () => {
    expect(SITE_ENTRIES).toEqual(['index.html', 'css', 'js']);
  });

  it('插入登入檢查後，旅遊規劃師的頁面在檢查完成前隱藏', () => {
    const out = injectGate(HTML, GATE_SRC_BUILD, '旅遊規劃師');
    expect(out).toContain('html{visibility:hidden}');
    expect(out.indexOf(`src="${GATE_SRC_BUILD}"`)).toBeLessThan(out.indexOf('css/style.css'));
  });

  it('找不到 <head> 時，錯誤訊息寫出是哪個子網站', () => {
    expect(() => injectGate('<html><body></body></html>', GATE_SRC_BUILD, '旅遊規劃師')).toThrow(/旅遊規劃師/);
  });
});
