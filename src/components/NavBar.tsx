import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Clapperboard, History, LogOut, Plane, Sofa, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import BrandMark from './BrandMark';
import StyleToggle from './StyleToggle';
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

/** 圖示 + 文字；手機寬度只留圖示，文字改為視覺隱藏（無障礙名稱仍在）。 */
function NavItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      {icon}
      <span className="nav-label">{label}</span>
    </>
  );
}

export default function NavBar() {
  const { user, profile, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  // profile 存在時以 Firestore 為準（使用者可能刻意清空頭像），否則退回 Auth 資料
  const name = (profile ? profile.displayName : user?.displayName) || user?.email || '使用者';
  const photoURL = profile ? profile.photoURL : (user?.photoURL ?? null);
  const iconSize = 18;

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
          <BrandMark size={30} />
          <span className="navbar-wordmark">Claude Flow</span>
        </Link>
        <nav className="navbar-right" aria-label="主導覽">
          {/* 風格開關不受登入狀態影響，載入中也可以切換 */}
          <StyleToggle />
          {loading ? null : user ? (
            <>
              <div className="navbar-links">
                {/* 室內設計、旅遊規劃、台股分析是獨立頁面，用一般連結整頁切換，不走 React Router */}
                <a href="/interior/" className="nav-link">
                  <NavItem icon={<Sofa size={iconSize} aria-hidden="true" />} label="室內設計" />
                </a>
                <a href="/travel/" className="nav-link">
                  <NavItem icon={<Plane size={iconSize} aria-hidden="true" />} label="旅遊規劃" />
                </a>
                <a href="/stock/" className="nav-link">
                  <NavItem icon={<TrendingUp size={iconSize} aria-hidden="true" />} label="台股分析" />
                </a>
                <a href="/animate/" className="nav-link">
                  <NavItem icon={<Clapperboard size={iconSize} aria-hidden="true" />} label="動畫製作" />
                </a>
                {isAdmin && (
                  <>
                    <NavLink to="/admin/users" className={navClass}>
                      <NavItem icon={<Users size={iconSize} aria-hidden="true" />} label="使用者管理" />
                    </NavLink>
                    <NavLink to="/admin/logs" className={navClass}>
                      <NavItem icon={<History size={iconSize} aria-hidden="true" />} label="操作日誌" />
                    </NavLink>
                  </>
                )}
              </div>
              <span className="navbar-sep" aria-hidden="true" />
              <NavLink
                to="/profile"
                className={({ isActive }) => (isActive ? 'navbar-user active' : 'navbar-user')}
                aria-label="個人資料"
                title={`個人資料（${name}）`}
              >
                <Avatar name={name} photoURL={photoURL} />
                <span className="navbar-name">{name}</span>
              </NavLink>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="登出"
                title="登出"
              >
                <LogOut size={iconSize} aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">
                登入
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                註冊
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
