// OWNER: Agent E
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './navbar.css';

interface AvatarProps {
  name: string | null | undefined;
  photoURL: string | null | undefined;
  large?: boolean;
}

/** 頭像：有 photoURL 顯示圖片（載入失敗退回首字母），否則顯示首字母圓形 */
export function Avatar({ name, photoURL, large }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const cls = large ? 'avatar avatar-lg' : 'avatar';
  if (photoURL && !broken) {
    return <img className={cls} src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  return (
    <span className={`${cls} avatar-initial`} aria-hidden="true">
      {initial}
    </span>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link');

export default function NavBar() {
  const { user, profile, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  // profile 存在時以 Firestore 為準（使用者可能刻意清空頭像），否則退回 Auth 資料
  const name = (profile ? profile.displayName : user?.displayName) || user?.email || '使用者';
  const photoURL = profile ? profile.photoURL : (user?.photoURL ?? null);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand">
          Claude Flow
        </Link>
        <nav className="navbar-right" aria-label="主導覽">
          {loading ? null : user ? (
            <>
              <span className="navbar-user" title={name}>
                <Avatar name={name} photoURL={photoURL} />
                <span className="navbar-name">{name}</span>
              </span>
              <NavLink to="/profile" className={navClass}>
                個人資料
              </NavLink>
              {isAdmin && (
                <>
                  {/* 台股分析是獨立頁面（/stock/），用一般連結整頁切換，不走 React Router */}
                  <a href="/stock/" className="nav-link">
                    台股分析
                  </a>
                  <NavLink to="/admin/users" className={navClass}>
                    使用者管理
                  </NavLink>
                </>
              )}
              <button type="button" className="btn btn-sm" onClick={handleSignOut} disabled={signingOut}>
                登出
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-sm">
                登入
              </Link>
              <Link to="/register" className="btn btn-sm btn-primary">
                註冊
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
