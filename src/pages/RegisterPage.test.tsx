import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import RegisterPage from './RegisterPage';
import { useAuth, type AuthContextValue } from '../auth/AuthContext';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/auth', () => ({
  authErrorMessage: vi.fn(() => '該 email 已被註冊'),
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
    needsEmailVerification: false,
    pendingLinkEmail: null,
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    signInWithGithub: vi.fn().mockResolvedValue(undefined),
    signInWithEmail: vi.fn().mockResolvedValue(undefined),
    signUpWithEmail: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    refreshEmailVerification: vi.fn().mockResolvedValue(true),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>首頁內容</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(v: { name?: string; email?: string; password?: string; confirm?: string }) {
  if (v.name) await userEvent.type(screen.getByLabelText('顯示名稱'), v.name);
  if (v.email) await userEvent.type(screen.getByLabelText('Email'), v.email);
  if (v.password) await userEvent.type(screen.getByLabelText('密碼'), v.password);
  if (v.confirm) await userEvent.type(screen.getByLabelText('確認密碼'), v.confirm);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: '註冊' }));

describe('RegisterPage', () => {
  it('input 有 label 與正確的 autoComplete，並提供 OAuth 按鈕', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderRegister();
    expect(screen.getByLabelText('顯示名稱')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密碼')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('確認密碼')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: /使用 Google 登入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 GitHub 登入/ })).toBeInTheDocument();
  });

  it('空白提交顯示所有必填錯誤', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await submit();
    expect(screen.getByText('請輸入顯示名稱')).toBeInTheDocument();
    expect(screen.getByText('請輸入 email')).toBeInTheDocument();
    expect(screen.getByText('請輸入密碼')).toBeInTheDocument();
    expect(screen.getByText('請再次輸入密碼')).toBeInTheDocument();
    expect(screen.getByLabelText('顯示名稱')).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('email 格式錯誤', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'not-an-email', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByText('email 格式不正確')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('密碼少於 6 字', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: '12345', confirm: '12345' });
    await submit();
    expect(screen.getByText('密碼至少需要 6 個字元')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('兩次密碼不一致', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret2' });
    await submit();
    expect(screen.getByText('兩次輸入的密碼不一致')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('名稱超過 50 字', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '名'.repeat(51), email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByText('顯示名稱不能超過 50 個字')).toBeInTheDocument();
    expect(auth.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('名稱剛好 50 字可透過', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '名'.repeat(50), email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(auth.signUpWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1', '名'.repeat(50));
  });

  it('校驗透過後呼叫 signUpWithEmail（trim）並導向首頁', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: ' 小明 ', email: ' a@b.com ', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(auth.signUpWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1', '小明');
    expect(await screen.findByText('首頁內容')).toBeInTheDocument();
  });

  it('註冊失敗顯示錯誤訊息', async () => {
    const auth = makeAuth({ signUpWithEmail: vi.fn().mockRejectedValue(new Error('in use')) });
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('該 email 已被註冊');
    expect(alert).toHaveClass('alert-error');
    expect(screen.getByRole('button', { name: '註冊' })).toBeEnabled();
  });

  it('提交中按鈕 disabled', async () => {
    const auth = makeAuth({ signUpWithEmail: vi.fn(() => new Promise<void>(() => {})) });
    mockedUseAuth.mockReturnValue(auth);
    renderRegister();
    await fill({ name: '小明', email: 'a@b.com', password: 'secret1', confirm: 'secret1' });
    await submit();
    expect(screen.getByRole('button', { name: '註冊中…' })).toBeDisabled();
  });

  it('已登入時重導到首頁', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderRegister();
    expect(screen.getByText('首頁內容')).toBeInTheDocument();
  });
});
