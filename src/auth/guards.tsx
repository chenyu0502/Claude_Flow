// OWNER: Agent C
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { authErrorMessage } from '../services/auth';

function LoadingPage() {
  return <div className="spinner-page">載入中…</div>;
}

function DisabledNotice() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } catch (err) {
      console.error('[guards] 登出失敗', err);
      setBusy(false);
    }
  };
  return (
    <div className="container narrow">
      <div className="card center stack" role="alert">
        <h2>帳號已停用</h2>
        <p className="muted">帳號已停用，請聯絡管理員</p>
        <button type="button" className="btn btn-primary" onClick={handleSignOut} disabled={busy}>
          登出
        </button>
      </div>
    </div>
  );
}

type Msg = { kind: 'success' | 'error'; text: string } | null;

/** 只用 Email/密碼註冊、還沒點驗證信連結的帳號：提示去收信，可重寄、可重新檢查 */
export function VerifyEmailNotice() {
  const { user, signOut, resendVerificationEmail, refreshEmailVerification } = useAuth();
  const [busy, setBusy] = useState<'resend' | 'check' | 'signout' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  // 使用者通常是切到信箱分頁點連結再切回來：回到這個分頁時自動檢查一次，不必再按按鈕。
  useEffect(() => {
    const onFocus = () => {
      refreshEmailVerification().catch((err) => console.error('[guards] 檢查驗證狀態失敗', err));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshEmailVerification]);

  const run = async (kind: 'resend' | 'check' | 'signout', action: () => Promise<void>) => {
    setBusy(kind);
    setMsg(null);
    try {
      await action();
    } catch (err) {
      setMsg({ kind: 'error', text: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleResend = () =>
    run('resend', async () => {
      await resendVerificationEmail();
      setMsg({ kind: 'success', text: '驗證信已寄出，請到信箱收信（也看一下垃圾郵件匣）' });
    });
  const handleCheck = () =>
    run('check', async () => {
      const verified = await refreshEmailVerification();
      if (!verified) setMsg({ kind: 'error', text: '還沒有完成驗證，請先點驗證信裡的連結' });
    });
  const handleSignOut = () => run('signout', signOut);

  return (
    <div className="container narrow">
      <div className="card center stack" role="alert">
        <h2>請驗證你的 Email</h2>
        <p className="muted">
          驗證信已寄到 <strong>{user?.email ?? '你的信箱'}</strong>，點信中的連結完成驗證後就能開始使用。
        </p>
        {msg && (
          <div className={`alert alert-${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>
            {msg.text}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={handleCheck} disabled={busy !== null}>
            {busy === 'check' ? '檢查中…' : '我已完成驗證'}
          </button>
          <button type="button" className="btn" onClick={handleResend} disabled={busy !== null}>
            {busy === 'resend' ? '寄送中…' : '重新寄送驗證信'}
          </button>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-sm" onClick={handleSignOut} disabled={busy !== null}>
            登出
          </button>
        </div>
      </div>
    </div>
  );
}

function ForbiddenNotice() {
  return (
    <div className="container narrow">
      <div className="card center stack" role="alert">
        <h2>403</h2>
        <p className="muted">沒有權限存取此頁面</p>
        <Link to="/" className="btn">
          回首頁
        </Link>
      </div>
    </div>
  );
}

/** 共用檢查：載入中 / 未登入 / 已停用 / Email 未驗證。返回 null 表示透過 */
function useAuthGate(): ReactNode | null {
  const { user, loading, isDisabled, needsEmailVerification } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingPage />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (isDisabled) return <DisabledNotice />;
  if (needsEmailVerification) return <VerifyEmailNotice />;
  return null;
}

/**
 * 未登入 → <Navigate to="/login" state={{ from: location }} replace />；已停用 → 停用提示；
 * Email 未驗證 → 驗證提示；載入中 → 載入畫面
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const blocked = useAuthGate();
  return <>{blocked ?? children}</>;
}

/** 在 RequireAuth 的基礎上，非 admin → 403 提示 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const blocked = useAuthGate();
  if (blocked) return <>{blocked}</>;
  if (!isAdmin) return <ForbiddenNotice />;
  return <>{children}</>;
}
