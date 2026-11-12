// OWNER: Agent D
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage } from '../services/auth';
import OAuthButtons from '../components/OAuthButtons';
import './auth.css';

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { user, loading, pendingLinkEmail, signInWithEmail } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as LocationState | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  if (user && !loading) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('请输入 email 和密码');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmail(trimmed, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
    }
  }

  const busy = submitting || oauthBusy;

  return (
    <div className="container narrow auth-page">
      <div className="card auth-card">
        <h1>登录</h1>
        <p className="auth-subtitle">欢迎回来，请选择登录方式</p>

        <div className="auth-alerts">
          {pendingLinkEmail && (
            <div className="alert alert-info" role="alert">
              {pendingLinkEmail} 已用其他方式注册，请先用原本的方式登录，完成后会自动绑定新的登录方式
            </div>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <OAuthButtons
          disabled={submitting}
          onStart={() => {
            setError(null);
            setOauthBusy(true);
          }}
          onSuccess={() => {
            setOauthBusy(false);
            navigate(from, { replace: true });
          }}
          onError={(msg) => {
            setOauthBusy(false);
            setError(msg);
          }}
        />

        <div className="divider">或</div>

        <form className="stack" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <Link to="/reset-password" className="auth-forgot">
            忘记密码？
          </Link>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="auth-footer">
          还没有账号？<Link to="/register">注册</Link>
        </p>
      </div>
    </div>
  );
}
