import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import RegisterPage from './RegisterPage';
import { useAuth, type AuthContextValue } from '../auth/AuthContext';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/auth', () => ({
  authErrorMessage: vi.fn(() => '该 email 已被注册'),
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

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>首页内容</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(v: { name?: string; email?: string; password?: string; confirm?: string }) {
  if (v.name) await userEvent.type(screen.getByLabelText('显示名称'), v.name);
  if (v.email) await userEvent.type(screen.getByLabelText('Email'), v.email);
  if (v.password) await userEvent.type(screen.getByLabelText('密码'), v.password);
  if (v.confirm) await userEvent.type(screen.getByLabelText('确认密码'), v.confirm);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: '注册' }));

describe('RegisterPage', () => {
  it('input 有 label 与正确的 autoComplete，并提供 OAuth 按钮', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderRegister();
    expect(screen.getByLabelText('显示名称')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('确认密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: /使用 Google 登录/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 GitHub 登录/ })).toBeInTheDocument();
  });

  it('空白提交显示所有必填错误', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await submit();
    expect(screen.getByText('请输入显示名称')).toBeInTheDocument();
    expect(screen.getByText('请输入 email')).toBeInTheDocument();
    expect(screen.getByText('请输入密码')).toBeInTheDocument();
    expect(screen.getByText('请再次输入密码')).toBeInTheDocument();
    expect(screen.getByLabelText('显示名称')).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('email 格式错误', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'not-an-email', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByText('email 格式不正确')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('密码少于 6 字', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: '12345', confirm: '12345' });
    await submit();
    expect(screen.getByText('密码至少需要 6 个字符')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('两次密码不一致', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret2' });
    await submit();
    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('名称超过 50 字', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '名'.repeat(51), email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByText('显示名称不能超过 50 个字')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('名称刚好 50 字可通过', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '名'.repeat(50), email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(auth.signUpWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1', '名'.repeat(50));
  });

  it('校验通过后调用 signUpWithEmail（trim）并导向首页', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: ' 小明 ', email: ' a@b.com ', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(auth.signUpWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1', '小明');
    expect(await screen.findByText('首页内容')).toBeInTheDocument();
  });

  it('注册失败显示错误讯息', async () => {
    const auth = makeAuth({ signUpWithEmail: vi.fn().mockRejectedValue(new Error('in use')) });
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('该 email 已被注册');
    expect(alert).toHaveClass('alert-error');
    expect(screen.getByRole('button', { name: '注册' })).toBeEnabled();
  });

  it('提交中按钮 disabled', async () => {
    const auth = makeAuth({ signUpWithEmail: vi.fn(() => new Promise<void>(() => {})) });
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByRole('button', { name: '注册中…' })).toBeDisabled();
  });

  it('已登录时重导到首页', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderRegister();
    expect(screen.getByText('首页内容')).toBeInTheDocument();
  });
});
