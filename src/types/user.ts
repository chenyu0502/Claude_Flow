import type { Timestamp } from 'firebase/firestore';

export type Role = 'admin' | 'user';

/** Firebase Auth 的 providerId */
export type ProviderId = 'google.com' | 'github.com' | 'password';

/** Firestore 文件 users/{uid} 的結構。文件 ID 即 uid。 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** 只有 admin 能修改；新建時一律為 'user' */
  role: Role;
  /** 只有 admin 能修改；停用後無法使用需登入的頁面，也無法寫入自己的文件 */
  disabled: boolean;
  /** 該帳號已綁定的登入方式，登入時由客戶端同步 */
  providers: ProviderId[];
  createdAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
}

/** 使用者本人可以修改的欄位 */
export type EditableProfileFields = Pick<UserProfile, 'displayName' | 'photoURL'>;

export const SUPPORTED_PROVIDERS: ProviderId[] = ['google.com', 'github.com', 'password'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  password: 'Email/密碼',
};
