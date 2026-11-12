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
    ['auth/invalid-email', 'Email 格式不正确'],
    ['auth/user-disabled', '停用'],
    ['auth/user-not-found', 'Email 或密码错误'],
    ['auth/wrong-password', 'Email 或密码错误'],
    ['auth/invalid-credential', 'Email 或密码错误'],
    ['auth/email-already-in-use', '已被注册'],
    ['auth/weak-password', '密码强度不足'],
    ['auth/too-many-requests', '稍后再试'],
    ['auth/popup-closed-by-user', '关闭'],
    ['auth/cancelled-popup-request', '取消'],
    ['auth/popup-blocked', '拦截'],
    ['auth/network-request-failed', '网络'],
    ['auth/credential-already-in-use', '另一个账号'],
    ['auth/provider-already-linked', '已绑定过'],
    ['auth/requires-recent-login', '重新登录'],
    ['auth/operation-not-allowed', 'Firebase Console'],
  ])('%s → 包含「%s」', (code, expected) => {
    expect(authErrorMessage(fbErr(code))).toContain(expected);
  });

  it('未知 Firebase code 回传默认讯息（不外泄英文原文）', () => {
    expect(authErrorMessage(fbErr('auth/something-weird'))).toBe('发生未知错误，请稍后再试');
  });

  it('AccountExistsWithDifferentCredentialError 回传绑定提示', () => {
    const err = new AccountExistsWithDifferentCredentialError('a@b.com', fakeCred);
    expect(authErrorMessage(err)).toBe('此 email 已用其他方式注册，请先用原本的方式登录，完成后会自动绑定');
  });

  it('一般 Error 回传其 message', () => {
    expect(authErrorMessage(new Error('至少需要保留一种登录方式'))).toBe('至少需要保留一种登录方式');
  });

  it('非 Error 值回传默认讯息', () => {
    expect(authErrorMessage('oops')).toBe('发生未知错误，请稍后再试');
    expect(authErrorMessage(null)).toBe('发生未知错误，请稍后再试');
    expect(authErrorMessage(new Error(''))).toBe('发生未知错误，请稍后再试');
  });
});

describe('isUserCancelled', () => {
  it('popup-closed-by-user / cancelled-popup-request 为 true', () => {
    expect(isUserCancelled(fbErr('auth/popup-closed-by-user'))).toBe(true);
    expect(isUserCancelled(fbErr('auth/cancelled-popup-request'))).toBe(true);
  });
  it('其他错误为 false', () => {
    expect(isUserCancelled(fbErr('auth/popup-blocked'))).toBe(false);
    expect(isUserCancelled(new Error('x'))).toBe(false);
    expect(isUserCancelled(undefined)).toBe(false);
  });
});

describe('OAuth 登录', () => {
  it('Google 使用 select_account 参数并回传 user', async () => {
    const user = { uid: 'u1' };
    mocks.signInWithPopup.mockResolvedValue({ user });
    await expect(signInWithGoogle()).resolves.toBe(user);
    const provider = mocks.signInWithPopup.mock.calls[0][1];
    expect(provider.params).toEqual({ prompt: 'select_account' });
  });

  it('GitHub 请求 user:email scope', async () => {
    mocks.signInWithPopup.mockResolvedValue({ user: { uid: 'u2' } });
    await signInWithGithub();
    expect(mocks.signInWithPopup.mock.calls[0][1].scopes).toContain('user:email');
  });

  it('account-exists-with-different-credential 转成 AccountExistsWithDifferentCredentialError', async () => {
    const err = fbErr('auth/account-exists-with-different-credential', { customData: { email: 'a@b.com' } });
    mocks.signInWithPopup.mockRejectedValue(err);
    mocks.githubCredentialFromError.mockReturnValue(fakeCred);
    const caught = await signInWithGithub().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(AccountExistsWithDifferentCredentialError);
    expect((caught as AccountExistsWithDifferentCredentialError).email).toBe('a@b.com');
    expect((caught as AccountExistsWithDifferentCredentialError).pendingCredential).toBe(fakeCred);
    expect(mocks.githubCredentialFromError).toHaveBeenCalledWith(err);
  });

  it('没有 customData.email 时 email 为 null', async () => {
    mocks.signInWithPopup.mockRejectedValue(fbErr('auth/account-exists-with-different-credential'));
    mocks.googleCredentialFromError.mockReturnValue(fakeCred);
    const caught = await signInWithGoogle().catch((e: unknown) => e);
    expect((caught as AccountExistsWithDifferentCredentialError).email).toBeNull();
  });

  it('取不到凭证时原样抛出', async () => {
    const err = fbErr('auth/account-exists-with-different-credential');
    mocks.signInWithPopup.mockRejectedValue(err);
    mocks.githubCredentialFromError.mockReturnValue(null);
    await expect(signInWithGithub()).rejects.toBe(err);
  });

  it('其他错误原样抛出', async () => {
    const err = fbErr('auth/popup-closed-by-user');
    mocks.signInWithPopup.mockRejectedValue(err);
    await expect(signInWithGoogle()).rejects.toBe(err);
  });
});

describe('linkProvider / unlinkProvider', () => {
  it('未登录时 linkProvider 抛错', async () => {
    await expect(linkProvider('google.com')).rejects.toThrow();
    expect(mocks.linkWithPopup).not.toHaveBeenCalled();
  });

  it('只剩一种登录方式时拒绝解绑', async () => {
    mocks.auth.currentUser = { providerData: [{ providerId: 'google.com' }] };
    await expect(unlinkProvider('google.com')).rejects.toThrow('至少需要保留一种登录方式');
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('有多种登录方式时调用 unlink', async () => {
    const user = { providerData: [{ providerId: 'google.com' }, { providerId: 'github.com' }] };
    mocks.auth.currentUser = user;
    mocks.unlink.mockResolvedValue(user);
    await expect(unlinkProvider('github.com')).resolves.toBe(user);
    expect(mocks.unlink).toHaveBeenCalledWith(user, 'github.com');
  });
});
