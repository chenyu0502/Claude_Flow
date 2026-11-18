// OWNER: Agent A。只負責 Firebase Auth 操作，不碰 Firestore（使用者文件由 AuthContext 調 users.ts 處理）。
import {
  EmailAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  unlink,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import type { AuthCredential, AuthProvider, User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import type { ProviderId } from '../types/user';

/**
 * 同一 email 已用其他登入方式註冊時拋出（auth/account-exists-with-different-credential）。
 * pendingCredential 留著，等使用者用原本方式登入後再 linkPendingCredential 綁定。
 */
export class AccountExistsWithDifferentCredentialError extends Error {
  constructor(
    public readonly email: string | null,
    public readonly pendingCredential: AuthCredential,
  ) {
    super('ACCOUNT_EXISTS_WITH_DIFFERENT_CREDENTIAL');
    this.name = 'AccountExistsWithDifferentCredentialError';
  }
}

type OAuthProviderId = Exclude<ProviderId, 'password'>;

function createProvider(providerId: OAuthProviderId): AuthProvider {
  if (providerId === 'google.com') {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  }
  const provider = new GithubAuthProvider();
  provider.addScope('user:email');
  return provider;
}

/** 取出 FirebaseError 的 code（鴨子型別判斷，不依賴 instanceof） */
export function getAuthErrorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** 彈窗被使用者關閉或被新的彈窗請求取代：視為使用者主動取消，頁面不必顯示錯誤 */
export function isUserCancelled(err: unknown): boolean {
  const code = getAuthErrorCode(err);
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

async function signInWithOAuth(providerId: OAuthProviderId): Promise<User> {
  try {
    const result = await signInWithPopup(auth, createProvider(providerId));
    return result.user;
  } catch (err) {
    if (getAuthErrorCode(err) === 'auth/account-exists-with-different-credential') {
      const firebaseErr = err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0];
      const credential =
        providerId === 'google.com'
          ? GoogleAuthProvider.credentialFromError(firebaseErr)
          : GithubAuthProvider.credentialFromError(firebaseErr);
      if (credential) {
        const email = (firebaseErr.customData?.email as string | undefined) ?? null;
        throw new AccountExistsWithDifferentCredentialError(email, credential);
      }
    }
    throw err;
  }
}

export async function signInWithGoogle(): Promise<User> {
  return signInWithOAuth('google.com');
}
export async function signInWithGithub(): Promise<User> {
  return signInWithOAuth('github.com');
}
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}
/** 註冊後同時設定 Auth 的 displayName，並寄出 Email 驗證信 */
export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  // 驗證信寄送失敗不能讓註冊失敗：帳號已經建好了，驗證提示頁可以再寄一次。
  try {
    await sendVerificationEmail(result.user);
  } catch (err) {
    console.error('[auth] 寄送驗證信失敗', err);
  }
  await result.user.reload();
  return auth.currentUser ?? result.user;
}

/**
 * 寄出 Email 驗證信。信中連結驗證完會帶使用者回到 Claude Flow 首頁。
 * continueUrl 的網域必須在 Firebase 的授權網域中，否則 Firebase 會拒絕寄送。
 */
export async function sendVerificationEmail(user: User | null = auth.currentUser): Promise<void> {
  if (!user) throw new Error('請先登入');
  const url = typeof window === 'undefined' ? undefined : `${window.location.origin}/`;
  await sendEmailVerification(user, url ? { url } : undefined);
}

/**
 * 修改密碼。Firebase 要求「最近登入過」才能改密碼，所以先用目前的密碼重新驗證一次，
 * 這也順便確認操作的人知道原本的密碼（避免別人拿到開著的瀏覽器就能改掉密碼）。
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('請先登入');
  if (!user.email || !user.providerData.some((p) => p.providerId === 'password')) {
    throw new Error('此帳號沒有設定密碼，請用原本的登入方式登入');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  try {
    await reauthenticateWithCredential(user, credential);
  } catch (err) {
    // 重新驗證時密碼錯，Firebase 回的是登入用的錯誤碼；在這裡改成「目前的密碼不正確」比較好懂。
    const code = getAuthErrorCode(err);
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('目前的密碼不正確');
    }
    throw err;
  }
  await updatePassword(user, newPassword);
}
export async function sendResetEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
/** 把先前因 email 衝突保留下來的憑證綁定到當前使用者 */
export async function linkPendingCredential(user: User, credential: AuthCredential): Promise<User> {
  const result = await linkWithCredential(user, credential);
  return result.user;
}
/** 個人資料頁：為當前使用者再綁定 Google / GitHub（popup） */
export async function linkProvider(providerId: Exclude<ProviderId, 'password'>): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('請先登入');
  const result = await linkWithPopup(user, createProvider(providerId));
  return result.user;
}
/** 個人資料頁：解除綁定。只剩一種登入方式時必須拒絕（拋錯）。 */
export async function unlinkProvider(providerId: ProviderId): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('請先登入');
  if (user.providerData.length <= 1) throw new Error('至少需要保留一種登入方式');
  if (!user.providerData.some((p) => p.providerId === providerId)) {
    throw new Error('尚未綁定此登入方式');
  }
  return unlink(user, providerId);
}

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Email 格式不正確',
  'auth/user-disabled': '此帳號已被停用',
  'auth/user-not-found': 'Email 或密碼錯誤',
  'auth/wrong-password': 'Email 或密碼錯誤',
  'auth/invalid-credential': 'Email 或密碼錯誤，或登入憑證已失效',
  'auth/email-already-in-use': '此 Email 已被註冊',
  'auth/weak-password': '密碼強度不足，至少需要 6 個字元',
  'auth/too-many-requests': '嘗試次數過多，請稍後再試',
  'auth/popup-closed-by-user': '登入視窗已關閉',
  'auth/cancelled-popup-request': '登入已取消',
  'auth/popup-blocked': '登入彈出視窗被瀏覽器攔截，請允許彈出視窗後重試',
  'auth/network-request-failed': '網路連線失敗，請檢查網路後重試',
  'auth/credential-already-in-use': '此登入方式已綁定到另一個帳號',
  'auth/provider-already-linked': '已綁定過此登入方式',
  'auth/requires-recent-login': '為了安全，請重新登入後再執行此操作',
  'auth/operation-not-allowed': '此登入方式尚未啟用，請在 Firebase Console 的 Authentication 中啟用',
  'auth/unauthorized-continue-uri': '目前的網域不在 Firebase 授權網域清單中，無法寄送驗證信',
  'auth/missing-password': '請輸入密碼',
};

const DEFAULT_ERROR_MESSAGE = '發生未知錯誤，請稍後再試';

/** 把任何錯誤轉成給使用者看的繁體中文訊息 */
export function authErrorMessage(err: unknown): string {
  if (err instanceof AccountExistsWithDifferentCredentialError) {
    return '此 email 已用其他方式註冊，請先用原本的方式登入，完成後會自動綁定';
  }
  const code = getAuthErrorCode(err);
  if (code !== null) return ERROR_MESSAGES[code] ?? DEFAULT_ERROR_MESSAGE;
  if (err instanceof Error && err.message) return err.message;
  return DEFAULT_ERROR_MESSAGE;
}
