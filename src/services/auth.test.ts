import type { AuthCredential } from 'firebase/auth';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  signInWithPopup: vi.fn(),
  unlink: vi.fn(),
  linkWithPopup: vi.fn(),
  googleCredentialFromError: vi.fn(),
  githubCredentialFromError: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  class GoogleAuthProvider {
    static credentialFromError = mocks.googleCredentialFromError;
    params: Record<string, string> = {};
    setCustomParameters(p: Record<string, string>) {
      this.params = p;
      return this;
    }
  }
  class GithubAuthProvider {
    static credentialFromError = mocks.githubCredentialFromError;
    scopes: string[] = [];
    addScope(s: string) {
      this.scopes.push(s);
      return this;
    }
  }
  return {
    ...actual,
    GoogleAuthProvider,
    GithubAuthProvider,
    signInWithPopup: mocks.signInWithPopup,
    unlink: mocks.unlink,
    linkWithPopup: mocks.linkWithPopup,
  };
});

import {
  AccountExistsWithDifferentCredentialError,
  authErrorMessage,
  isUserCancelled,
  linkProvider,
  signInWithGithub,
  signInWithGoogle,
  unlinkProvider,
} from './auth';

const fbErr = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code, ...extra });

const fakeCred = { providerId: 'github.com' } as unknown as AuthCredential;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
});

describe('authErrorMessage', () => {
  it.each([
    ['auth/invalid-email', 'Email 格式不正確'],
    ['auth/user-disabled', '停用'],
    ['auth/user-not-found', 'Email 或密碼錯誤'],
    ['auth/wrong-password', 'Email 或密碼錯誤'],
    ['auth/invalid-credential', 'Email 或密碼錯誤'],
    ['auth/email-already-in-use', '已被註冊'],
    ['auth/weak-password', '密碼強度不足'],
    ['auth/too-many-requests', '稍後再試'],
    ['auth/popup-closed-by-user', '關閉'],
    ['auth/cancelled-popup-request', '取消'],
    ['auth/popup-blocked', '攔截'],
    ['auth/network-request-failed', '網路'],
    ['auth/credential-already-in-use', '另一個帳號'],
    ['auth/provider-already-linked', '已綁定過'],
    ['auth/requires-recent-login', '重新登入'],
    ['auth/operation-not-allowed', 'Firebase Console'],
  ])('%s → 包含「%s」', (code, expected) => {
    expect(authErrorMessage(fbErr(code))).toContain(expected);
  });

  it('未知 Firebase code 回傳預設訊息（不外洩英文原文）', () => {
    expect(authErrorMessage(fbErr('auth/something-weird'))).toBe('發生未知錯誤，請稍後再試');
  });

  it('AccountExistsWithDifferentCredentialError 回傳綁定提示', () => {
    const err = new AccountExistsWithDifferentCredentialError('a@b.com', fakeCred);
    expect(authErrorMessage(err)).toBe('此 email 已用其他方式註冊，請先用原本的方式登入，完成後會自動綁定');
  });

  it('一般 Error 回傳其 message', () => {
    expect(authErrorMessage(new Error('至少需要保留一種登入方式'))).toBe('至少需要保留一種登入方式');
  });

  it('非 Error 值回傳預設訊息', () => {
    expect(authErrorMessage('oops')).toBe('發生未知錯誤，請稍後再試');
    expect(authErrorMessage(null)).toBe('發生未知錯誤，請稍後再試');
    expect(authErrorMessage(new Error(''))).toBe('發生未知錯誤，請稍後再試');
  });
});

describe('isUserCancelled', () => {
  it('popup-closed-by-user / cancelled-popup-request 為 true', () => {
    expect(isUserCancelled(fbErr('auth/popup-closed-by-user'))).toBe(true);
    expect(isUserCancelled(fbErr('auth/cancelled-popup-request'))).toBe(true);
  });
  it('其他錯誤為 false', () => {
    expect(isUserCancelled(fbErr('auth/popup-blocked'))).toBe(false);
    expect(isUserCancelled(new Error('x'))).toBe(false);
    expect(isUserCancelled(undefined)).toBe(false);
  });
});

describe('OAuth 登入', () => {
  it('Google 使用 select_account 引數並回傳 user', async () => {
    const user = { uid: 'u1' };
    mocks.signInWithPopup.mockResolvedValue({ user });
    await expect(signInWithGoogle()).resolves.toBe(user);
    const provider = mocks.signInWithPopup.mock.calls[0][1];
    expect(provider.params).toEqual({ prompt: 'select_account' });
  });

  it('GitHub 請求 user:email scope', async () => {
    mocks.signInWithPopup.mockResolvedValue({ user: { uid: 'u2' } });
    await signInWithGithub();
    expect(mocks.signInWithPopup.mock.calls[0][1].scopes).toContain('user:email');
  });

  it('account-exists-with-different-credential 轉成 AccountExistsWithDifferentCredentialError', async () => {
    const err = fbErr('auth/account-exists-with-different-credential', { customData: { email: 'a@b.com' } });
    mocks.signInWithPopup.mockRejectedValue(err);
    mocks.githubCredentialFromError.mockReturnValue(fakeCred);
    const caught = await signInWithGithub().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(AccountExistsWithDifferentCredentialError);
    expect((caught as AccountExistsWithDifferentCredentialError).email).toBe('a@b.com');
    expect((caught as AccountExistsWithDifferentCredentialError).pendingCredential).toBe(fakeCred);
    expect(mocks.githubCredentialFromError).toHaveBeenCalledWith(err);
  });

  it('沒有 customData.email 時 email 為 null', async () => {
    mocks.signInWithPopup.mockRejectedValue(fbErr('auth/account-exists-with-different-credential'));
    mocks.googleCredentialFromError.mockReturnValue(fakeCred);
    const caught = await signInWithGoogle().catch((e: unknown) => e);
    expect((caught as AccountExistsWithDifferentCredentialError).email).toBeNull();
  });

  it('取不到憑證時原樣拋出', async () => {
    const err = fbErr('auth/account-exists-with-different-credential');
    mocks.signInWithPopup.mockRejectedValue(err);
    mocks.githubCredentialFromError.mockReturnValue(null);
    await expect(signInWithGithub()).rejects.toBe(err);
  });

  it('其他錯誤原樣拋出', async () => {
    const err = fbErr('auth/popup-closed-by-user');
    mocks.signInWithPopup.mockRejectedValue(err);
    await expect(signInWithGoogle()).rejects.toBe(err);
  });
});

describe('linkProvider / unlinkProvider', () => {
  it('未登入時 linkProvider 拋錯', async () => {
    await expect(linkProvider('google.com')).rejects.toThrow();
    expect(mocks.linkWithPopup).not.toHaveBeenCalled();
  });

  it('只剩一種登入方式時拒絕解綁', async () => {
    mocks.auth.currentUser = { providerData: [{ providerId: 'google.com' }] };
    await expect(unlinkProvider('google.com')).rejects.toThrow('至少需要保留一種登入方式');
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('有多種登入方式時呼叫 unlink', async () => {
    const user = { providerData: [{ providerId: 'google.com' }, { providerId: 'github.com' }] };
    mocks.auth.currentUser = user;
    mocks.unlink.mockResolvedValue(user);
    await expect(unlinkProvider('github.com')).resolves.toBe(user);
    expect(mocks.unlink).toHaveBeenCalledWith(user, 'github.com');
  });
});
