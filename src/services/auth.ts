// OWNER: Agent A。只负责 Firebase Auth 操作，不碰 Firestore（用户文档由 AuthContext 调 users.ts 处理）。
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  unlink,
  updateProfile,
} from 'firebase/auth';
import type { AuthCredential, AuthProvider, User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import type { ProviderId } from '../types/user';

/**
 * 同一 email 已用其他登录方式注册时抛出（auth/account-exists-with-different-credential）。
 * pendingCredential 留着，等用户用原本方式登录后再 linkPendingCredential 绑定。
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

/** 取出 FirebaseError 的 code（鸭子类型判断，不依赖 instanceof） */
export function getAuthErrorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** 弹窗被用户关闭或被新的弹窗请求取代：视为用户主动取消，页面不必显示错误 */
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
/** 注册后同时设置 Auth 的 displayName */
export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  await result.user.reload();
  return auth.currentUser ?? result.user;
}
export async function sendResetEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
/** 把先前因 email 冲突保留下来的凭证绑定到当前用户 */
export async function linkPendingCredential(user: User, credential: AuthCredential): Promise<User> {
  const result = await linkWithCredential(user, credential);
  return result.user;
}
/** 个人资料页：为当前用户再绑定 Google / GitHub（popup） */
export async function linkProvider(providerId: Exclude<ProviderId, 'password'>): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('请先登录');
  const result = await linkWithPopup(user, createProvider(providerId));
  return result.user;
}
/** 个人资料页：解除绑定。只剩一种登录方式时必须拒绝（抛错）。 */
export async function unlinkProvider(providerId: ProviderId): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('请先登录');
  if (user.providerData.length <= 1) throw new Error('至少需要保留一种登录方式');
  if (!user.providerData.some((p) => p.providerId === providerId)) {
    throw new Error('尚未绑定此登录方式');
  }
  return unlink(user, providerId);
}

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Email 格式不正确',
  'auth/user-disabled': '此账号已被停用',
  'auth/user-not-found': 'Email 或密码错误',
  'auth/wrong-password': 'Email 或密码错误',
  'auth/invalid-credential': 'Email 或密码错误，或登录凭证已失效',
  'auth/email-already-in-use': '此 Email 已被注册',
  'auth/weak-password': '密码强度不足，至少需要 6 个字符',
  'auth/too-many-requests': '尝试次数过多，请稍后再试',
  'auth/popup-closed-by-user': '登录窗口已关闭',
  'auth/cancelled-popup-request': '登录已取消',
  'auth/popup-blocked': '登录弹窗被浏览器拦截，请允许弹出窗口后重试',
  'auth/network-request-failed': '网络连接失败，请检查网络后重试',
  'auth/credential-already-in-use': '此登录方式已绑定到另一个账号',
  'auth/provider-already-linked': '已绑定过此登录方式',
  'auth/requires-recent-login': '为了安全，请重新登录后再执行此操作',
  'auth/operation-not-allowed': '此登录方式尚未启用，请在 Firebase Console 的 Authentication 中启用',
};

const DEFAULT_ERROR_MESSAGE = '发生未知错误，请稍后再试';

/** 把任何错误转成给用户看的简体中文讯息 */
export function authErrorMessage(err: unknown): string {
  if (err instanceof AccountExistsWithDifferentCredentialError) {
    return '此 email 已用其他方式注册，请先用原本的方式登录，完成后会自动绑定';
  }
  const code = getAuthErrorCode(err);
  if (code !== null) return ERROR_MESSAGES[code] ?? DEFAULT_ERROR_MESSAGE;
  if (err instanceof Error && err.message) return err.message;
  return DEFAULT_ERROR_MESSAGE;
}
