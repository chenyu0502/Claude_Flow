// OWNER: Agent B。users/{uid} 的所有 Firestore 讀寫都只經過這裡。
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { EditableProfileFields, ProviderId, Role, UserProfile } from '../types/user';
import { SUPPORTED_PROVIDERS } from '../types/user';

const USERS = 'users';

/** 與 firestore.rules 一致的 displayName 長度上限 */
export const DISPLAY_NAME_MAX_LENGTH = 50;

function userRef(uid: string) {
  return doc(db, USERS, uid);
}

/** 從 Auth 的 providerData 取出支援的登入方式（去重） */
export function providersOf(user: Pick<User, 'providerData'>): ProviderId[] {
  const ids = (user.providerData ?? [])
    .map((p) => p?.providerId)
    .filter((id): id is ProviderId => SUPPORTED_PROVIDERS.includes(id as ProviderId));
  return Array.from(new Set(ids));
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asTimestampOrNull(v: unknown): Timestamp | null {
  return v instanceof Timestamp ? v : null;
}

/** Firestore 文件資料 → UserProfile；缺欄位或型別不對時給安全預設值（role='user'、disabled=false） */
export function toUserProfile(id: string, data: DocumentData | undefined): UserProfile {
  const d = data ?? {};
  const providers = Array.isArray(d.providers)
    ? (d.providers as unknown[]).filter((p): p is ProviderId =>
        SUPPORTED_PROVIDERS.includes(p as ProviderId),
      )
    : [];
  return {
    uid: typeof d.uid === 'string' ? d.uid : id,
    email: asStringOrNull(d.email),
    displayName: asStringOrNull(d.displayName),
    photoURL: asStringOrNull(d.photoURL),
    role: d.role === 'admin' ? 'admin' : 'user',
    disabled: d.disabled === true,
    providers,
    createdAt: asTimestampOrNull(d.createdAt),
    lastLoginAt: asTimestampOrNull(d.lastLoginAt),
  };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 每次登入後由 AuthContext 呼叫。
 * 文件不存在：建立（role='user', disabled=false, createdAt/lastLoginAt=serverTimestamp()）。
 * 文件存在：只更新 email / providers / lastLoginAt（絕不覆蓋 role、disabled，也不覆蓋使用者自己改過的 displayName/photoURL）。
 * 已停用的帳號：rules 禁止本人寫入，所以直接跳過更新（仍可讀，前端據此顯示停用提示）。
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);
  const providers = providersOf(user);
  const displayName = user.displayName ? user.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH) : null;
  // rules 限制 photoURL ≤ 2048 字，超長的直接不存，避免整個建檔被拒
  const photoURL = user.photoURL && user.photoURL.length <= 2048 ? user.photoURL : null;

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email ?? null,
      displayName,
      photoURL,
      role: 'user',
      disabled: false,
      providers,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    return;
  }

  const existing = snap.data();
  if (existing.disabled === true) return;

  const patch: DocumentData = {
    email: user.email ?? null,
    providers,
    lastLoginAt: serverTimestamp(),
  };
  if (existing.displayName == null && displayName) patch.displayName = displayName;
  if (existing.photoURL == null && photoURL) patch.photoURL = photoURL;
  await updateDoc(ref, patch);
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userRef(uid),
    (snap) => {
      onData(snap.exists() ? toUserProfile(snap.id, snap.data({ serverTimestamps: 'estimate' })) : null);
    },
    (err) => onError?.(toError(err)),
  );
}

export async function updateOwnProfile(uid: string, fields: Partial<EditableProfileFields>): Promise<void> {
  const patch: DocumentData = {};
  if ('displayName' in fields) {
    const name = fields.displayName;
    if (name != null && name.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new Error(`顯示名稱不能超過 ${DISPLAY_NAME_MAX_LENGTH} 個字`);
    }
    patch.displayName = name ?? null;
  }
  if ('photoURL' in fields) {
    patch.photoURL = fields.photoURL ?? null;
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(userRef(uid), patch);
}

/**
 * 僅 admin 可用（由 Security Rules 把關），按 createdAt 新到舊。
 *
 * 第一份資料一定等伺服器回應才交出去：Firestore 會先用本機快取回一次結果，
 * 而快取裡通常只有管理員自己的文件（AuthContext 訂閱過），管理頁會短暫顯示
 * 「總人數 1」，看起來像其他帳號不見了。收過一次伺服器資料之後，快取快照
 * （例如離線時）照常交出，維持即時更新。
 *
 * 代價：完全離線時開啟管理頁會一直停在載入中，直到恢復連線。
 */
export function subscribeAllUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(db, USERS), orderBy('createdAt', 'desc'));
  let receivedServerData = false;
  return onSnapshot(
    q,
    // 需要 metadata 變化通知：快取快照之後，伺服器確認「內容相同」時只會發 metadata 變化，
    // 不開這個選項就收不到，第一份資料永遠不會交出去。
    { includeMetadataChanges: true },
    (snap) => {
      if (!receivedServerData) {
        if (snap.metadata.fromCache) return;
        receivedServerData = true;
      }
      onData(snap.docs.map((d) => toUserProfile(d.id, d.data({ serverTimestamps: 'estimate' }))));
    },
    (err) => onError?.(toError(err)),
  );
}

export async function setUserRole(uid: string, role: Role): Promise<void> {
  await updateDoc(userRef(uid), { role });
}

export async function setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await updateDoc(userRef(uid), { disabled });
}
