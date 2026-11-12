// OWNER: Agent B。users/{uid} 的所有 Firestore 读写都只经过这里。
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

/** 与 firestore.rules 一致的 displayName 长度上限 */
export const DISPLAY_NAME_MAX_LENGTH = 50;

function userRef(uid: string) {
  return doc(db, USERS, uid);
}

/** 从 Auth 的 providerData 取出支持的登录方式（去重） */
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

/** Firestore 文档数据 → UserProfile；缺字段或类型不对时给安全默认值（role='user'、disabled=false） */
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
 * 每次登录后由 AuthContext 调用。
 * 文档不存在：建立（role='user', disabled=false, createdAt/lastLoginAt=serverTimestamp()）。
 * 文档存在：只更新 email / providers / lastLoginAt（绝不覆盖 role、disabled，也不覆盖用户自己改过的 displayName/photoURL）。
 * 已停用的账号：rules 禁止本人写入，所以直接跳过更新（仍可读，前端据此显示停用提示）。
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);
  const providers = providersOf(user);
  const displayName = user.displayName ? user.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH) : null;
  // rules 限制 photoURL ≤ 2048 字，超长的直接不存，避免整个建档被拒
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
      throw new Error(`显示名称不能超过 ${DISPLAY_NAME_MAX_LENGTH} 个字`);
    }
    patch.displayName = name ?? null;
  }
  if ('photoURL' in fields) {
    patch.photoURL = fields.photoURL ?? null;
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(userRef(uid), patch);
}

/** 仅 admin 可用（由 Security Rules 把关），按 createdAt 新到旧 */
export function subscribeAllUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(db, USERS), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
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
