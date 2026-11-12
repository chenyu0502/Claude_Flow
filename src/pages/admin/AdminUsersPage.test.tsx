import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserProfile } from '../../types/user';
import AdminUsersPage from './AdminUsersPage';

const mocks = vi.hoisted(() => ({
  subscribeAllUsers: vi.fn(),
  setUserRole: vi.fn(),
  setUserDisabled: vi.fn(),
  useAuth: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../../services/users', () => ({
  subscribeAllUsers: mocks.subscribeAllUsers,
  setUserRole: mocks.setUserRole,
  setUserDisabled: mocks.setUserDisabled,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

const ts = (iso: string) => ({ toDate: () => new Date(iso) }) as any;

const USERS: UserProfile[] = [
  {
    uid: 'me',
    email: 'boss@example.com',
    displayName: 'Boss',
    photoURL: null,
    role: 'admin',
    disabled: false,
    providers: ['google.com'],
    createdAt: ts('2026-01-01T00:00:00Z'),
    lastLoginAt: ts('2026-11-01T08:00:00Z'),
  },
  {
    uid: 'u2',
    email: 'alice@example.com',
    displayName: 'Alice',
    photoURL: 'https://example.com/a.png',
    role: 'admin',
    disabled: false,
    providers: ['github.com', 'password'],
    createdAt: ts('2026-02-01T00:00:00Z'),
    lastLoginAt: null,
  },
  {
    uid: 'u3',
    email: 'bob@example.com',
    displayName: 'Bob',
    photoURL: null,
    role: 'user',
    disabled: false,
    providers: ['password'],
    createdAt: ts('2026-03-01T00:00:00Z'),
    lastLoginAt: ts('2026-10-01T00:00:00Z'),
  },
  {
    uid: 'u4',
    email: 'carol@example.com',
    displayName: null,
    photoURL: null,
    role: 'user',
    disabled: true,
    providers: ['google.com'],
    createdAt: null,
    lastLoginAt: null,
  },
];

function emitUsers(list: UserProfile[] = USERS) {
  mocks.subscribeAllUsers.mockImplementation((onData: (u: UserProfile[]) => void) => {
    onData(list);
    return mocks.unsubscribe;
  });
}

function row(uid: string) {
  return screen.getByTestId(`user-row-${uid}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'me' }, profile: USERS[0], isAdmin: true });
  mocks.setUserRole.mockResolvedValue(undefined);
  mocks.setUserDisabled.mockResolvedValue(undefined);
  emitUsers();
});

describe('AdminUsersPage', () => {
  it('渲染列表與統計', () => {
    render(<AdminUsersPage />);
    expect(screen.getByTestId('stat-total')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-admins')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-disabled')).toHaveTextContent('1');

    expect(screen.getAllByRole('row')).toHaveLength(5); // 表頭 + 4
    expect(within(row('u2')).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(row('u2')).getByText('GitHub')).toBeInTheDocument();
    expect(within(row('u2')).getByText('Email/密碼')).toBeInTheDocument();
    expect(within(row('u4')).getByText('已停用')).toBeInTheDocument();
    // 最後登入為 null 顯示「—」
    expect(within(row('u2')).getAllByText('—').length).toBeGreaterThan(0);
    expect(
      // zh-TW 格式含窄空格（U+2009），Testing Library 只正規化畫面文字，預期值要同樣正規化
      within(row('u3')).getByText(new Date('2026-10-01T00:00:00Z').toLocaleString('zh-TW').replace(/\s+/g, ' ')),
    ).toBeInTheDocument();
  });

  it('顯示載入中（尚未回撥）', () => {
    mocks.subscribeAllUsers.mockImplementation(() => mocks.unsubscribe);
    render(<AdminUsersPage />);
    expect(screen.getByText('載入中…')).toBeInTheDocument();
  });

  it('空列表狀態', () => {
    emitUsers([]);
    render(<AdminUsersPage />);
    expect(screen.getByText('目前還沒有任何使用者')).toBeInTheDocument();
  });

  it('搜尋 email / displayName 不分大小寫', async () => {
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const search = screen.getByLabelText('搜尋');

    await user.type(search, 'ALICE');
    expect(screen.getByTestId('user-row-u2')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'CAROL@');
    expect(screen.getByTestId('user-row-u4')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u2')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nobody');
    expect(screen.getByText('沒有符合條件的使用者')).toBeInTheDocument();
  });

  it('篩選 admin / user / 已停用', async () => {
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const filter = screen.getByLabelText('篩選');

    await user.selectOptions(filter, 'admin');
    expect(screen.queryByTestId('user-row-me')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u2')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument();

    await user.selectOptions(filter, 'user');
    expect(screen.queryByTestId('user-row-u3')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u4')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-me')).not.toBeInTheDocument();

    await user.selectOptions(filter, 'disabled');
    expect(screen.queryByTestId('user-row-u4')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument();
  });

  it('自己那列操作 disabled 並標「（你）」', () => {
    render(<AdminUsersPage />);
    const mine = row('me');
    expect(within(mine).getByText('（你）')).toBeInTheDocument();
    const select = within(mine).getByRole('combobox');
    const btn = within(mine).getByRole('button', { name: '停用' });
    expect(select).toBeDisabled();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', '不能修改自己的角色或狀態');
    // 別人那列可操作
    expect(within(row('u3')).getByRole('combobox')).toBeEnabled();
  });

  it('降級 admin 先 confirm，確認後呼叫 setUserRole', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u2')).getByRole('combobox'), 'user');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserRole).toHaveBeenCalledWith('u2', 'user');
  });

  it('降級 admin 取消 confirm 則不呼叫', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u2')).getByRole('combobox'), 'user');
    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });

  it('升級為 admin 不需要 confirm', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u3')).getByRole('combobox'), 'admin');
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.setUserRole).toHaveBeenCalledWith('u3', 'admin');
  });

  it('停用先 confirm 後呼叫 setUserDisabled(true)；啟用直接呼叫', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminUsersPage />);
    await user.click(within(row('u3')).getByRole('button', { name: '停用' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserDisabled).toHaveBeenCalledWith('u3', true);

    await user.click(within(row('u4')).getByRole('button', { name: '啟用' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserDisabled).toHaveBeenCalledWith('u4', false);
  });

  it('操作進行中該列按鈕 disabled，完成後恢復', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolve!: () => void;
    mocks.setUserDisabled.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(<AdminUsersPage />);
    await user.click(within(row('u3')).getByRole('button', { name: '停用' }));
    expect(within(row('u3')).getByRole('button', { name: '停用' })).toBeDisabled();
    expect(within(row('u3')).getByRole('combobox')).toBeDisabled();
    expect(within(row('u2')).getByRole('button', { name: '停用' })).toBeEnabled();
    resolve();
    await waitFor(() => expect(within(row('u3')).getByRole('button', { name: '停用' })).toBeEnabled());
  });

  it('操作失敗顯示 .alert-error', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.setUserDisabled.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    render(<AdminUsersPage />);
    await user.click(within(row('u3')).getByRole('button', { name: '停用' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('alert-error');
    expect(alert).toHaveTextContent('操作失敗：沒有權限');
  });

  it('訂閱錯誤 permission-denied 顯示「沒有權限讀取使用者列表」', () => {
    mocks.subscribeAllUsers.mockImplementation((_onData: unknown, onError?: (e: Error) => void) => {
      onError?.(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
      return mocks.unsubscribe;
    });
    render(<AdminUsersPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('alert-error');
    expect(alert).toHaveTextContent('沒有權限讀取使用者列表');
  });

  it('unmount 時退訂', () => {
    const { unmount } = render(<AdminUsersPage />);
    expect(mocks.subscribeAllUsers).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
