import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import LoginPage from './LoginPage';
import { useAuth, type AuthContextValue } from '../auth/AuthContext';
import { isUserCancelled } from '../services/auth';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/auth', () => ({
  authErrorMessage: vi.fn(() => '邮箱或密码错误'),
  isUserCancelled: vi.fn(() => false),
}));

const mockedUseAuth = vi.mocked(useAuth);

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    profile: null,
    loading: false,
    isAdmin: false,
    isDisabled: false,
    pendingLinkEmail: null,
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    signInWithGithub: vi.fn().mockResolvedValue(undefined),
    signInWithEmail: vi.fn().mockResolvedValue(undefined),
    signUpWithEmail: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>首页内容</div>} />
        <Route path="/profile" element={<div>个人资料内容</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(isUserCancelled).mockReturnValue(false);
});

describe('LoginPage', () => {
  it('渲染表单、OAuth 按钮与链接，input 有 label 与 autoComplete', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderLogin();
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 Google 登录/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 GitHub 登录/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute('href', '/reset-password');
    expect(screen.getByRole('link', { name: '注册' })).toHaveAttribute('href', '/register');
  });

  it('空白提交显示校验错误且不调用 signInWithEmail', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 email 和密码');
    expect(screen.getByRole('alert')).toHaveClass('alert-error');
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
  });

  it('提交调用 signInWithEmail 并导向 from', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin({ from: { pathname: '/profile' } });
    await userEvent.type(screen.getByLabelText('Email'), ' a@b.com ');
    await userEvent.type(screen.getByLabelText('密码'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(auth.signInWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1');
    expect(await screen.findByText('个人资料内容')).toBeInTheDocument();
  });

  it('提交中按钮与输入框 disabled', async () => {
    let resolve!: () => void;
    const auth = makeAuth({ signInWithEmail: vi.fn(() => new Promise<void>((r) => (resolve = r))) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('密码'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('button', { name: /使用 Google 登录/ })).toBeDisabled();
    resolve();
    expect(await screen.findByText('首页内容')).toBeInTheDocument();
  });

  it('登录失败显示 authErrorMessage 的讯息', async () => {
    const auth = makeAuth({ signInWithEmail: vi.fn().mockRejectedValue(new Error('x')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('密码'), 'wrong12');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('邮箱或密码错误');
    expect(alert).toHaveClass('alert-error');
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
  });

  it('pendingLinkEmail 存在时显示绑定提示', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ pendingLinkEmail: 'x@y.com' }));
    renderLogin();
    expect(
      screen.getByText('x@y.com 已用其他方式注册，请先用原本的方式登录，完成后会自动绑定新的登录方式'),
    ).toBeInTheDocument();
  });

  it('pendingLinkEmail 为 null 时不显示提示', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderLogin();
    expect(screen.queryByText(/已用其他方式注册/)).not.toBeInTheDocument();
  });

  it('已登录时重导到 from', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderLogin({ from: { pathname: '/profile' } });
    expect(screen.getByText('个人资料内容')).toBeInTheDocument();
  });

  it('已登录且无 from 时重导到首页', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderLogin();
    expect(screen.getByText('首页内容')).toBeInTheDocument();
  });

  it('loading 中即使有 user 也不重导', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User, loading: true }));
    renderLogin();
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('Google 登录成功导向 from', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin({ from: { pathname: '/profile' } });
    await userEvent.click(screen.getByRole('button', { name: /使用 Google 登录/ }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
    expect(await screen.findByText('个人资料内容')).toBeInTheDocument();
  });

  it('GitHub 登录失败显示错误', async () => {
    const auth = makeAuth({ signInWithGithub: vi.fn().mockRejectedValue(new Error('conflict')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /使用 GitHub 登录/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
    await waitFor(() => expect(screen.getByRole('button', { name: /使用 GitHub 登录/ })).toBeEnabled());
  });

  it('用户关闭 popup 时不显示错误', async () => {
    vi.mocked(isUserCancelled).mockReturnValue(true);
    const auth = makeAuth({ signInWithGoogle: vi.fn().mockRejectedValue(new Error('closed')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /使用 Google 登录/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /使用 Google 登录/ })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
