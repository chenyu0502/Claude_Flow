// OWNER: Agent F
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { setUserDisabled, setUserRole, subscribeAllUsers } from '../../services/users';
import { PROVIDER_LABELS, type Role, type UserProfile } from '../../types/user';
import './admin.css';

type UserFilter = 'all' | 'admin' | 'user' | 'disabled';

const FILTER_OPTIONS: { value: UserFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'admin', label: '管理员' },
  { value: 'user', label: '普通用户' },
  { value: 'disabled', label: '已停用' },
];

const SELF_HINT = '不能修改自己的角色或状态';

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function describeLoadError(err: unknown): string {
  const code = errorCode(err);
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return '没有权限读取用户列表';
  if (code === 'unavailable') return '无法连接服务器，请检查网络后重试';
  return `读取用户列表失败：${err instanceof Error ? err.message : String(err)}`;
}

function describeActionError(err: unknown): string {
  const code = errorCode(err);
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return '操作失败：没有权限';
  return `操作失败：${err instanceof Error ? err.message : String(err)}`;
}

function formatTime(ts: UserProfile['createdAt']): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleString('zh-CN');
  } catch {
    return '—';
  }
}

function matchesFilter(u: UserProfile, filter: UserFilter, query: string): boolean {
  if (filter === 'admin' && u.role !== 'admin') return false;
  if (filter === 'user' && u.role !== 'user') return false;
  if (filter === 'disabled' && !u.disabled) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (u.email ?? '').toLowerCase().includes(q) ||
    (u.displayName ?? '').toLowerCase().includes(q)
  );
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const selfUid = user?.uid ?? null;

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeAllUsers(
      (list) => {
        if (!active) return;
        setUsers(list);
        setLoadError(null);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setLoadError(describeLoadError(err));
        setLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: users.length,
      admins: users.filter((u) => u.role === 'admin').length,
      disabled: users.filter((u) => u.disabled).length,
    }),
    [users],
  );

  const visible = useMemo(() => users.filter((u) => matchesFilter(u, filter, query)), [users, filter, query]);

  async function runAction(uid: string, action: () => Promise<void>) {
    setBusy((prev) => new Set(prev).add(uid));
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(describeActionError(err));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  }

  function handleRoleChange(u: UserProfile, role: Role) {
    if (u.uid === selfUid || role === u.role) return;
    const name = u.displayName || u.email || u.uid;
    if (u.role === 'admin' && role === 'user' && !window.confirm(`确定要将「${name}」降级为普通用户吗？`)) return;
    void runAction(u.uid, () => setUserRole(u.uid, role));
  }

  function handleToggleDisabled(u: UserProfile) {
    if (u.uid === selfUid) return;
    const name = u.displayName || u.email || u.uid;
    const next = !u.disabled;
    if (next && !window.confirm(`确定要停用「${name}」吗？停用后该用户将无法使用需登录的页面。`)) return;
    void runAction(u.uid, () => setUserDisabled(u.uid, next));
  }

  return (
    <div className="container admin-users">
      <h1>用户管理</h1>

      <div className="admin-stats">
        <div className="card admin-stat">
          <div className="admin-stat-label muted">总人数</div>
          <div className="admin-stat-value" data-testid="stat-total">{stats.total}</div>
        </div>
        <div className="card admin-stat">
          <div className="admin-stat-label muted">管理员</div>
          <div className="admin-stat-value" data-testid="stat-admins">{stats.admins}</div>
        </div>
        <div className="card admin-stat">
          <div className="admin-stat-label muted">已停用</div>
          <div className="admin-stat-value" data-testid="stat-disabled">{stats.disabled}</div>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="field admin-search">
          <label htmlFor="admin-user-search">搜索</label>
          <input
            id="admin-user-search"
            type="search"
            placeholder="按邮箱或名称搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="admin-user-filter">筛选</label>
          <select id="admin-user-filter" value={filter} onChange={(e) => setFilter(e.target.value as UserFilter)}>
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error admin-alert" role="alert">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="spinner-page">载入中…</div>
      ) : loadError ? (
        <div className="alert alert-error" role="alert">{loadError}</div>
      ) : users.length === 0 ? (
        <div className="card center muted">目前还没有任何用户</div>
      ) : visible.length === 0 ? (
        <div className="card center muted">没有符合条件的用户</div>
      ) : (
        <div className="card admin-table-card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>邮箱</th>
                  <th>登录方式</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>建立时间</th>
                  <th>最后登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const isSelf = u.uid === selfUid;
                  const isBusy = busy.has(u.uid);
                  const locked = isSelf || isBusy;
                  const name = u.displayName || '（未命名）';
                  return (
                    <tr key={u.uid} data-testid={`user-row-${u.uid}`} className={u.disabled ? 'admin-row-disabled' : undefined}>
                      <td>
                        <div className="admin-user-cell">
                          {u.photoURL ? (
                            <img className="avatar" src={u.photoURL} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="avatar admin-avatar-fallback" aria-hidden="true">
                              {(u.displayName || u.email || '?').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span>
                            {name}
                            {isSelf && <span className="muted">（你）</span>}
                          </span>
                        </div>
                      </td>
                      <td>{u.email ?? '—'}</td>
                      <td>
                        <div className="admin-badges">
                          {u.providers.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            u.providers.map((p) => (
                              <span key={p} className="badge">{PROVIDER_LABELS[p] ?? p}</span>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        {u.role === 'admin' ? (
                          <span className="badge badge-admin">管理员</span>
                        ) : (
                          <span className="badge">普通用户</span>
                        )}
                      </td>
                      <td>
                        {u.disabled ? (
                          <span className="badge badge-danger">已停用</span>
                        ) : (
                          <span className="badge admin-badge-active">正常</span>
                        )}
                      </td>
                      <td>{formatTime(u.createdAt)}</td>
                      <td>{formatTime(u.lastLoginAt)}</td>
                      <td>
                        <div className="admin-actions" title={isSelf ? SELF_HINT : undefined}>
                          <select
                            className="admin-role-select"
                            aria-label={`修改 ${u.email ?? u.uid} 的角色`}
                            value={u.role}
                            disabled={locked}
                            title={isSelf ? SELF_HINT : undefined}
                            onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                          >
                            <option value="admin">管理员</option>
                            <option value="user">普通用户</option>
                          </select>
                          <button
                            type="button"
                            className={`btn btn-sm ${u.disabled ? '' : 'btn-danger'}`}
                            disabled={locked}
                            title={isSelf ? SELF_HINT : undefined}
                            onClick={() => handleToggleDisabled(u)}
                          >
                            {u.disabled ? '启用' : '停用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length !== users.length && (
            <div className="muted admin-count">显示 {visible.length} / {users.length} 位用户</div>
          )}
        </div>
      )}
    </div>
  );
}
