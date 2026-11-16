// 室內設計（/interior/）的存取判斷：所有登入且未停用的 Claude Flow 使用者都能用。
import type { UserProfile } from './types/user';

/**
 * 唯讀分享連結不需要登入：室內設計的「分享」是給沒有帳號的業主看設計用的
 * （#share=壓縮資料，或 ?g=Gist 編號）。擋住它們，分享功能就沒有意義。
 */
export function isPublicShareView(loc: { hash: string; search: string }): boolean {
  if (/^#share=/.test(loc.hash)) return true;
  return new URLSearchParams(loc.search).has('g');
}

export type InteriorAccess =
  /** 可以使用 */
  | 'allow'
  /** 未登入：導向 Claude Flow 登入頁 */
  | 'login'
  /** 帳號已停用 */
  | 'disabled'
  /** 已登入但沒有 Claude Flow 使用者資料（從未在 Claude Flow 登入過） */
  | 'no-profile';

/**
 * @param signedIn 是否已登入 Firebase Auth
 * @param profile  users/{uid}；undefined 代表還在讀取，null 代表文件不存在
 * @returns 判斷結果；還在讀取時回傳 null（保持隱藏、繼續等待）
 */
export function decideInteriorAccess(
  signedIn: boolean,
  profile: UserProfile | null | undefined,
): InteriorAccess | null {
  if (!signedIn) return 'login';
  if (profile === undefined) return null;
  if (profile === null) return 'no-profile';
  return profile.disabled ? 'disabled' : 'allow';
}
