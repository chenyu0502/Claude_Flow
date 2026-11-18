// 登入紀錄與操作日誌（Firestore auditLogs/{logId}）的讀寫。
//
// 日誌由前端寫入（Spark 方案沒有 Cloud Functions），firestore.rules 負責把關：
// 只能記自己的事、時間由伺服器決定、寫入後不能改也不能刪；
// 管理員操作必須和實際的 users 變更寫在同一個批次（見 services/users.ts 的 setUserRole）。
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ProviderId, Role } from '../types/user';

const AUDIT_LOGS = 'auditLogs';

/** 事件類型與對應的 detail 結構（與 firestore.rules 的 validSelfLog / validAdminLog 一致） */
export interface AuditDetailMap {
  login: { method: ProviderId };
  register: { method: ProviderId };
  logout: Record<string, never>;
  password_change: Record<string, never>;
  email_verified: Record<string, never>;
  provider_link: { provider: ProviderId };
  provider_unlink: { provider: ProviderId };
  profile_update: { fields: ('displayName' | 'photoURL')[] };
  role_change: { role: Role };
  disabled_change: { disabled: boolean };
}
export type AuditType = keyof AuditDetailMap;
export type SelfAuditType = Exclude<AuditType, 'role_change' | 'disabled_change'>;

export interface AuditLog {
  id: string;
  type: AuditType;
  actorUid: string;
  actorEmail: string | null;
  targetUid: string | null;
  detail: Record<string, unknown>;
  device: string | null;
  createdAt: Timestamp | null;
}

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  login: '登入',
  register: '註冊',
  logout: '登出',
  password_change: '修改密碼',
  email_verified: '完成 Email 驗證',
  provider_link: '綁定登入方式',
  provider_unlink: '解除登入方式',
  profile_update: '修改個人資料',
  role_change: '調整角色',
  disabled_change: '停用／啟用帳號',
};

const DEVICE_MAX = 100;

/**
 * 從 User-Agent 整理出「瀏覽器 · 作業系統」，例如「Chrome · Windows」。
 * 只取大類，不存完整 User-Agent（太長，也帶有不必要的指紋資訊）。
 */
export function describeDevice(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '其他瀏覽器';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '其他系統';
  return `${browser} · ${os}`.slice(0, DEVICE_MAX);
}

function currentDevice(): string | null {
  return describeDevice(typeof navigator === 'undefined' ? null : navigator.userAgent);
}

/** 組出一筆日誌的文件內容；未登入時回傳 null */
function buildLog(type: AuditType, detail: object, targetUid: string | null): DocumentData | null {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    type,
    actorUid: user.uid,
    actorEmail: user.email ?? null,
    targetUid,
    detail,
    device: currentDevice(),
    createdAt: serverTimestamp(),
  };
}

/**
 * 記錄自己帳號的事件。日誌是輔助資訊，寫入失敗只記 console，不影響原本的操作；
 * 也不回傳錯誤給呼叫端，呼叫端可以放心 await 或不 await。
 */
export async function logSelfEvent<T extends SelfAuditType>(type: T, detail: AuditDetailMap[T]): Promise<void> {
  const data = buildLog(type, detail, null);
  if (!data) return;
  try {
    await setDoc(doc(collection(db, AUDIT_LOGS)), data);
  } catch (err) {
    console.error(`[auditLog] 記錄「${AUDIT_TYPE_LABELS[type]}」失敗`, err);
  }
}

/**
 * 把管理員操作的日誌加進同一個批次。規則要求日誌與實際變更一起寫入，
 * 所以這裡不單獨寫，交給呼叫端 commit；批次失敗時變更與日誌都不會寫入。
 */
export function addAdminLogToBatch<T extends 'role_change' | 'disabled_change'>(
  batch: WriteBatch,
  type: T,
  targetUid: string,
  detail: AuditDetailMap[T],
): void {
  const data = buildLog(type, detail, targetUid);
  if (!data) throw new Error('請先登入');
  batch.set(doc(collection(db, AUDIT_LOGS)), data);
}

function asTimestampOrNull(v: unknown): Timestamp | null {
  return v instanceof Timestamp ? v : null;
}

export function toAuditLog(id: string, d: DocumentData | undefined): AuditLog {
  const data = d ?? {};
  return {
    id,
    type: (data.type in AUDIT_TYPE_LABELS ? data.type : 'login') as AuditType,
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : null,
    targetUid: typeof data.targetUid === 'string' ? data.targetUid : null,
    detail: data.detail && typeof data.detail === 'object' ? (data.detail as Record<string, unknown>) : {},
    device: typeof data.device === 'string' ? data.device : null,
    createdAt: asTimestampOrNull(data.createdAt),
  };
}

const PROVIDER_NAMES: Record<string, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  password: 'Email/密碼',
};

/** detail 轉成給人看的說明，例如「Google」、「改為管理員」 */
export function describeDetail(log: Pick<AuditLog, 'type' | 'detail'>): string {
  const d = log.detail;
  switch (log.type) {
    case 'login':
    case 'register':
      return PROVIDER_NAMES[String(d.method)] ?? '';
    case 'provider_link':
    case 'provider_unlink':
      return PROVIDER_NAMES[String(d.provider)] ?? '';
    case 'profile_update': {
      const names: Record<string, string> = { displayName: '顯示名稱', photoURL: '頭像' };
      return Array.isArray(d.fields) ? d.fields.map((f) => names[String(f)] ?? String(f)).join('、') : '';
    }
    case 'role_change':
      return d.role === 'admin' ? '改為管理員' : '改為一般使用者';
    case 'disabled_change':
      return d.disabled === true ? '停用' : '啟用';
    default:
      return '';
  }
}

/** 個人資料頁：自己最近的帳號活動（需要 actorUid + createdAt 的複合索引，見 firestore.indexes.json） */
export function subscribeOwnLogs(
  uid: string,
  max: number,
  onData: (logs: AuditLog[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(db, AUDIT_LOGS), where('actorUid', '==', uid), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => toAuditLog(d.id, d.data({ serverTimestamps: 'estimate' })))),
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export interface AuditLogPage {
  logs: AuditLog[];
  /** 下一頁的起點；沒有更多時為 null */
  cursor: DocumentSnapshot | null;
}

/** 管理員：依時間新到舊分頁讀取全部日誌 */
export async function fetchAuditLogPage(pageSize: number, after: DocumentSnapshot | null = null): Promise<AuditLogPage> {
  const constraints = [orderBy('createdAt', 'desc'), ...(after ? [startAfter(after)] : []), limit(pageSize)];
  const snap = await getDocs(query(collection(db, AUDIT_LOGS), ...constraints));
  const logs = snap.docs.map((d) => toAuditLog(d.id, d.data({ serverTimestamps: 'estimate' })));
  const cursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null;
  return { logs, cursor };
}
