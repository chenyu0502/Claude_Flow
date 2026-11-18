/**
 * 室內設計（/interior/）的登入檢查。
 *
 * 由 scripts/fetch-interior.mjs 插進室內設計的 index.html：頁面一開始被 <style id="cf-gate-style">
 * 隱藏，這裡確認是登入且未停用的 Claude Flow 使用者後才顯示。室內設計本身的程式完全不知道這層檢查。
 *
 * 唯讀分享連結直接放行（給業主看設計用）。ar.html 沒有插入這段（手機掃 QR code 開 AR 不要求登入）。
 */
import { onAuthStateChanged } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import { auth } from './lib/firebase';
import { subscribeUserProfile } from './services/users';
import { decideInteriorAccess, isPublicShareView, type InteriorAccess } from './interior-access';

function reveal() {
  document.getElementById('cf-gate-style')?.remove();
}

const NOTICES: Record<Exclude<InteriorAccess, 'allow' | 'login'>, { title: string; body: string }> = {
  disabled: { title: '帳號已停用', body: '你的帳號已被停用，請聯絡管理員。' },
  'no-profile': { title: '請先登入 Claude Flow', body: '請從 Claude Flow 首頁登入後，再開啟室內設計。' },
  unverified: { title: '請先驗證 Email', body: '請到信箱點驗證信中的連結，完成後回 Claude Flow 首頁再開啟室內設計。' },
};

/** 以 Claude Flow 的提示取代整個頁面（室內設計的介面已經建好，直接換掉 body）。 */
function showNotice(kind: keyof typeof NOTICES) {
  const { title, body } = NOTICES[kind];
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

function apply(access: InteriorAccess | null) {
  if (access === null) return; // 還在讀取，保持隱藏
  if (access === 'allow') reveal();
  else if (access === 'login') window.location.replace('/login');
  else showNotice(access);
}

if (isPublicShareView(window.location)) {
  reveal();
} else {
  let unsubscribeProfile: Unsubscribe | null = null;
  onAuthStateChanged(auth, (user) => {
    unsubscribeProfile?.();
    unsubscribeProfile = null;
    if (!user) {
      apply(decideInteriorAccess(null, undefined));
      return;
    }
    const early = decideInteriorAccess(user, undefined);
    if (early !== null) {
      apply(early); // 未驗證 Email：不必等使用者資料
      return;
    }
    // 持續訂閱：使用中被停用也會立刻換成停用提示。
    unsubscribeProfile = subscribeUserProfile(
      user.uid,
      (profile) => apply(decideInteriorAccess(user, profile)),
      () => apply('no-profile'),
    );
  });
}
