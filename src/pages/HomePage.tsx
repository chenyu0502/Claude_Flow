// OWNER: Agent E
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { formatTimestamp } from './ProfilePage';
import './profile.css';

export default function HomePage() {
  const { user, profile, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="spinner-page">载入中…</div>;
  }

  if (!user) {
    return (
      <div className="container">
        <div className="card center home-hero">
          <h1>Claude Flow</h1>
          <p className="muted">支持 Google、GitHub 与 Email/密码登录的账号系统，可管理个人资料与登录方式。</p>
          <div className="row home-actions">
            <Link to="/login" className="btn btn-primary">
              登录
            </Link>
            <Link to="/register" className="btn">
              注册
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const name = profile?.displayName ?? user.displayName ?? user.email ?? '用户';

  return (
    <div className="container stack">
      <div className="card stack">
        <h1>欢迎，{name}</h1>
        <div className="row">
          <span className={isAdmin ? 'badge badge-admin' : 'badge'}>{isAdmin ? '管理员' : '一般用户'}</span>
          <span className="muted">最后登录：{formatTimestamp(profile?.lastLoginAt ?? null)}</span>
        </div>
        <div className="row">
          <Link to="/profile" className="btn">
            个人资料
          </Link>
        </div>
      </div>
      {isAdmin && (
        <Link to="/admin/users" className="card home-link-card">
          <h2>用户管理</h2>
          <p className="muted">查看所有用户、调整角色与停用账号 →</p>
        </Link>
      )}
    </div>
  );
}
