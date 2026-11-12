// OWNER: Agent D
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage } from '../services/auth';
import OAuthButtons from '../components/OAuthButtons';
import './auth.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DISPLAY_NAME_MAX = 50;
export const PASSWORD_MIN = 6;

interface FormValues {
  displayName: string;
  email: string;
  password: string;
  confirm: string;
}
type FieldErrors = Partial<Record<keyof FormValues, string>>;

export function validateRegister(v: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  const name = v.displayName.trim();
  const email = v.email.trim();
  if (!name) errors.displayName = '请输入显示名称';
  else if ([...name].length > DISPLAY_NAME_MAX) errors.displayName = `显示名称不能超过 ${DISPLAY_NAME_MAX} 个字`;
  if (!email) errors.email = '请输入 email';
  else if (!EMAIL_RE.test(email)) errors.email = 'email 格式不正确';
  if (!v.password) errors.password = '请输入密码';
  else if (v.password.length < PASSWORD_MIN) errors.password = `密码至少需要 ${PASSWORD_MIN} 个字符`;
  if (!v.confirm) errors.confirm = '请再次输入密码';
  else if (v.confirm !== v.password) errors.confirm = '两次输入的密码不一致';
  return errors;
}

export default function RegisterPage() {
  const { user, loading, signUpWithEmail } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState<FormValues>({ displayName: '', email: '', password: '', confirm: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  // 已登录直接回首页（提交成功时 handleSubmit 也会 navigate）
  if (user && !loading && !submitting) {
    return <Navigate to="/" replace />;
  }

  function update(key: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const errs = validateRegister(values);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    try {
      await signUpWithEmail(values.email.trim(), values.password, values.displayName.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
    }
  }

  const busy = submitting || oauthBusy;

  function fieldProps(key: keyof FormValues) {
    const id = `register-${key}`;
    return {
      id,
      value: values[key],
      onChange: (e: ChangeEvent<HTMLInputElement>) => update(key, e.target.value),
      disabled: busy,
      'aria-invalid': fieldErrors[key] ? true : undefined,
      'aria-describedby': fieldErrors[key] ? `${id}-error` : undefined,
    };
  }

  function fieldError(key: keyof FormValues) {
    return fieldErrors[key] ? (
      <span id={`register-${key}-error`} className="field-error">
        {fieldErrors[key]}
      </span>
    ) : null;
  }

  return (
    <div className="container narrow auth-page">
      <div className="card auth-card">
        <h1>注册</h1>
        <p className="auth-subtitle">建立新账号</p>

        <div className="auth-alerts">
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
            navigate('/', { replace: true });
          }}
          onError={(msg) => {
            setOauthBusy(false);
            setError(msg);
          }}
        />

        <div className="divider">或</div>

        <form className="stack" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="register-displayName">显示名称</label>
            <input type="text" autoComplete="name" maxLength={100} {...fieldProps('displayName')} />
            {fieldError('displayName')}
          </div>
          <div className="field">
            <label htmlFor="register-email">Email</label>
            <input type="email" autoComplete="email" {...fieldProps('email')} />
            {fieldError('email')}
          </div>
          <div className="field">
            <label htmlFor="register-password">密码</label>
            <input type="password" autoComplete="new-password" {...fieldProps('password')} />
            {fieldError('password')}
          </div>
          <div className="field">
            <label htmlFor="register-confirm">确认密码</label>
            <input type="password" autoComplete="new-password" {...fieldProps('confirm')} />
            {fieldError('confirm')}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {submitting ? '注册中…' : '注册'}
          </button>
        </form>

        <p className="auth-footer">
          已有账号？<Link to="/login">登录</Link>
        </p>
      </div>
    </div>
  );
}
