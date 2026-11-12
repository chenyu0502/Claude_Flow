import type { Timestamp } from 'firebase/firestore';

export type Role = 'admin' | 'user';

/** Firebase Auth 的 providerId */
export type ProviderId = 'google.com' | 'github.com' | 'password';

/** Firestore 文档 users/{uid} 的结构。文档 ID 即 uid。 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** 只有 admin 能修改；新建时一律为 'user' */
  role: Role;
  /** 只有 admin 能修改；停用后无法使用需登录的页面，也无法写入自己的文档 */
  disabled: boolean;
  /** 该账号已绑定的登录方式，登录时由客户端同步 */
  providers: ProviderId[];
  createdAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
}

/** 用户本人可以修改的字段 */
export type EditableProfileFields = Pick<UserProfile, 'displayName' | 'photoURL'>;

export const SUPPORTED_PROVIDERS: ProviderId[] = ['google.com', 'github.com', 'password'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  password: 'Email/密码',
};
