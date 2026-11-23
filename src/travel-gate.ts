/**
 * 旅遊規劃（/travel/）的登入檢查，由 scripts/fetch-travel.mjs 插進旅遊規劃的 index.html。
 * 檢查流程與其他子網站共用（subsite-gate.ts）。
 *
 * 沒有公開分享頁：行程含出發日期與住宿地點，一律要求登入。
 *
 * 通過檢查後提供行程存取介面給旅遊規劃頁面：
 *   window.ClaudeFlowTravel（TravelBridge，見 travel-store.ts），並發出 'claudeflow:travel-ready' 事件。
 * 旅遊規劃的程式比這段先執行，所以它會先檢查 window.ClaudeFlowTravel，沒有再等事件。
 */
import { db } from './lib/firebase';
import { startSubsiteGate } from './subsite-gate';
import { createTravelBridge, type TravelBridge } from './travel-store';

declare global {
  interface Window {
    ClaudeFlowTravel?: TravelBridge;
  }
}

startSubsiteGate('旅遊規劃', {
  onAllow(user, profile) {
    const bridge = createTravelBridge(
      db,
      { uid: user.uid, name: profile.displayName ?? user.displayName ?? null },
      () => user.getIdToken(),
    );
    window.ClaudeFlowTravel = bridge;
    window.dispatchEvent(new CustomEvent('claudeflow:travel-ready', { detail: bridge }));
  },
});
