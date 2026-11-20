/**
 * 室內設計（/interior/）的登入檢查，由 scripts/fetch-interior.mjs 插進室內設計的 index.html。
 * 檢查流程與其他子網站共用（subsite-gate.ts）。
 *
 * 唯讀分享連結直接放行（給業主看設計用）。ar.html 沒有插入這段（手機掃 QR code 開 AR 不要求登入）。
 */
import { isPublicShareView } from './interior-access';
import { startSubsiteGate } from './subsite-gate';

startSubsiteGate('室內設計', () => isPublicShareView(window.location));
