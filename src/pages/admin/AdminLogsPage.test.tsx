import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminLogsPage, { PAGE_SIZE } from './AdminLogsPage';

const svc = vi.hoisted(() => ({ fetchAuditLogPage: vi.fn() }));
vi.mock('../../services/auditLog', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../services/auditLog')>();
  return { ...orig, fetchAuditLogPage: svc.fetchAuditLogPage };
});
const users = vi.hoisted(() => ({ subscribeAllUsers: vi.fn() }));
vi.mock('../../services/users', () => users);
vi.mock('../../lib/firebase', () => ({ auth: {}, db: {} }));

const at = (h: number) => ({ toDate: () => new Date(2026, 10, 18, h, 0) });
const log = (id: string, extra: object = {}) => ({
  id,
  type: 'login',
  actorUid: 'alice',
  actorEmail: 'alice@x.tw',
  targetUid: null,
  detail: { method: 'google.com' },
  device: 'Chrome · Windows',
  createdAt: at(9),
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  users.subscribeAllUsers.mockImplementation((onData: (u: unknown[]) => void) => {
    onData([
      { uid: 'alice', email: 'alice@x.tw', displayName: 'Alice' },
      { uid: 'bob', email: 'bob@x.tw', displayName: 'Bob' },
    ]);
    return () => {};
  });
});

describe('AdminLogsPage', () => {
  it('列出日誌，uid 換成名稱，管理員操作顯示對象與內容', async () => {
    svc.fetchAuditLogPage.mockResolvedValue({
      logs: [
        log('a'),
        log('b', { type: 'role_change', actorUid: 'alice', targetUid: 'bob', detail: { role: 'admin' } }),
      ],
      cursor: null,
    });
    render(<AdminLogsPage />);
    expect(await screen.findByTestId('log-a')).toHaveTextContent('登入');
    expect(screen.getByTestId('log-a')).toHaveTextContent('Google');
    expect(screen.getByTestId('log-b')).toHaveTextContent('Bob：改為管理員');
    expect(screen.getByTestId('log-b')).toHaveTextContent('Alice');
    expect(svc.fetchAuditLogPage).toHaveBeenCalledWith(PAGE_SIZE, null);
  });

  it('依事件類別與搜尋篩選', async () => {
    svc.fetchAuditLogPage.mockResolvedValue({
      logs: [
        log('a'),
        log('b', { type: 'disabled_change', targetUid: 'bob', detail: { disabled: true } }),
        log('c', { actorUid: 'bob', actorEmail: 'bob@x.tw' }),
      ],
      cursor: null,
    });
    render(<AdminLogsPage />);
    await screen.findByTestId('log-a');

    await userEvent.selectOptions(screen.getByLabelText('事件'), 'admin');
    expect(screen.queryByTestId('log-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('log-b')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('事件'), 'all');
    await userEvent.type(screen.getByLabelText('搜尋'), 'bob@');
    // b 的對象是 bob、c 的操作者是 bob
    expect(screen.queryByTestId('log-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('log-b')).toBeInTheDocument();
    expect(screen.getByTestId('log-c')).toBeInTheDocument();
    expect(screen.getByText(/符合條件 2 筆/)).toBeInTheDocument();
  });

  it('有下一頁時可載入更多，接在後面', async () => {
    const cursor = { id: 'cursor' };
    svc.fetchAuditLogPage
      .mockResolvedValueOnce({ logs: [log('a')], cursor })
      .mockResolvedValueOnce({ logs: [log('b')], cursor: null });
    render(<AdminLogsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '載入更多' }));
    expect(await screen.findByTestId('log-b')).toBeInTheDocument();
    expect(screen.getByTestId('log-a')).toBeInTheDocument();
    expect(svc.fetchAuditLogPage).toHaveBeenLastCalledWith(PAGE_SIZE, cursor);
    expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument();
  });

  it('讀取失敗顯示錯誤', async () => {
    svc.fetchAuditLogPage.mockRejectedValue(new Error('permission-denied'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AdminLogsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('讀取日誌失敗');
    spy.mockRestore();
  });

  it('沒有紀錄時顯示提示', async () => {
    svc.fetchAuditLogPage.mockResolvedValue({ logs: [], cursor: null });
    render(<AdminLogsPage />);
    expect(await screen.findByText('還沒有紀錄')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('載入中…')).not.toBeInTheDocument());
  });
});
