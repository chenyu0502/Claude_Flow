/**
 * 動畫製作（/animate/）的登入檢查，由 scripts/fetch-animate.mjs 插進動畫製作的 index.html。
 * 檢查流程與其他子網站共用（subsite-gate.ts）。
 *
 * 通過檢查後提供劇本生成介面給動畫製作頁面：
 *   window.ClaudeFlowAnimate（AnimateBridge，見 animate-api.ts），並發出 'claudeflow:animate-ready' 事件。
 * 動畫製作的程式比這段先執行，所以它會先檢查 window.ClaudeFlowAnimate，沒有再等事件。
 */
import { startSubsiteGate } from './subsite-gate';
import { createAnimateBridge, type AnimateBridge } from './animate-api';

declare global {
  interface Window {
    ClaudeFlowAnimate?: AnimateBridge;
  }
}

startSubsiteGate('動畫製作', {
  onAllow(user) {
    const bridge = createAnimateBridge(user.uid, () => user.getIdToken());
    window.ClaudeFlowAnimate = bridge;
    window.dispatchEvent(new CustomEvent('claudeflow:animate-ready', { detail: bridge }));
  },
});
