// OWNER: Agent E
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { formatTimestamp } from './ProfilePage';
import './profile.css';

export default function HomePage() {
  const { user, profile, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="spinner-page">載入中…</div>;
  }

  if (!user) {
    return (
      <div className="container">
        <div className="card center home-hero">
          <h1>Claude Flow</h1>
          <p className="muted">支援 Google、GitHub 與 Email/密碼登入的帳號系統，可管理個人資料與登入方式。</p>
          <div className="row home-actions">
            <Link to="/login" className="btn btn-primary">
              登入
            </Link>
            <Link to="/register" className="btn">
              註冊
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const name = profile?.displayName ?? user.displayName ?? user.email ?? '使用者';

  return (
    <div className="container stack">
      <div className="card stack">
        <h1>歡迎，{name}</h1>
        <div className="row">
          <span className={isAdmin ? 'badge badge-admin' : 'badge'}>{isAdmin ? '管理員' : '一般使用者'}</span>
          <span className="muted">最後登入：{formatTimestamp(profile?.lastLoginAt ?? null)}</span>
        </div>
        <div className="row">
          <Link to="/profile" className="btn">
            個人資料
          </Link>
        </div>
      </div>
      {isAdmin && (
        <Link to="/admin/users" className="card home-link-card">
          <h2>使用者管理</h2>
          <p className="muted">檢視所有使用者、調整角色與停用帳號 →</p>
        </Link>
      )}
    </div>
  );
}
