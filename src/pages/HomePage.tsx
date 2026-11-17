import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Sofa, TrendingUp, UserRound, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { formatTimestamp } from './ProfilePage';
import './profile.css';

/** 依當地時間問候 */
function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚上好';
}

interface AppCardProps {
  href: string;
  /** 獨立頁面（/interior/、/stock/）用一般連結整頁切換；站內頁用 React Router */
  external?: boolean;
  icon: ReactNode;
  tone?: '' | 'sage' | 'gold';
  title: string;
  description: string;
  tag?: string;
}

function AppCard({ href, external, icon, tone = '', title, description, tag }: AppCardProps) {
  const body = (
    <>
      <div className="app-card-top">
        <span className={`icon-tile ${tone}`}>{icon}</span>
        {tag && <span className="badge">{tag}</span>}
      </div>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <span className="app-card-go">
        開啟 <ArrowRight size={16} aria-hidden="true" />
      </span>
    </>
  );
  return external ? (
    <a href={href} className="card app-card">
      {body}
    </a>
  ) : (
    <Link to={href} className="card app-card">
      {body}
    </Link>
  );
}

export default function HomePage() {
  const { user, profile, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="spinner-page">載入中…</div>;
  }

  if (!user) {
    return (
      <div className="container">
        <section className="home-hero">
          <span className="eyebrow">個人工作台</span>
          <h1>把設計與投資，放在同一個地方</h1>
          <p className="home-hero-lead">
            Claude Flow 集合了室內設計工作室與台股分析，一個帳號登入，所有工具隨手可用。
          </p>
          <div className="row home-actions">
            <Link to="/register" className="btn btn-primary">
              免費註冊
            </Link>
            <Link to="/login" className="btn">
              登入
            </Link>
          </div>
        </section>

        <section className="feature-grid" aria-label="功能介紹">
          <div className="card feature">
            <span className="icon-tile">
              <Sofa size={22} aria-hidden="true" />
            </span>
            <h2>室內設計</h2>
            <p className="muted">畫好 2D 平面圖即時生成 3D，拖拉家具門窗，選定風格讓 AI 幫你配置。</p>
          </div>
          <div className="card feature">
            <span className="icon-tile gold">
              <TrendingUp size={22} aria-hidden="true" />
            </span>
            <h2>台股分析</h2>
            <p className="muted">持股與績效追蹤、個股健康度與風險掃描，並以 AI 解讀價位結構。</p>
          </div>
          <div className="card feature">
            <span className="icon-tile sage">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <h2>安全登入</h2>
            <p className="muted">支援 Google、GitHub 與 Email/密碼，同一個 email 的登入方式會自動綁定。</p>
          </div>
        </section>
      </div>
    );
  }

  const name = profile?.displayName ?? user.displayName ?? user.email ?? '使用者';

  return (
    <div className="container">
      <header className="home-welcome">
        <div>
          <span className="eyebrow">{greeting()}</span>
          <h1>歡迎回來，{name}</h1>
          <div className="row home-meta">
            <span className={isAdmin ? 'badge badge-admin' : 'badge'}>{isAdmin ? '管理員' : '一般使用者'}</span>
            <span className="muted">最後登入：{formatTimestamp(profile?.lastLoginAt ?? null)}</span>
          </div>
        </div>
      </header>

      <section className="app-grid" aria-label="應用程式">
        <AppCard
          href="/interior/"
          external
          icon={<Sofa size={22} aria-hidden="true" />}
          title="室內設計"
          description="2D 平面圖即時生成 3D、拖拉家具門窗、風格模板 AI 自動設計。"
        />
        <AppCard
          href="/stock/"
          external
          tone="gold"
          icon={<TrendingUp size={22} aria-hidden="true" />}
          title="台股分析"
          description="持股、績效、個股分析與 AI 解讀（AI 需使用你自己的 Gemini API Key）。"
        />
        {isAdmin && (
          <AppCard
            href="/admin/users"
            tone="sage"
            icon={<Users size={22} aria-hidden="true" />}
            title="使用者管理"
            description="檢視所有使用者、調整角色與停用帳號。"
            tag="管理員"
          />
        )}
        <AppCard
          href="/profile"
          tone="sage"
          icon={<UserRound size={22} aria-hidden="true" />}
          title="個人資料"
          description="編輯顯示名稱與頭像，管理 Google、GitHub、Email 登入方式。"
        />
      </section>
    </div>
  );
}
