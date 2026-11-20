import type { ReactNode } from 'react';
import { Plane, ShieldCheck, Sofa, TrendingUp } from 'lucide-react';
import BrandMark from './BrandMark';

/**
 * 登入、註冊、重設密碼頁的外框：桌面寬度左邊是品牌側欄、右邊放表單卡片；手機只顯示表單。
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="container auth-page">
      <div className="auth-shell">
        <aside className="auth-aside" aria-hidden="true">
          <div className="auth-aside-brand">
            <BrandMark size={36} />
            <span>Claude Flow</span>
          </div>
          <p className="auth-aside-quote">讓每個想法，都有好好落地的地方。</p>
          <ul className="auth-aside-list">
            <li>
              <Sofa size={18} />
              室內設計：2D 平面圖即時生成 3D
            </li>
            <li>
              <Plane size={18} />
              旅遊規劃：每日動線、預算與行前清單
            </li>
            <li>
              <TrendingUp size={18} />
              台股分析：持股、績效與風險掃描
            </li>
            <li>
              <ShieldCheck size={18} />
              Google、GitHub、Email 安全登入
            </li>
          </ul>
        </aside>
        <div className="auth-main">{children}</div>
      </div>
    </div>
  );
}
