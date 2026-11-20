/**
 * 子網站（/interior/、/travel/）共用的登入檢查。
 *
 * 由 scripts/fetch-*.mjs 插進子網站的 index.html：頁面一開始被 <style id="cf-gate-style">
 * 隱藏，這裡確認是登入且未停用的 Claude Flow 使用者後才顯示。子網站本身的程式完全不知道這層檢查。
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import { auth } from './lib/firebase';
import { subscribeUserProfile } from './services/users';
import type { UserProfile } from './types/user';
import { decideSubsiteAccess, type SubsiteAccess } from './subsite-access';

function reveal() {
  document.getElementById('cf-gate-style')?.remove();
}

type Notice = Exclude<SubsiteAccess, 'allow' | 'login'>;

function notices(appName: string): Record<Notice, { title: string; body: string }> {
  return {
    disabled: { title: '帳號已停用', body: '你的帳號已被停用，請聯絡管理員。' },
    'no-profile': { title: '請先登入 Claude Flow', body: `請從 Claude Flow 首頁登入後，再開啟${appName}。` },
    unverified: { title: '請先驗證 Email', body: `請到信箱點驗證信中的連結，完成後回 Claude Flow 首頁再開啟${appName}。` },
  };
}

/** 以 Claude Flow 的提示取代整個頁面（子網站的介面已經建好，直接換掉 body）。 */
function showNotice(appName: string, kind: Notice) {
  const { title, body } = notices(appName)[kind];
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,'Microsoft JhengHei',sans-serif;background:#f6f7f9;color:#1c2024">
      <div style="max-width:360px;text-align:center;background:#fff;border:1px solid #dfe1e6;border-radius:10px;padding:24px">
        <h1 style="font-size:1.25rem;margin:0 0 8px">${title}</h1>
        <p style="color:#60646c;margin:0 0 16px">${body}</p>
        <a href="/" style="display:inline-block;padding:8px 16px;border-radius:8px;background:#3e63dd;color:#fff;text-decoration:none">回 Claude Flow 首頁</a>
      </div>
    </div>`;
  reveal();
}

export interface SubsiteGateOptions {
  /** 回傳 true 時直接放行（例如室內設計的唯讀分享連結） */
  isPublic?: () => boolean;
  /** 第一次判定可以使用、顯示頁面之前呼叫一次（例如提供資料存取介面給子網站） */
  onAllow?: (user: User, profile: UserProfile) => void;
}

/**
 * 啟動登入檢查。
 * @param appName 提示文字中的子網站名稱，例如「室內設計」
 */
export function startSubsiteGate(appName: string, { isPublic = () => false, onAllow }: SubsiteGateOptions = {}) {
  let allowed = false;
  const apply = (access: SubsiteAccess | null, user?: User, profile?: UserProfile | null) => {
    if (access === null) return; // 還在讀取，保持隱藏
    if (access === 'allow') {
      if (!allowed && user && profile) {
        allowed = true;
        onAllow?.(user, profile);
      }
      reveal();
    } else if (access === 'login') window.location.replace('/login');
    else showNotice(appName, access);
  };

  if (isPublic()) {
    reveal();
    return;
  }
  let unsubscribeProfile: Unsubscribe | null = null;
  onAuthStateChanged(auth, (user) => {
    unsubscribeProfile?.();
    unsubscribeProfile = null;
    if (!user) {
      apply(decideSubsiteAccess(null, undefined));
      return;
    }
    const early = decideSubsiteAccess(user, undefined);
    if (early !== null) {
      apply(early); // 未驗證 Email：不必等使用者資料
      return;
    }
    // 持續訂閱：使用中被停用也會立刻換成停用提示。
    unsubscribeProfile = subscribeUserProfile(
      user.uid,
      (profile) => apply(decideSubsiteAccess(user, profile), user, profile),
      () => apply('no-profile'),
    );
  });
}
