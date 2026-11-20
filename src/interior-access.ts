// 室內設計（/interior/）的存取判斷：所有登入且未停用的 Claude Flow 使用者都能用。
// 判斷本身與其他子網站共用（subsite-access.ts），這裡只多了室內設計特有的公開分享連結。
import { decideSubsiteAccess, type SubsiteAccess } from './subsite-access';

/**
 * 唯讀分享連結不需要登入：室內設計的「分享」是給沒有帳號的業主看設計用的
 * （#share=壓縮資料，或 ?g=Gist 編號）。擋住它們，分享功能就沒有意義。
 */
export function isPublicShareView(loc: { hash: string; search: string }): boolean {
  if (/^#share=/.test(loc.hash)) return true;
  return new URLSearchParams(loc.search).has('g');
}

export type InteriorAccess = SubsiteAccess;
export const decideInteriorAccess = decideSubsiteAccess;
