// 管理員後台：登入紀錄與操作日誌
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentSnapshot } from 'firebase/firestore';
import { subscribeAllUsers } from '../../services/users';
import {
  AUDIT_TYPE_LABELS,
  describeDetail,
  fetchAuditLogPage,
  type AuditLog,
  type AuditType,
} from '../../services/auditLog';
import type { UserProfile } from '../../types/user';
import './admin.css';

/** 每次讀取的筆數 */
export const PAGE_SIZE = 50;

type TypeFilter = 'all' | 'auth' | 'account' | 'admin';

const TYPE_GROUPS: Record<Exclude<TypeFilter, 'all'>, AuditType[]> = {
  auth: ['login', 'logout', 'register'],
  account: ['password_change', 'email_verified', 'provider_link', 'provider_unlink', 'profile_update'],
  admin: ['role_change', 'disabled_change'],
};

const FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部事件' },
  { value: 'auth', label: '登入／登出／註冊' },
  { value: 'account', label: '帳號設定' },
  { value: 'admin', label: '管理員操作' },
];

function formatTime(ts: AuditLog['createdAt']): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleString('zh-TW');
  } catch {
    return '—';
  }
}

/** uid → 顯示用名稱；找不到使用者資料時退回日誌裡的 email，再不然顯示 uid */
function nameOf(uid: string | null, users: Map<string, UserProfile>, fallbackEmail?: string | null): string {
  if (!uid) return '—';
  const u = users.get(uid);
  return u?.displayName || u?.email || fallbackEmail || uid;
}

export function matchesLog(
  log: AuditLog,
  filter: TypeFilter,
  q: string,
  users: Map<string, UserProfile>,
): boolean {
  if (filter !== 'all' && !TYPE_GROUPS[filter].includes(log.type)) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    log.actorEmail,
    nameOf(log.actorUid, users),
    log.targetUid ? nameOf(log.targetUid, users) : '',
    log.targetUid ? users.get(log.targetUid)?.email : '',
  ];
  return haystack.some((s) => (s ?? '').toLowerCase().includes(needle));
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Map<string, UserProfile>>(new Map());
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');

  // 使用者清單只用來把 uid 換成名稱；讀不到不影響日誌本身。
  useEffect(
    () =>
      subscribeAllUsers(
        (list) => setUsers(new Map(list.map((u) => [u.uid, u]))),
        (err) => console.error('[AdminLogsPage] 讀取使用者列表失敗', err),
      ),
    [],
  );

  const load = useCallback(async (after: DocumentSnapshot | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchAuditLogPage(PAGE_SIZE, after);
      setLogs((prev) => (after ? [...prev, ...page.logs] : page.logs));
      setCursor(page.cursor);
    } catch (err) {
      console.error('[AdminLogsPage] 讀取日誌失敗', err);
      setError('讀取日誌失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const visible = useMemo(() => logs.filter((l) => matchesLog(l, filter, query, users)), [logs, filter, query, users]);

  return (
    <div className="container admin-users">
      <header className="page-head">
        <span className="eyebrow">管理員</span>
        <h1>登入紀錄與操作日誌</h1>
        <p>所有帳號的登入、帳號設定變更，以及管理員的操作。紀錄寫入後無法修改或刪除。</p>
      </header>

      <div className="admin-toolbar">
        <div className="field admin-search">
          <label htmlFor="admin-log-search">搜尋</label>
          <input
            id="admin-log-search"
            type="search"
            placeholder="以電子郵件或名稱搜尋（已載入的紀錄）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="admin-log-filter">事件</label>
          <select id="admin-log-filter" value={filter} onChange={(e) => setFilter(e.target.value as TypeFilter)}>
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn" onClick={() => void load(null)} disabled={loading}>
          重新整理
        </button>
      </div>

      {error && (
        <div className="alert alert-error admin-alert" role="alert">
          {error}
        </div>
      )}

      <div className="card admin-table-card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>時間</th>
                <th>事件</th>
                <th>操作者</th>
                <th>對象／內容</th>
                <th>裝置</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((log) => {
                const detail = describeDetail(log);
                const target = log.targetUid ? nameOf(log.targetUid, users) : null;
                return (
                  <tr key={log.id} data-testid={`log-${log.id}`}>
                    <td className="admin-time">{formatTime(log.createdAt)}</td>
                    <td>
                      <span className={log.targetUid ? 'badge badge-admin' : 'badge'}>{AUDIT_TYPE_LABELS[log.type]}</span>
                    </td>
                    <td>
                      <div className="admin-user-text">
                        <span className="admin-user-name">{nameOf(log.actorUid, users, log.actorEmail)}</span>
                        {log.actorEmail && <span className="admin-user-email muted">{log.actorEmail}</span>}
                      </div>
                    </td>
                    <td>{[target, detail].filter(Boolean).join('：') || '—'}</td>
                    <td className="admin-time">{log.device ?? '—'}</td>
                  </tr>
                );
              })}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                    {logs.length === 0 ? '還沒有紀錄' : '沒有符合條件的紀錄'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-count muted row" style={{ justifyContent: 'space-between' }}>
          <span>
            已載入 {logs.length} 筆{visible.length !== logs.length && `，符合條件 ${visible.length} 筆`}
          </span>
          {loading ? (
            <span>載入中…</span>
          ) : (
            cursor && (
              <button type="button" className="btn btn-sm" onClick={() => void load(cursor)}>
                載入更多
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
