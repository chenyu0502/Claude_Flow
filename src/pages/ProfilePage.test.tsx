import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AuthContextValue } from '../auth/AuthContext';
import ProfilePage, { validatePasswordChange, validateProfile } from './ProfilePage';

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
  changePassword: vi.fn(),
  authErrorMessage: vi.fn(() => '操作失敗'),
  isUserCancelled: vi.fn(() => false),
}));
vi.mock('../services/auth', () => authSvc);

const auditLog = vi.hoisted(() => ({
  logSelfEvent: vi.fn(),
  subscribeOwnLogs: vi.fn(),
  describeDetail: (l: { detail: { method?: string } }) => l.detail.method ?? '',
  AUDIT_TYPE_LABELS: { login: '登入', logout: '登出' },
}));
vi.mock('../services/auditLog', () => auditLog);

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
  auditLog.logSelfEvent.mockResolvedValue(undefined);
  auditLog.subscribeOwnLogs.mockReturnValue(() => {});
});

describe('validateProfile', () => {
  it('校驗規則', () => {
    expect(validateProfile('  ', '')).toMatch('不能為空');
    expect(validateProfile('a'.repeat(51), '')).toMatch('50');
    expect(validateProfile('a'.repeat(50), '')).toBeNull();
    expect(validateProfile('Bob', 'http://x.com/a.png')).toMatch('https://');
    expect(validateProfile('Bob', 'https://x.com/a.png')).toBeNull();
  });
});

describe('ProfilePage', () => {
  it('顯示 email、角色與時間（null 顯示 —）', () => {
    setup(['password']);
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByText('一般使用者')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('顯示名稱為空時不儲存並顯示錯誤', async () => {
    setup(['password']);
    const input = screen.getByLabelText('顯示名稱');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能為空');
    expect(users.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('頭像網址非 https 時不儲存', async () => {
    setup(['password']);
    await userEvent.type(screen.getByLabelText('頭像網址'), 'http://x.com/a.png');
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('https://');
    expect(users.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('合法輸入呼叫 updateOwnProfile 並顯示成功', async () => {
    setup(['password']);
    const name = screen.getByLabelText('顯示名稱');
    await userEvent.clear(name);
    await userEvent.type(name, '  Bob  ');
    await userEvent.type(screen.getByLabelText('頭像網址'), 'https://x.com/a.png');
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(users.updateOwnProfile).toHaveBeenCalledWith('u1', {
      displayName: 'Bob',
      photoURL: 'https://x.com/a.png',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('已儲存');
  });

  it('儲存失敗顯示錯誤', async () => {
    users.updateOwnProfile.mockRejectedValue(new Error('x'));
    setup(['password']);
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失敗');
  });

  it('只剩一種登入方式時解除按鈕 disabled', () => {
    setup(['google.com']);
    expect(screen.getByRole('button', { name: '解除' })).toBeDisabled();
    expect(screen.getByText(/只剩一種登入方式/)).toBeInTheDocument();
    // 未綁定的 github 可綁定，password 顯示未設定
    expect(screen.getByRole('button', { name: '綁定' })).toBeEnabled();
    expect(screen.getByText('未設定')).toBeInTheDocument();
  });

  it('兩種登入方式時可解除，成功後 reload 並同步 Firestore', async () => {
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

  it('使用者取消綁定時不顯示錯誤', async () => {
    authSvc.linkProvider.mockRejectedValue(new Error('cancelled'));
    authSvc.isUserCancelled.mockReturnValue(true);
    setup(['password']);
    await userEvent.click(screen.getAllByRole('button', { name: '綁定' })[0]);
    expect(authSvc.linkProvider).toHaveBeenCalledWith('google.com');
    await waitFor(() => expect(screen.getAllByRole('button', { name: '綁定' })[0]).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('validatePasswordChange', () => {
  it('檢查規則', () => {
    expect(validatePasswordChange('', 'newpass', 'newpass')).toMatch('目前的密碼');
    expect(validatePasswordChange('old123', '', '')).toMatch('請輸入新密碼');
    expect(validatePasswordChange('old123', '12345', '12345')).toMatch('至少需要 6');
    expect(validatePasswordChange('old123', 'old123', 'old123')).toMatch('不能與目前的密碼相同');
    expect(validatePasswordChange('old123', 'new123', 'new124')).toMatch('不一致');
    expect(validatePasswordChange('old123', 'new123', 'new123')).toBeNull();
  });
});

describe('修改密碼', () => {
  async function fillAndSubmit(current: string, next: string, confirm: string) {
    await userEvent.type(screen.getByLabelText('目前的密碼'), current);
    await userEvent.type(screen.getByLabelText('新密碼'), next);
    await userEvent.type(screen.getByLabelText('再次輸入新密碼'), confirm);
    await userEvent.click(screen.getByRole('button', { name: '更新密碼' }));
  }

  it('沒有綁定 Email/密碼的帳號不顯示', () => {
    setup(['google.com']);
    expect(screen.queryByRole('heading', { name: '修改密碼' })).not.toBeInTheDocument();
  });

  it('成功後清空表單並顯示已更新', async () => {
    authSvc.changePassword.mockResolvedValue(undefined);
    setup(['password']);
    await fillAndSubmit('old123', 'new123', 'new123');
    expect(authSvc.changePassword).toHaveBeenCalledWith('old123', 'new123');
    expect(await screen.findByText('密碼已更新')).toBeInTheDocument();
    expect(screen.getByLabelText('目前的密碼')).toHaveValue('');
  });

  it('表單檢查不通過時不呼叫 changePassword', async () => {
    setup(['password']);
    await fillAndSubmit('old123', 'new123', 'oops');
    expect(await screen.findByRole('alert')).toHaveTextContent('不一致');
    expect(authSvc.changePassword).not.toHaveBeenCalled();
  });

  it('失敗時顯示錯誤訊息', async () => {
    authSvc.changePassword.mockRejectedValue(new Error('目前的密碼不正確'));
    setup(['password']);
    await fillAndSubmit('wrong1', 'new123', 'new123');
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失敗');
  });
});

describe('操作紀錄', () => {
  it('改密碼成功記 password_change', async () => {
    authSvc.changePassword.mockResolvedValue(undefined);
    setup(['password']);
    await userEvent.type(screen.getByLabelText('目前的密碼'), 'old123');
    await userEvent.type(screen.getByLabelText('新密碼'), 'new123');
    await userEvent.type(screen.getByLabelText('再次輸入新密碼'), 'new123');
    await userEvent.click(screen.getByRole('button', { name: '更新密碼' }));
    await screen.findByText('密碼已更新');
    expect(auditLog.logSelfEvent).toHaveBeenCalledWith('password_change', {});
  });

  it('改密碼失敗不記', async () => {
    authSvc.changePassword.mockRejectedValue(new Error('x'));
    setup(['password']);
    await userEvent.type(screen.getByLabelText('目前的密碼'), 'old123');
    await userEvent.type(screen.getByLabelText('新密碼'), 'new123');
    await userEvent.type(screen.getByLabelText('再次輸入新密碼'), 'new123');
    await userEvent.click(screen.getByRole('button', { name: '更新密碼' }));
    await screen.findByRole('alert');
    expect(auditLog.logSelfEvent).not.toHaveBeenCalled();
  });

  it('儲存個人資料只記有變的欄位；沒改就不記', async () => {
    setup(['google.com']);
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    await screen.findByText('已儲存');
    expect(auditLog.logSelfEvent).not.toHaveBeenCalled();

    const name = screen.getByLabelText('顯示名稱');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bob');
    await userEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() =>
      expect(auditLog.logSelfEvent).toHaveBeenCalledWith('profile_update', { fields: ['displayName'] }),
    );
  });

  it('綁定成功記 provider_link', async () => {
    authSvc.linkProvider.mockResolvedValue({});
    setup(['password']);
    await userEvent.click(screen.getAllByRole('button', { name: '綁定' })[0]);
    await waitFor(() => expect(auditLog.logSelfEvent).toHaveBeenCalledWith('provider_link', { provider: 'google.com' }));
  });
});

describe('帳號活動', () => {
  type Cb = (logs: unknown[]) => void;
  const lastCallback = (): Cb => auditLog.subscribeOwnLogs.mock.calls.at(-1)![2] as Cb;

  it('訂閱自己的紀錄並列出', async () => {
    setup(['google.com']);
    expect(auditLog.subscribeOwnLogs).toHaveBeenCalledWith('u1', 10, expect.any(Function), expect.any(Function));
    expect(screen.getByText('載入中…')).toBeInTheDocument();
    act(() =>
      lastCallback()([
        {
          id: 'l1',
          type: 'login',
          detail: { method: 'Google' },
          device: 'Chrome · Windows',
          createdAt: { toDate: () => new Date(2026, 10, 18, 9, 30) },
        },
      ]),
    );
    expect(screen.getByText('登入')).toBeInTheDocument();
    expect(screen.getByText(/Chrome · Windows/)).toBeInTheDocument();
  });

  it('沒有紀錄時顯示提示', () => {
    setup(['google.com']);
    act(() => lastCallback()([]));
    expect(screen.getByText('還沒有紀錄')).toBeInTheDocument();
  });
});
