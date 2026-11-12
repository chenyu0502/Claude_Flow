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
  it('渲染列表与统计', () => {
    render(<AdminUsersPage />);
    expect(screen.getByTestId('stat-total')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-admins')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-disabled')).toHaveTextContent('1');

    expect(screen.getAllByRole('row')).toHaveLength(5); // 表头 + 4
    expect(within(row('u2')).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(row('u2')).getByText('GitHub')).toBeInTheDocument();
    expect(within(row('u2')).getByText('Email/密码')).toBeInTheDocument();
    expect(within(row('u4')).getByText('已停用')).toBeInTheDocument();
    // 最后登录为 null 显示「—」
    expect(within(row('u2')).getAllByText('—').length).toBeGreaterThan(0);
    expect(
      within(row('u3')).getByText(new Date('2026-10-01T00:00:00Z').toLocaleString('zh-CN')),
    ).toBeInTheDocument();
  });

  it('显示载入中（尚未回调）', () => {
    mocks.subscribeAllUsers.mockImplementation(() => mocks.unsubscribe);
    render(<AdminUsersPage />);
    expect(screen.getByText('载入中…')).toBeInTheDocument();
  });

  it('空列表状态', () => {
    emitUsers([]);
    render(<AdminUsersPage />);
    expect(screen.getByText('目前还没有任何用户')).toBeInTheDocument();
  });

  it('搜索 email / displayName 不分大小写', async () => {
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const search = screen.getByLabelText('搜索');

    await user.type(search, 'ALICE');
    expect(screen.getByTestId('user-row-u2')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'CAROL@');
    expect(screen.getByTestId('user-row-u4')).toBeInTheDocument();
    expect(screen.queryByTestId('user-row-u2')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nobody');
    expect(screen.getByText('没有符合条件的用户')).toBeInTheDocument();
  });

  it('筛选 admin / user / 已停用', async () => {
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const filter = screen.getByLabelText('筛选');

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

  it('自己那列操作 disabled 并标「（你）」', () => {
    render(<AdminUsersPage />);
    const mine = row('me');
    expect(within(mine).getByText('（你）')).toBeInTheDocument();
    const select = within(mine).getByRole('combobox');
    const btn = within(mine).getByRole('button', { name: '停用' });
    expect(select).toBeDisabled();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', '不能修改自己的角色或状态');
    // 别人那列可操作
    expect(within(row('u3')).getByRole('combobox')).toBeEnabled();
  });

  it('降级 admin 先 confirm，确认后调用 setUserRole', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u2')).getByRole('combobox'), 'user');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserRole).toHaveBeenCalledWith('u2', 'user');
  });

  it('降级 admin 取消 confirm 则不调用', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u2')).getByRole('combobox'), 'user');
    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });

  it('升级为 admin 不需要 confirm', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    render(<AdminUsersPage />);
    await user.selectOptions(within(row('u3')).getByRole('combobox'), 'admin');
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.setUserRole).toHaveBeenCalledWith('u3', 'admin');
  });

  it('停用先 confirm 后调用 setUserDisabled(true)；启用直接调用', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminUsersPage />);
    await user.click(within(row('u3')).getByRole('button', { name: '停用' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserDisabled).toHaveBeenCalledWith('u3', true);

    await user.click(within(row('u4')).getByRole('button', { name: '启用' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.setUserDisabled).toHaveBeenCalledWith('u4', false);
  });

  it('操作进行中该列按钮 disabled，完成后恢复', async () => {
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

  it('操作失败显示 .alert-error', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.setUserDisabled.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    render(<AdminUsersPage />);
    await user.click(within(row('u3')).getByRole('button', { name: '停用' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('alert-error');
    expect(alert).toHaveTextContent('操作失败：没有权限');
  });

  it('订阅错误 permission-denied 显示「没有权限读取用户列表」', () => {
    mocks.subscribeAllUsers.mockImplementation((_onData: unknown, onError?: (e: Error) => void) => {
      onError?.(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
      return mocks.unsubscribe;
    });
    render(<AdminUsersPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('alert-error');
    expect(alert).toHaveTextContent('没有权限读取用户列表');
  });

  it('unmount 时退订', () => {
    const { unmount } = render(<AdminUsersPage />);
    expect(mocks.subscribeAllUsers).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
