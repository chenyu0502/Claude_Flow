// OWNER: Agent C
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type AuthCredential, type User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import type { UserProfile } from '../types/user';
import { auth } from '../lib/firebase';
import * as authService from '../services/auth';
import { AccountExistsWithDifferentCredentialError } from '../services/auth';
import { ensureUserProfile, subscribeUserProfile, updateOwnProfile } from '../services/users';

export interface AuthContextValue {
  /** Firebase Auth 用户；未登录为 null */
  user: User | null;
  /** Firestore users/{uid}；读取中或不存在为 null */
  profile: UserProfile | null;
  /** 首次判定登录状态 + 首次载入 profile 完成前为 true */
  loading: boolean;
  isAdmin: boolean;
  isDisabled: boolean;
  /** 有待绑定的凭证时为冲突的 email，页面可提示「请用原本方式登录以完成绑定」 */
  pendingLinkEmail: string | null;
  signInWithGoogle(): Promise<void>;
  signInWithGithub(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string, displayName: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** 冲突错误未带 email 时用于提示的占位文字 */
const UNKNOWN_EMAIL = '该 email';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingLinkEmail, setPendingLinkEmail] = useState<string | null>(null);

  /** 待绑定的凭证（不放 state，避免触发渲染，也避免闭包拿到旧值） */
  const pendingCredRef = useRef<AuthCredential | null>(null);
  /** 当前 profile 订阅的退订函数 */
  const profileUnsubRef = useRef<Unsubscribe | null>(null);
  /** 每次 auth 状态变化 / effect 清理时递增；异步回调对比世代，旧世代的结果一律丢弃 */
  const generationRef = useRef(0);
  /**
   * Email 注册时填的显示名称。createUserWithEmailAndPassword 会先触发 onAuthStateChanged，
   * 此时 updateProfile 还没跑完，users 文档会以 displayName=null 建立；等 profile 快照到达后再补写。
   */
  const pendingDisplayNameRef = useRef<string | null>(null);

  useEffect(() => {
    const stopProfile = () => {
      profileUnsubRef.current?.();
      profileUnsubRef.current = null;
    };

    const handleUser = async (firebaseUser: User, gen: number) => {
      const isCurrent = () => generationRef.current === gen;
      let current = firebaseUser;

      // 1. 有冲突时留下的凭证 → 先绑定到刚登录的账号（同步取出并清空，防止重复绑定）
      const cred = pendingCredRef.current;
      if (cred) {
        pendingCredRef.current = null;
        try {
          current = await authService.linkPendingCredential(firebaseUser, cred);
        } catch (err) {
          console.error('[AuthContext] 绑定待处理凭证失败', err);
        }
        setPendingLinkEmail(null);
        if (!isCurrent()) return;
      }

      // 2. 建立 / 同步 users/{uid}。失败（例如已停用账号被 rules 拒写）不阻断，仍订阅以读取 profile
      try {
        await ensureUserProfile(current);
      } catch (err) {
        console.error('[AuthContext] ensureUserProfile 失败', err);
      }
      if (!isCurrent()) return;

      // 3. 订阅 profile；首次快照（或错误）到达时结束 loading
      try {
        stopProfile();
        profileUnsubRef.current = subscribeUserProfile(
          current.uid,
          (p) => {
            if (!isCurrent()) return;
            setProfile(p);
            setLoading(false);
            const pendingName = pendingDisplayNameRef.current;
            if (p && pendingName && p.displayName == null && !p.disabled) {
              pendingDisplayNameRef.current = null;
              updateOwnProfile(current.uid, { displayName: pendingName }).catch((err) =>
                console.error('[AuthContext] 补写显示名称失败', err),
              );
            }
          },
          (err) => {
            if (!isCurrent()) return;
            console.error('[AuthContext] 订阅 profile 失败', err);
            setProfile(null);
            setLoading(false);
          },
        );
      } catch (err) {
        console.error('[AuthContext] subscribeUserProfile 失败', err);
        if (isCurrent()) setLoading(false);
      }
    };

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      const gen = ++generationRef.current;
      stopProfile();
      setProfile(null);
      setUser(firebaseUser);
      if (!firebaseUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void handleUser(firebaseUser, gen);
    });

    return () => {
      generationRef.current++;
      unsubAuth();
      stopProfile();
    };
  }, []);

  /** 包装登录方法：捕获账号冲突 → 存凭证、记下 email，然后继续抛出给页面显示 */
  const withConflictCapture = useCallback(async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof AccountExistsWithDifferentCredentialError) {
        pendingCredRef.current = err.pendingCredential;
        setPendingLinkEmail(err.email ?? UNKNOWN_EMAIL);
      }
      throw err;
    }
  }, []);

  const signInWithGoogle = useCallback(
    () => withConflictCapture(() => authService.signInWithGoogle()),
    [withConflictCapture],
  );
  const signInWithGithub = useCallback(
    () => withConflictCapture(() => authService.signInWithGithub()),
    [withConflictCapture],
  );
  const signInWithEmail = useCallback(
    (email: string, password: string) => withConflictCapture(() => authService.signInWithEmail(email, password)),
    [withConflictCapture],
  );
  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      pendingDisplayNameRef.current = displayName.trim() || null;
      try {
        await withConflictCapture(() => authService.signUpWithEmail(email, password, displayName));
      } catch (err) {
        pendingDisplayNameRef.current = null;
        throw err;
      }
    },
    [withConflictCapture],
  );
  const resetPassword = useCallback((email: string) => authService.sendResetEmail(email), []);
  const signOut = useCallback(async () => {
    pendingCredRef.current = null;
    pendingDisplayNameRef.current = null;
    setPendingLinkEmail(null);
    await authService.signOutUser();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      isAdmin: profile?.role === 'admin' && !profile.disabled,
      isDisabled: profile?.disabled === true,
      pendingLinkEmail,
      signInWithGoogle,
      signInWithGithub,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
    }),
    [
      user,
      profile,
      loading,
      pendingLinkEmail,
      signInWithGoogle,
      signInWithGithub,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
