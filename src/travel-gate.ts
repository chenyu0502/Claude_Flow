/**
 * 旅遊規劃師（/travel/）的登入檢查，由 scripts/fetch-travel.mjs 插進旅遊規劃師的 index.html。
 * 檢查流程與其他子網站共用（subsite-gate.ts）。
 *
 * 沒有公開分享頁：行程含出發日期與住宿地點，一律要求登入。
 */
import { startSubsiteGate } from './subsite-gate';

startSubsiteGate('旅遊規劃師');
