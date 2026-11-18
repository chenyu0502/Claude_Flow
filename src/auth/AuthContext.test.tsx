import { act, render, screen, waitFor } from '@testing-library/react';
import type { AuthCredential, User } from 'firebase/auth';
import type { UserProfile } from '../types/user';
import { AuthProvider, useAuth, type AuthContextValue } from './AuthContext';
import * as authService from '../services/auth';
import * as usersService from '../services/users';
import { AccountExistsWithDifferentCredentialError } from '../services/auth';

// ---- mocks ----
let authListener: ((u: User | null) => void) | null = null;
const authUnsub = vi.fn();

const fbAuth = vi.hoisted(() => ({ currentUser: null as unknown }));
vi.mock('../lib/firebase', () => ({ auth: fbAuth }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: User | null) => void) => {
    authListener = cb;
    return authUnsub;
  },
}));
vi.mock('../services/auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/auth')>();
  return {
    AccountExistsWithDifferentCredentialError: orig.AccountExistsWithDifferentCredentialError,
    signInWithGoogle: vi.fn(),
    signInWithGithub: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    sendResetEmail: vi.fn(),
    signOutUser: vi.fn(),
    linkPendingCredential: vi.fn(),
    sendVerificationEmail: vi.fn(),
  };
});
vi.mock('../services/users', () => ({
  ensureUserProfile: vi.fn(),
  subscribeUserProfile: vi.fn(),
}));

const svc = vi.mocked(authService);
const users = vi.mocked(usersService);

type ProfileCb = (p: UserProfile | null) => void;
/** uid → 最近一次訂閱的回撥與退訂函式 */
let subs: Record<string, { onData: ProfileCb; onError?: (e: Error) => void; unsub: ReturnType<typeof vi.fn> }>;

const makeUser = (uid: string) => ({ uid } as User);
const makeProfile = (uid: string, extra: Partial<UserProfile> = {}): UserProfile => ({
  uid,
  email: `${uid}@x.com`,
  displayName: null,
  photoURL: null,
  role: 'user',
  disabled: false,
  providers: ['google.com'],
  createdAt: null,
  lastLoginAt: null,
  ...extra,
});

let ctx: AuthContextValue;
function Probe() {
  ctx = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="uid">{ctx.user?.uid ?? 'none'}</span>
      <span data-testid="profile">{ctx.profile?.uid ?? 'none'}</span>
      <span data-testid="pending">{ctx.pendingLinkEmail ?? 'none'}</span>
    </div>
  );
}
const text = (id: string) => screen.getByTestId(id).textContent;

function setup() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}
const emitAuth = (u: User | null) =>
  act(async () => {
    authListener!(u);
  });

beforeEach(() => {
  vi.clearAllMocks();
  fbAuth.currentUser = null;
  authListener = null;
  subs = {};
  users.ensureUserProfile.mockResolvedValue(undefined);
  users.subscribeUserProfile.mockImplementation((uid, onData, onError) => {
    const unsub = vi.fn();
    subs[uid] = { onData, onError, unsub };
    return unsub;
  });
  svc.signOutUser.mockResolvedValue(undefined);
});

describe('AuthProvider', () => {
  it('首次判定未登入 → loading=false', async () => {
    setup();
    expect(text('loading')).toBe('true');
    await emitAuth(null);
    expect(text('loading')).toBe('false');
    expect(text('uid')).toBe('none');
  });

  it('登入後等首次 profile 快照才結束 loading，並計算 isAdmin / isDisabled', async () => {
    setup();
    const u = makeUser('a');
    await emitAuth(u);
    expect(text('loading')).toBe('true');
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(users.ensureUserProfile).toHaveBeenCalledWith(u);
    expect(text('loading')).toBe('true');

    act(() => subs.a.onData(makeProfile('a', { role: 'admin' })));
    expect(text('loading')).toBe('false');
    expect(text('profile')).toBe('a');
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.isDisabled).toBe(false);

    act(() => subs.a.onData(makeProfile('a', { role: 'admin', disabled: true })));
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.isDisabled).toBe(true);
  });

  it('ensureUserProfile 失敗：記 console.error，仍訂閱並結束 loading', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    users.ensureUserProfile.mockRejectedValue(new Error('permission-denied'));
    setup();
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(errSpy).toHaveBeenCalled();
    act(() => subs.a.onData(makeProfile('a', { disabled: true })));
    expect(text('loading')).toBe('false');
    expect(ctx.isDisabled).toBe(true);
    errSpy.mockRestore();
  });

  it('profile 訂閱出錯也結束 loading', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    act(() => subs.a.onError!(new Error('boom')));
    expect(text('loading')).toBe('false');
    expect(text('profile')).toBe('none');
    errSpy.mockRestore();
  });

  it('登出時退訂 profile', async () => {
    setup();
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    act(() => subs.a.onData(makeProfile('a')));
    await emitAuth(null);
    expect(subs.a.unsub).toHaveBeenCalled();
    expect(text('profile')).toBe('none');
    expect(text('loading')).toBe('false');
  });

  it('快速切換使用者：舊使用者遲到的結果不覆蓋新使用者', async () => {
    let resolveA!: () => void;
    users.ensureUserProfile.mockImplementation((u: User) =>
      u.uid === 'a' ? new Promise<void>((r) => (resolveA = r)) : Promise.resolve(),
    );
    setup();
    await emitAuth(makeUser('a'));
    await emitAuth(makeUser('b'));
    await waitFor(() => expect(subs.b).toBeDefined());
    act(() => subs.b.onData(makeProfile('b')));

    await act(async () => resolveA());
    expect(subs.a).toBeUndefined(); // 舊世代不再訂閱
    expect(text('uid')).toBe('b');
    expect(text('profile')).toBe('b');
  });

  it('解除安裝時退訂 auth 與 profile', async () => {
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(subs.a).toBeDefined());
    unmount();
    expect(authUnsub).toHaveBeenCalled();
    expect(subs.a.unsub).toHaveBeenCalled();
  });
});

describe('帳號衝突 pending link 流程', () => {
  const cred = { providerId: 'github.com' } as AuthCredential;

  it('衝突 → 存 pending 並繼續拋出；用原方式登入後自動綁定並清掉 pending', async () => {
    svc.signInWithGithub.mockRejectedValue(new AccountExistsWithDifferentCredentialError('x@y.com', cred));
    setup();
    await emitAuth(null);

    let thrown: unknown;
    await act(async () => {
      await ctx.signInWithGithub().catch((e) => (thrown = e));
    });
    expect(thrown).toBeInstanceOf(AccountExistsWithDifferentCredentialError);
    expect(text('pending')).toBe('x@y.com');

    const u = makeUser('a');
    const linked = makeUser('a');
    svc.linkPendingCredential.mockResolvedValue(linked);
    await emitAuth(u);
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(svc.linkPendingCredential).toHaveBeenCalledWith(u, cred);
    expect(users.ensureUserProfile).toHaveBeenCalledWith(linked);
    expect(text('pending')).toBe('none');

    // 憑證只綁定一次
    await emitAuth(null);
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalledTimes(2));
    expect(svc.linkPendingCredential).toHaveBeenCalledTimes(1);
  });

  it('綁定失敗：記錯誤、清掉 pending、仍繼續載入 profile', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    svc.signInWithGoogle.mockRejectedValue(new AccountExistsWithDifferentCredentialError(null, cred));
    setup();
    await emitAuth(null);
    await act(async () => {
      await ctx.signInWithGoogle().catch(() => {});
    });
    expect(text('pending')).not.toBe('none'); // email 為 null 時用佔位文字

    svc.linkPendingCredential.mockRejectedValue(new Error('auth/credential-already-in-use'));
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(errSpy).toHaveBeenCalled();
    expect(text('pending')).toBe('none');
    errSpy.mockRestore();
  });

  it('signOut 清掉 pending，之後登入不再綁定', async () => {
    svc.signInWithEmail.mockRejectedValue(new AccountExistsWithDifferentCredentialError('x@y.com', cred));
    setup();
    await emitAuth(null);
    await act(async () => {
      await ctx.signInWithEmail('x@y.com', 'pw').catch(() => {});
    });
    expect(text('pending')).toBe('x@y.com');

    await act(async () => {
      await ctx.signOut();
    });
    expect(svc.signOutUser).toHaveBeenCalled();
    expect(text('pending')).toBe('none');

    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(svc.linkPendingCredential).not.toHaveBeenCalled();
  });

  it('非衝突錯誤不設定 pending，原樣拋出', async () => {
    const err = new Error('auth/wrong-password');
    svc.signInWithEmail.mockRejectedValue(err);
    setup();
    await emitAuth(null);
    let thrown: unknown;
    await act(async () => {
      await ctx.signInWithEmail('a@b.c', 'x').catch((e) => (thrown = e));
    });
    expect(thrown).toBe(err);
    expect(text('pending')).toBe('none');
  });
});

describe('Email 驗證狀態', () => {
  const passwordUser = (emailVerified: boolean) =>
    ({
      uid: 'p',
      emailVerified,
      providerData: [{ providerId: 'password' }],
      reload: vi.fn().mockResolvedValue(undefined),
      getIdToken: vi.fn().mockResolvedValue('t'),
    }) as unknown as User & { reload: ReturnType<typeof vi.fn>; getIdToken: ReturnType<typeof vi.fn> };

  it('Email/密碼未驗證 → needsEmailVerification 為 true；Google 帳號為 false', async () => {
    setup();
    await emitAuth(passwordUser(false));
    expect(ctx.needsEmailVerification).toBe(true);
    await emitAuth({ uid: 'g', emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User);
    expect(ctx.needsEmailVerification).toBe(false);
  });

  it('refreshEmailVerification：驗證完成後換新 token 並解除', async () => {
    setup();
    const u = passwordUser(false);
    fbAuth.currentUser = u;
    await emitAuth(u);
    u.reload.mockImplementation(async () => {
      (u as { emailVerified: boolean }).emailVerified = true;
    });
    let verified = false;
    await act(async () => {
      verified = await ctx.refreshEmailVerification();
    });
    expect(verified).toBe(true);
    expect(u.getIdToken).toHaveBeenCalledWith(true);
    expect(ctx.needsEmailVerification).toBe(false);
  });

  it('refreshEmailVerification：還沒驗證 → 回傳 false，不換 token', async () => {
    setup();
    const u = passwordUser(false);
    fbAuth.currentUser = u;
    await emitAuth(u);
    let verified = true;
    await act(async () => {
      verified = await ctx.refreshEmailVerification();
    });
    expect(verified).toBe(false);
    expect(u.getIdToken).not.toHaveBeenCalled();
    expect(ctx.needsEmailVerification).toBe(true);
  });

  it('resendVerificationEmail 呼叫服務層寄信', async () => {
    setup();
    svc.sendVerificationEmail.mockResolvedValue(undefined);
    await act(async () => {
      await ctx.resendVerificationEmail();
    });
    expect(svc.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });
});
