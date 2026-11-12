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
  return <div>登录页 from={from}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<div>首页</div>} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/profile" element={<RequireAuth><div>个人资料内容</div></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><div>管理后台内容</div></RequireAdmin>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => mockUseAuth.mockReset());

describe('RequireAuth', () => {
  it('loading 时显示载入画面', () => {
    mockUseAuth.mockReturnValue(makeAuth({ loading: true, user: null }));
    renderAt('/profile');
    expect(screen.getByText('载入中…')).toHaveClass('spinner-page');
    expect(screen.queryByText('个人资料内容')).not.toBeInTheDocument();
  });

  it('未登录重导到 /login 并带上 from', () => {
    mockUseAuth.mockReturnValue(makeAuth({ user: null }));
    renderAt('/profile');
    expect(screen.getByText('登录页 from=/profile')).toBeInTheDocument();
  });

  it('已停用显示提示，点登出调用 signOut', () => {
    const auth = makeAuth({ isDisabled: true });
    mockUseAuth.mockReturnValue(auth);
    renderAt('/profile');
    expect(screen.getByText('账号已停用，请联系管理员')).toBeInTheDocument();
    expect(screen.queryByText('个人资料内容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('已登录正常渲染 children', () => {
    mockUseAuth.mockReturnValue(makeAuth());
    renderAt('/profile');
    expect(screen.getByText('个人资料内容')).toBeInTheDocument();
  });
});

describe('RequireAdmin', () => {
  it('loading 时显示载入画面', () => {
    mockUseAuth.mockReturnValue(makeAuth({ loading: true }));
    renderAt('/admin');
    expect(screen.getByText('载入中…')).toBeInTheDocument();
  });

  it('未登录重导到 /login', () => {
    mockUseAuth.mockReturnValue(makeAuth({ user: null }));
    renderAt('/admin');
    expect(screen.getByText('登录页 from=/admin')).toBeInTheDocument();
  });

  it('已停用优先显示停用提示（即使 isAdmin 为 false）', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isDisabled: true }));
    renderAt('/admin');
    expect(screen.getByText('账号已停用，请联系管理员')).toBeInTheDocument();
    expect(screen.queryByText('没有权限访问此页面')).not.toBeInTheDocument();
  });

  it('非 admin 显示 403 与回首页链接', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isAdmin: false }));
    renderAt('/admin');
    expect(screen.getByText('没有权限访问此页面')).toBeInTheDocument();
    expect(screen.queryByText('管理后台内容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '回首页' }));
    expect(screen.getByText('首页')).toBeInTheDocument();
  });

  it('admin 通过', () => {
    mockUseAuth.mockReturnValue(makeAuth({ isAdmin: true }));
    renderAt('/admin');
    expect(screen.getByText('管理后台内容')).toBeInTheDocument();
  });
});
