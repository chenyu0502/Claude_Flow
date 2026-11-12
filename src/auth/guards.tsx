// OWNER: Agent C
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

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

/** 共用檢查：載入中 / 未登入 / 已停用。返回 null 表示透過 */
function useAuthGate(): ReactNode | null {
  const { user, loading, isDisabled } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingPage />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (isDisabled) return <DisabledNotice />;
  return null;
}

/** 未登入 → <Navigate to="/login" state={{ from: location }} replace />；已停用 → 停用提示；載入中 → 載入畫面 */
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
