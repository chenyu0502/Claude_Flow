import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from 'firebase/auth';
import type { AuthContextValue } from './AuthContext';
import { RequireAdmin, RequireAuth } from './guards';

const mockUseAuth = vi.fn<() => AuthContextValue>();
vi.mock('./AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../services/auth', () => ({ authErrorMessage: () => '操作失敗' }));

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { uid: 'u1' } as User,
    profile: null,
    loading: false,
    isAdmin: false,
    isDisabled: false,
    needsEmailVerification: false,
    pendingLinkEmail: null,
    signInWithGoogle: vi.fn(),
    signInWithGithub: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    resetPassword: vi.fn(),
    resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    refreshEmailVerification: vi.fn().mockResolvedValue(false),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  return <div>登入頁 from={from}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<div>首頁</div>} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/profile" element={<RequireAuth><div>個人資料內容</div></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><div>管理後台內容</div></RequireAdmin>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => mockUseAuth.mockReset());

describe('RequireAuth', () => {
  it('loading 時顯示載入畫面', () => {
    mockUseAuth.mockReturnValue(makeAuth({ loading: true, user: null }));
    renderAt('/profile');
    expect(screen.getByText('載入中…')).toHaveClass('spinner-page');
    expect(screen.queryByText('個人資料內容')).not.toBeInTheDocument();
  });

  it('未登入重導到 /login 並帶上 from', () => {
    mockUseAuth.mockReturnValue(makeAuth({ user: null }));
    renderAt('/profile');
    expect(screen.getByText('登入頁 from=/profile')).toBeInTheDocument();
  });

  it('已停用顯示提示，點登出呼叫 signOut', () => {
    const auth = makeAuth({ isDisabled: true });
    mockUseAuth.mockReturnValue(auth);
    renderAt('/profile');
    expect(screen.getByText('帳號已停用，請聯絡管理員')).toBeInTheDocument();
    expect(screen.queryByText('個人資料內容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('Email 未驗證顯示驗證提示，不渲染 children', () => {
    mockUseAuth.mockReturnValue(makeAuth({ needsEmailVerification: true, user: { uid: 'u1', email: 'a@x.tw' } as User }));
    renderAt('/profile');
    expect(screen.getByRole('heading', { name: '請驗證你的 Email' })).toBeInTheDocument();
    expect(screen.getByText('a@x.tw')).toBeInTheDocument();
    expect(screen.queryByText('個人資料內容')).not.toBeInTheDocument();
  });

  it('驗證提示：重新寄送成功顯示已寄出', async () => {
    const auth = makeAuth({ needsEmailVerification: true });
    mockUseAuth.mockReturnValue(auth);
    renderAt('/profile');
    fireEvent.click(screen.getByRole('button', { name: '重新寄送驗證信' }));
    expect(await screen.findByText(/驗證信已寄出/)).toBeInTheDocument();
    expect(auth.resendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('驗證提示：按「我已完成驗證」但還沒驗證時提示先點連結', async () => {
    const auth = makeAuth({ needsEmailVerification: true });
    mockUseAuth.mockReturnValue(auth);
    renderAt('/profile');
    fireEvent.click(screen.getByRole('button', { name: '我已完成驗證' }));
    expect(await screen.findByText(/還沒有完成驗證/)).toBeInTheDocument();
    expect(auth.refreshEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('驗證提示：切回分頁時自動檢查驗證狀態', async () => {
    const auth = makeAuth({ needsEmailVerification: true });
    mockUseAuth.mockReturnValue(auth);
    renderAt('/profile');
    fireEvent.focus(window);
    await waitFor(() => expect(auth.refreshEmailVerification).toHaveBeenCalledTimes(1));
  });

  it('已停用優先於 Email 未驗證', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isDisabled: true, needsEmailVerification: true }));
    renderAt('/profile');
    expect(screen.getByText('帳號已停用，請聯絡管理員')).toBeInTheDocument();
  });

  it('已登入正常渲染 children', () => {
    mockUseAuth.mockReturnValue(makeAuth());
    renderAt('/profile');
    expect(screen.getByText('個人資料內容')).toBeInTheDocument();
  });
});

describe('RequireAdmin', () => {
  it('loading 時顯示載入畫面', () => {
    mockUseAuth.mockReturnValue(makeAuth({ loading: true }));
    renderAt('/admin');
    expect(screen.getByText('載入中…')).toBeInTheDocument();
  });

  it('未登入重導到 /login', () => {
    mockUseAuth.mockReturnValue(makeAuth({ user: null }));
    renderAt('/admin');
    expect(screen.getByText('登入頁 from=/admin')).toBeInTheDocument();
  });

  it('已停用優先顯示停用提示（即使 isAdmin 為 false）', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isDisabled: true }));
    renderAt('/admin');
    expect(screen.getByText('帳號已停用，請聯絡管理員')).toBeInTheDocument();
    expect(screen.queryByText('沒有權限存取此頁面')).not.toBeInTheDocument();
  });

  it('非 admin 顯示 403 與回首頁連結', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isAdmin: false }));
    renderAt('/admin');
    expect(screen.getByText('沒有權限存取此頁面')).toBeInTheDocument();
    expect(screen.queryByText('管理後台內容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '回首頁' }));
    expect(screen.getByText('首頁')).toBeInTheDocument();
  });

  it('admin 透過', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isAdmin: true }));
    renderAt('/admin');
    expect(screen.getByText('管理後台內容')).toBeInTheDocument();
  });
});
