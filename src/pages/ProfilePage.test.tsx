import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AuthContextValue } from '../auth/AuthContext';
import ProfilePage, { validateProfile } from './ProfilePage';

const mockUseAuth = vi.fn<() => Partial<AuthContextValue>>();
vi.mock('../auth/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const users = vi.hoisted(() => ({
  updateOwnProfile: vi.fn(),
  ensureUserProfile: vi.fn(),
}));
vi.mock('../services/users', () => users);

const authSvc = vi.hoisted(() => ({
  linkProvider: vi.fn(),
  unlinkProvider: vi.fn(),
  authErrorMessage: vi.fn(() => '操作失败'),
  isUserCancelled: vi.fn(() => false),
}));
vi.mock('../services/auth', () => authSvc);

const fb = vi.hoisted(() => ({ auth: { currentUser: null as unknown } }));
vi.mock('../lib/firebase', () => fb);

function makeUser(providerIds: string[]) {
  const u = {
    uid: 'u1',
    email: 'a@example.com',
    displayName: 'Alice',
    photoURL: null,
    providerData: providerIds.map((providerId) => ({ providerId })),
    reload: vi.fn().mockResolvedValue(undefined),
  };
  return u;
}

const profile = {
  uid: 'u1',
  email: 'a@example.com',
  displayName: 'Alice',
  photoURL: null,
  role: 'user' as const,
  disabled: false,
  providers: [],
  createdAt: null,
  lastLoginAt: { toDate: () => new Date(2024, 0, 2, 3, 4, 5) },
};

function setup(providerIds: string[]) {
  const user = makeUser(providerIds);
  fb.auth.currentUser = user;
  mockUseAuth.mockReturnValue({
    user: user as never,
    profile: profile as never,
    loading: false,
    isAdmin: false,
    isDisabled: false,
  });
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  users.updateOwnProfile.mockResolvedValue(undefined);
  users.ensureUserProfile.mockResolvedValue(undefined);
  authSvc.isUserCancelled.mockReturnValue(false);
});

describe('validateProfile', () => {
  it('校验规则', () => {
    expect(validateProfile('  ', '')).toMatch('不能为空');
    expect(validateProfile('a'.repeat(51), '')).toMatch('50');
    expect(validateProfile('a'.repeat(50), '')).toBeNull();
    expect(validateProfile('Bob', 'http://x.com/a.png')).toMatch('https://');
    expect(validateProfile('Bob', 'https://x.com/a.png')).toBeNull();
  });
});

describe('ProfilePage', () => {
  it('显示 email、角色与时间（null 显示 —）', () => {
    setup(['password']);
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByText('一般用户')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('显示名称为空时不保存并显示错误', async () => {
    setup(['password']);
    const input = screen.getByLabelText('显示名称');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能为空');
    expect(users.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('头像网址非 https 时不保存', async () => {
    setup(['password']);
    await userEvent.type(screen.getByLabelText('头像网址'), 'http://x.com/a.png');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('https://');
    expect(users.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('合法输入调用 updateOwnProfile 并显示成功', async () => {
    setup(['password']);
    const name = screen.getByLabelText('显示名称');
    await userEvent.clear(name);
    await userEvent.type(name, '  Bob  ');
    await userEvent.type(screen.getByLabelText('头像网址'), 'https://x.com/a.png');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(users.updateOwnProfile).toHaveBeenCalledWith('u1', {
      displayName: 'Bob',
      photoURL: 'https://x.com/a.png',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('已保存');
  });

  it('保存失败显示错误', async () => {
    users.updateOwnProfile.mockRejectedValue(new Error('x'));
    setup(['password']);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败');
  });

  it('只剩一种登录方式时解除按钮 disabled', () => {
    setup(['google.com']);
    expect(screen.getByRole('button', { name: '解除' })).toBeDisabled();
    expect(screen.getByText(/只剩一种登录方式/)).toBeInTheDocument();
    // 未绑定的 github 可绑定，password 显示未设置
    expect(screen.getByRole('button', { name: '绑定' })).toBeEnabled();
    expect(screen.getByText('未设置')).toBeInTheDocument();
  });

  it('两种登录方式时可解除，成功后 reload 并同步 Firestore', async () => {
    const user = setup(['google.com', 'password']);
    authSvc.unlinkProvider.mockImplementation(async () => {
      user.providerData = [{ providerId: 'password' }];
      return user;
    });
    const buttons = screen.getAllByRole('button', { name: '解除' });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeEnabled());
    await userEvent.click(buttons[0]);
    expect(authSvc.unlinkProvider).toHaveBeenCalledWith('google.com');
    await waitFor(() => expect(users.ensureUserProfile).toHaveBeenCalledWith(user));
    expect(user.reload).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '解除' })).toBeDisabled();
  });

  it('用户取消绑定时不显示错误', async () => {
    authSvc.linkProvider.mockRejectedValue(new Error('cancelled'));
    authSvc.isUserCancelled.mockReturnValue(true);
    setup(['password']);
    await userEvent.click(screen.getAllByRole('button', { name: '绑定' })[0]);
    expect(authSvc.linkProvider).toHaveBeenCalledWith('google.com');
    await waitFor(() => expect(screen.getAllByRole('button', { name: '绑定' })[0]).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
