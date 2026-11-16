// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GATE_SRC_BUILD, GATE_SRC_DEV, injectGate } from './fetch-interior.mjs';

const HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="css/app.css" />
</head>
<body><script type="module" src="js/main.js"></script></body>
</html>`;

describe('injectGate', () => {
  it('在 <head> 最前面插入隱藏樣式與登入檢查，早於室內設計自己的資源', () => {
    const out = injectGate(HTML, GATE_SRC_BUILD);
    const style = out.indexOf('id="cf-gate-style"');
    const gate = out.indexOf(`src="${GATE_SRC_BUILD}"`);
    expect(style).toBeGreaterThan(out.indexOf('<head>'));
    expect(gate).toBeGreaterThan(style);
    expect(gate).toBeLessThan(out.indexOf('<meta charset'));
    expect(out).toContain('html{visibility:hidden}');
  });

  it('重複執行只會有一份，並可在開發與建置路徑之間切換', () => {
    const once = injectGate(HTML, GATE_SRC_BUILD);
    const twice = injectGate(injectGate(once, GATE_SRC_DEV), GATE_SRC_BUILD);
    expect(twice).toBe(once);
    const dev = injectGate(once, GATE_SRC_DEV);
    expect(dev.match(/cf-gate-style/g)).toHaveLength(1);
    expect(dev).toContain(`src="${GATE_SRC_DEV}"`);
    expect(dev).not.toContain(`src="${GATE_SRC_BUILD}"`);
  });

  it('不動室內設計原本的內容', () => {
    const out = injectGate(HTML, GATE_SRC_BUILD);
    const stripped = out.replace(/\s*<!-- claude-flow-gate:start -->[\s\S]*?<!-- claude-flow-gate:end -->/, '');
    expect(stripped).toBe(HTML);
  });

  it('找不到 <head> 時直接報錯，不產生沒有登入檢查的頁面', () => {
    expect(() => injectGate('<html><body></body></html>', GATE_SRC_BUILD)).toThrow(/<head>/);
  });
});
