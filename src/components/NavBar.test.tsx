import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthContextValue } from '../auth/AuthContext';
import NavBar from './NavBar';

const mockUseAuth = vi.fn<() => Partial<AuthContextValue>>();
vi.mock('../auth/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

function base(overrides: Partial<AuthContextValue> = {}): Partial<AuthContextValue> {
  return {
    user: null,
    profile: null,
    loading: false,
    isAdmin: false,
    isDisabled: false,
    pendingLinkEmail: null,
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const fakeUser = { uid: 'u1', email: 'a@example.com', displayName: 'Alice', photoURL: null } as never;
const fakeProfile = {
  uid: 'u1',
  email: 'a@example.com',
  displayName: 'Alice',
  photoURL: null,
  role: 'user',
  disabled: false,
  providers: ['password'],
  createdAt: null,
  lastLoginAt: null,
} as never;

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NavBar />
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NavBar', () => {
  it('未登入顯示登入/註冊', () => {
    mockUseAuth.mockReturnValue(base());
    renderNav();
    expect(screen.getByRole('link', { name: 'Claude Flow' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '註冊' })).toHaveAttribute('href', '/register');
    expect(screen.queryByText('個人資料')).not.toBeInTheDocument();
  });

  it('loading 時右側留空', () => {
    mockUseAuth.mockReturnValue(base({ loading: true }));
    renderNav();
    expect(screen.queryByText('登入')).not.toBeInTheDocument();
    expect(screen.queryByText('登出')).not.toBeInTheDocument();
  });

  it('一般使用者：名稱、首字母頭像、個人資料、登出，無使用者管理', () => {
    mockUseAuth.mockReturnValue(base({ user: fakeUser, profile: fakeProfile }));
    renderNav();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '個人資料' })).toHaveAttribute('href', '/profile');
    expect(screen.queryByRole('link', { name: '使用者管理' })).not.toBeInTheDocument();
    // 台股分析與室內設計開放給所有登入的使用者
    expect(screen.getByRole('link', { name: '台股分析' })).toHaveAttribute('href', '/stock/');
    expect(screen.getByRole('link', { name: '室內設計' })).toHaveAttribute('href', '/interior/');
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '登入' })).not.toBeInTheDocument();
  });

  it('admin 顯示使用者管理', () => {
    mockUseAuth.mockReturnValue(base({ user: fakeUser, profile: fakeProfile, isAdmin: true }));
    renderNav();
    expect(screen.getByRole('link', { name: '使用者管理' })).toHaveAttribute('href', '/admin/users');
  });

  it('登出後導向 /login', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(base({ user: fakeUser, profile: fakeProfile, signOut }));
    renderNav();
    await userEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});
