import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from 'firebase/auth';
import type { AuthContextValue } from './AuthContext';
import { RequireAdmin, RequireAuth } from './guards';

const mockUseAuth = vi.fn<() => AuthContextValue>();
vi.mock('./AuthContext', () => ({ useAuth: () => mockUseAuth() }));

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { uid: 'u1' } as User,
    profile: null,
    loading: false,
    isAdmin: false,
    isDisabled: false,
    pendingLinkEmail: null,
    signInWithGoogle: vi.fn(),
    signInWithGithub: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    resetPassword: vi.fn(),
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
