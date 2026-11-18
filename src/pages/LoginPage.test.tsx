import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import LoginPage from './LoginPage';
import { useAuth, type AuthContextValue } from '../auth/AuthContext';
import { isUserCancelled } from '../services/auth';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/auth', () => ({
  authErrorMessage: vi.fn(() => '電子郵件或密碼錯誤'),
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

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>首頁內容</div>} />
        <Route path="/profile" element={<div>個人資料內容</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(isUserCancelled).mockReturnValue(false);
});

describe('LoginPage', () => {
  it('渲染表單、OAuth 按鈕與連結，input 有 label 與 autoComplete', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderLogin();
    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 Google 登入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /使用 GitHub 登入/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密碼')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: '忘記密碼？' })).toHaveAttribute('href', '/reset-password');
    expect(screen.getByRole('link', { name: '註冊' })).toHaveAttribute('href', '/register');
  });

  it('空白提交顯示校驗錯誤且不呼叫 signInWithEmail', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入 email 和密碼');
    expect(screen.getByRole('alert')).toHaveClass('alert-error');
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
  });

  it('提交呼叫 signInWithEmail 並導向 from', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin({ from: { pathname: '/profile' } });
    await userEvent.type(screen.getByLabelText('Email'), ' a@b.com ');
    await userEvent.type(screen.getByLabelText('密碼'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(auth.signInWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1');
    expect(await screen.findByText('個人資料內容')).toBeInTheDocument();
  });

  it('提交中按鈕與輸入框 disabled', async () => {
    let resolve!: () => void;
    const auth = makeAuth({ signInWithEmail: vi.fn(() => new Promise<void>((r) => (resolve = r))) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('密碼'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(screen.getByRole('button', { name: '登入中…' })).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('button', { name: /使用 Google 登入/ })).toBeDisabled();
    resolve();
    expect(await screen.findByText('首頁內容')).toBeInTheDocument();
  });

  it('登入失敗顯示 authErrorMessage 的訊息', async () => {
    const auth = makeAuth({ signInWithEmail: vi.fn().mockRejectedValue(new Error('x')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('密碼'), 'wrong12');
    await userEvent.click(screen.getByRole('button', { name: '登入' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('電子郵件或密碼錯誤');
    expect(alert).toHaveClass('alert-error');
    expect(screen.getByRole('button', { name: '登入' })).toBeEnabled();
  });

  it('pendingLinkEmail 存在時顯示綁定提示', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ pendingLinkEmail: 'x@y.com' }));
    renderLogin();
    expect(
      screen.getByText('x@y.com 已用其他方式註冊，請先用原本的方式登入，完成後會自動綁定新的登入方式'),
    ).toBeInTheDocument();
  });

  it('pendingLinkEmail 為 null 時不顯示提示', () => {
    mockedUseAuth.mockReturnValue(makeAuth());
    renderLogin();
    expect(screen.queryByText(/已用其他方式註冊/)).not.toBeInTheDocument();
  });

  it('已登入時重導到 from', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderLogin({ from: { pathname: '/profile' } });
    expect(screen.getByText('個人資料內容')).toBeInTheDocument();
  });

  it('已登入且無 from 時重導到首頁', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User }));
    renderLogin();
    expect(screen.getByText('首頁內容')).toBeInTheDocument();
  });

  it('loading 中即使有 user 也不重導', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: { uid: 'u1' } as User, loading: true }));
    renderLogin();
    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
  });

  it('Google 登入成功導向 from', async () => {
    const auth = makeAuth();
    mockedUseAuth.mockReturnValue(auth);
    renderLogin({ from: { pathname: '/profile' } });
    await userEvent.click(screen.getByRole('button', { name: /使用 Google 登入/ }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
    expect(await screen.findByText('個人資料內容')).toBeInTheDocument();
  });

  it('GitHub 登入失敗顯示錯誤', async () => {
    const auth = makeAuth({ signInWithGithub: vi.fn().mockRejectedValue(new Error('conflict')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /使用 GitHub 登入/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('電子郵件或密碼錯誤');
    await waitFor(() => expect(screen.getByRole('button', { name: /使用 GitHub 登入/ })).toBeEnabled());
  });

  it('使用者關閉 popup 時不顯示錯誤', async () => {
    vi.mocked(isUserCancelled).mockReturnValue(true);
    const auth = makeAuth({ signInWithGoogle: vi.fn().mockRejectedValue(new Error('closed')) });
    mockedUseAuth.mockReturnValue(auth);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /使用 Google 登入/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /使用 Google 登入/ })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
