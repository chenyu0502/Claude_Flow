// OWNER: Agent D
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage } from '../services/auth';
import AuthShell from '../components/AuthShell';
import './auth.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RESET_SENT_MESSAGE = '若此 email 已註冊，重設密碼郵件已寄出';

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('請輸入 email');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setError('email 格式不正確');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(trimmed);
      setSent(true);
    } catch (err) {
      // 不透露帳號是否存在：user-not-found 也視為成功
      if (errorCode(err) === 'auth/user-not-found') setSent(true);
      else setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="card auth-card">
        <h1>重設密碼</h1>
        <p className="auth-subtitle">輸入註冊時使用的 email，我們會寄送重設密碼連結</p>

        <div className="auth-alerts">
          {sent && (
            <div className="alert alert-success" role="status">
              {RESET_SENT_MESSAGE}
            </div>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <form className="stack" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="reset-email">Email</label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSent(false);
              }}
              disabled={submitting}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '寄送中…' : '寄送重設郵件'}
          </button>
        </form>

        <p className="auth-footer">
          <Link to="/login">返回登入</Link>
        </p>
      </div>
    </AuthShell>
  );
}
