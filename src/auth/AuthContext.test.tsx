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

vi.mock('../lib/firebase', () => ({ auth: {} }));
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
  };
});
vi.mock('../services/users', () => ({
  ensureUserProfile: vi.fn(),
  subscribeUserProfile: vi.fn(),
}));

const svc = vi.mocked(authService);
const users = vi.mocked(usersService);

type ProfileCb = (p: UserProfile | null) => void;
/** uid → 最近一次订阅的回调与退订函数 */
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
  it('首次判定未登录 → loading=false', async () => {
    setup();
    expect(text('loading')).toBe('true');
    await emitAuth(null);
    expect(text('loading')).toBe('false');
    expect(text('uid')).toBe('none');
  });

  it('登录后等首次 profile 快照才结束 loading，并计算 isAdmin / isDisabled', async () => {
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

  it('ensureUserProfile 失败：记 console.error，仍订阅并结束 loading', async () => {
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

  it('profile 订阅出错也结束 loading', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    act(() => subs.a.onError!(new Error('boom')));
    expect(text('loading')).toBe('false');
    expect(text('profile')).toBe('none');
    errSpy.mockRestore();
  });

  it('登出时退订 profile', async () => {
    setup();
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    act(() => subs.a.onData(makeProfile('a')));
    await emitAuth(null);
    expect(subs.a.unsub).toHaveBeenCalled();
    expect(text('profile')).toBe('none');
    expect(text('loading')).toBe('false');
  });

  it('快速切换用户：旧用户迟到的结果不覆盖新用户', async () => {
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
    expect(subs.a).toBeUndefined(); // 旧世代不再订阅
    expect(text('uid')).toBe('b');
    expect(text('profile')).toBe('b');
  });

  it('卸载时退订 auth 与 profile', async () => {
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

describe('账号冲突 pending link 流程', () => {
  const cred = { providerId: 'github.com' } as AuthCredential;

  it('冲突 → 存 pending 并继续抛出；用原方式登录后自动绑定并清掉 pending', async () => {
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

    // 凭证只绑定一次
    await emitAuth(null);
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalledTimes(2));
    expect(svc.linkPendingCredential).toHaveBeenCalledTimes(1);
  });

  it('绑定失败：记错误、清掉 pending、仍继续载入 profile', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    svc.signInWithGoogle.mockRejectedValue(new AccountExistsWithDifferentCredentialError(null, cred));
    setup();
    await emitAuth(null);
    await act(async () => {
      await ctx.signInWithGoogle().catch(() => {});
    });
    expect(text('pending')).not.toBe('none'); // email 为 null 时用占位文字

    svc.linkPendingCredential.mockRejectedValue(new Error('auth/credential-already-in-use'));
    await emitAuth(makeUser('a'));
    await waitFor(() => expect(users.subscribeUserProfile).toHaveBeenCalled());
    expect(errSpy).toHaveBeenCalled();
    expect(text('pending')).toBe('none');
    errSpy.mockRestore();
  });

  it('signOut 清掉 pending，之后登录不再绑定', async () => {
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

  it('非冲突错误不设置 pending，原样抛出', async () => {
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
