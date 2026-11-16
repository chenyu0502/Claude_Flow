import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { KeyRound, Mail, PenLine } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/NavBar';
import { GithubIcon, GoogleIcon } from '../components/OAuthButtons';
import { auth } from '../lib/firebase';
import { authErrorMessage, isUserCancelled, linkProvider, unlinkProvider } from '../services/auth';
import { ensureUserProfile, updateOwnProfile } from '../services/users';
import { PROVIDER_LABELS, SUPPORTED_PROVIDERS, type ProviderId } from '../types/user';
import './profile.css';

export const DISPLAY_NAME_MAX = 50;

const PROVIDER_ICONS: Record<ProviderId, ReactNode> = {
  'google.com': <GoogleIcon />,
  'github.com': <GithubIcon />,
  password: <Mail size={18} aria-hidden="true" />,
};

export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleString('zh-TW');
  } catch {
    return '—';
  }
}

/** 返回錯誤訊息；透過時返回 null */
export function validateProfile(displayName: string, photoURL: string): string | null {
  const name = displayName.trim();
  if (!name) return '顯示名稱不能為空';
  if (name.length > DISPLAY_NAME_MAX) return `顯示名稱不能超過 ${DISPLAY_NAME_MAX} 個字`;
  const url = photoURL.trim();
  if (url && !url.startsWith('https://')) return '頭像網址必須以 https:// 開頭';
  return null;
}

type Msg = { kind: 'success' | 'error'; text: string } | null;

function linkedProviders(providerData: { providerId: string }[] | undefined): ProviderId[] {
  const ids = (providerData ?? []).map((p) => p.providerId);
  return SUPPORTED_PROVIDERS.filter((id) => ids.includes(id));
}

export default function ProfilePage() {
  const { user, profile, isAdmin } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<Msg>(null);

  // providers 以 Firebase Auth 的 providerData 為準；link/unlink 後 user 物件引用不變，所以另存一份觸發重繪
  const [linked, setLinked] = useState<ProviderId[]>(() => linkedProviders(user?.providerData));
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null);
  const [providerMsg, setProviderMsg] = useState<Msg>(null);

  useEffect(() => {
    setLinked(linkedProviders(user?.providerData));
  }, [user]);

  // profile 首次到達時填入表單（之後不覆蓋使用者正在編輯的內容）
  useEffect(() => {
    if (initialized || !profile) return;
    setDisplayName(profile.displayName ?? '');
    setPhotoURL(profile.photoURL ?? '');
    setInitialized(true);
  }, [profile, initialized]);

  if (!user) return null; // RequireAuth 已把關
  if (!profile) return <div className="spinner-page">載入中…</div>;

  const uid = user.uid;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveMsg(null);
    const err = validateProfile(displayName, photoURL);
    if (err) {
      setSaveMsg({ kind: 'error', text: err });
      return;
    }
    setSaving(true);
    try {
      const url = photoURL.trim();
      await updateOwnProfile(uid, { displayName: displayName.trim(), photoURL: url || null });
      setSaveMsg({ kind: 'success', text: '已儲存' });
    } catch (saveErr) {
      setSaveMsg({ kind: 'error', text: authErrorMessage(saveErr) });
    } finally {
      setSaving(false);
    }
  }

  async function syncAfterProviderChange() {
    const current = auth.currentUser ?? user;
    if (!current) return;
    await current.reload();
    const fresh = auth.currentUser ?? current;
    setLinked(linkedProviders(fresh.providerData));
    await ensureUserProfile(fresh);
  }

  async function runProviderAction(id: ProviderId, action: () => Promise<unknown>, okText: string) {
    setProviderMsg(null);
    setBusyProvider(id);
    try {
      await action();
      await syncAfterProviderChange();
      setProviderMsg({ kind: 'success', text: okText });
    } catch (err) {
      if (!isUserCancelled(err)) setProviderMsg({ kind: 'error', text: authErrorMessage(err) });
    } finally {
      setBusyProvider(null);
    }
  }

  const handleLink = (id: Exclude<ProviderId, 'password'>) =>
    runProviderAction(id, () => linkProvider(id), `已綁定 ${PROVIDER_LABELS[id]}`);
  const handleUnlink = (id: ProviderId) =>
    runProviderAction(id, () => unlinkProvider(id), `已解除 ${PROVIDER_LABELS[id]}`);

  const onlyOne = linked.length <= 1;
  const headerName = profile.displayName || profile.email || user.email;

  return (
    <div className="container profile-page">
      <header className="page-head">
        <span className="eyebrow">帳號</span>
        <h1>個人資料</h1>
        <p>管理你在 Claude Flow 的顯示名稱、頭像與登入方式。</p>
      </header>

      <aside className="card profile-side">
        <Avatar name={headerName} photoURL={profile.photoURL} large />
        <h2>{profile.displayName || '未命名使用者'}</h2>
        <span className="profile-email">{profile.email ?? user.email ?? '—'}</span>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className={isAdmin ? 'badge badge-admin' : 'badge'}>{isAdmin ? '管理員' : '一般使用者'}</span>
          {profile.disabled && <span className="badge badge-danger">已停用</span>}
        </div>
        <dl className="profile-meta">
          <dt>建立時間</dt>
          <dd>{formatTimestamp(profile.createdAt)}</dd>
          <dt>最後登入</dt>
          <dd>{formatTimestamp(profile.lastLoginAt)}</dd>
        </dl>
      </aside>

      <div className="profile-main">
      <section className="card">
        <div className="section-title">
          <span className="icon-tile">
            <PenLine size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>編輯資料</h2>
            <p className="muted">名稱最多 {DISPLAY_NAME_MAX} 字，頭像需為 https 網址。</p>
          </div>
        </div>
        <form className="stack" onSubmit={handleSave} noValidate>
          <div className="field">
            <label htmlFor="displayName">顯示名稱</label>
            <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <span className="field-hint">
              {displayName.trim().length}/{DISPLAY_NAME_MAX}
            </span>
          </div>
          <div className="field">
            <label htmlFor="photoURL">頭像網址</label>
            <input
              id="photoURL"
              type="url"
              placeholder="https://…（留空則顯示首字母）"
              value={photoURL}
              onChange={(e) => setPhotoURL(e.target.value)}
            />
          </div>
          {saveMsg && (
            <div className={`alert alert-${saveMsg.kind}`} role={saveMsg.kind === 'error' ? 'alert' : 'status'}>
              {saveMsg.text}
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </form>
      </section>

      <section className="card stack">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span className="icon-tile sage">
            <KeyRound size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>登入方式</h2>
            <p className="muted">綁定多種方式，任何一種都能登入同一個帳號。</p>
          </div>
        </div>
        <ul className="provider-list">
          {SUPPORTED_PROVIDERS.map((id) => {
            const isLinked = linked.includes(id);
            return (
              <li key={id} className="provider-item" data-testid={`provider-${id}`}>
                <span className="provider-name">
                  {PROVIDER_ICONS[id]}
                  {PROVIDER_LABELS[id]}
                </span>
                <span className="row">
                  {isLinked ? (
                    <>
                      <span className="badge">已綁定</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={onlyOne || busyProvider !== null}
                        title={onlyOne ? '至少需要保留一種登入方式' : undefined}
                        onClick={() => handleUnlink(id)}
                      >
                        解除
                      </button>
                    </>
                  ) : id === 'password' ? (
                    <span className="muted">未設定</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyProvider !== null}
                      onClick={() => handleLink(id)}
                    >
                      綁定
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {onlyOne && <p className="field-hint">只剩一種登入方式，無法解除；請先綁定其他登入方式。</p>}
        {providerMsg && (
          <div className={`alert alert-${providerMsg.kind}`} role={providerMsg.kind === 'error' ? 'alert' : 'status'}>
            {providerMsg.text}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
