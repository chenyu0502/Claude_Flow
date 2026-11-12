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
  /** Firebase Auth 使用者；未登入為 null */
  user: User | null;
  /** Firestore users/{uid}；讀取中或不存在為 null */
  profile: UserProfile | null;
  /** 首次判定登入狀態 + 首次載入 profile 完成前為 true */
  loading: boolean;
  isAdmin: boolean;
  isDisabled: boolean;
  /** 有待綁定的憑證時為衝突的 email，頁面可提示「請用原本方式登入以完成綁定」 */
  pendingLinkEmail: string | null;
  signInWithGoogle(): Promise<void>;
  signInWithGithub(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string, displayName: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** 衝突錯誤未帶 email 時用於提示的佔位文字 */
const UNKNOWN_EMAIL = '該 email';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingLinkEmail, setPendingLinkEmail] = useState<string | null>(null);

  /** 待綁定的憑證（不放 state，避免觸發渲染，也避免閉包拿到舊值） */
  const pendingCredRef = useRef<AuthCredential | null>(null);
  /** 當前 profile 訂閱的退訂函式 */
  const profileUnsubRef = useRef<Unsubscribe | null>(null);
  /** 每次 auth 狀態變化 / effect 清理時遞增；非同步回撥對比世代，舊世代的結果一律丟棄 */
  const generationRef = useRef(0);
  /**
   * Email 註冊時填的顯示名稱。createUserWithEmailAndPassword 會先觸發 onAuthStateChanged，
   * 此時 updateProfile 還沒跑完，users 文件會以 displayName=null 建立；等 profile 快照到達後再補寫。
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

      // 1. 有衝突時留下的憑證 → 先綁定到剛登入的帳號（同步取出並清空，防止重複綁定）
      const cred = pendingCredRef.current;
      if (cred) {
        pendingCredRef.current = null;
        try {
          current = await authService.linkPendingCredential(firebaseUser, cred);
        } catch (err) {
          console.error('[AuthContext] 綁定待處理憑證失敗', err);
        }
        setPendingLinkEmail(null);
        if (!isCurrent()) return;
      }

      // 2. 建立 / 同步 users/{uid}。失敗（例如已停用帳號被 rules 拒寫）不阻斷，仍訂閱以讀取 profile
      try {
        await ensureUserProfile(current);
      } catch (err) {
        console.error('[AuthContext] ensureUserProfile 失敗', err);
      }
      if (!isCurrent()) return;

      // 3. 訂閱 profile；首次快照（或錯誤）到達時結束 loading
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
                console.error('[AuthContext] 補寫顯示名稱失敗', err),
              );
            }
          },
          (err) => {
            if (!isCurrent()) return;
            console.error('[AuthContext] 訂閱 profile 失敗', err);
            setProfile(null);
            setLoading(false);
          },
        );
      } catch (err) {
        console.error('[AuthContext] subscribeUserProfile 失敗', err);
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

  /** 包裝登入方法：捕獲帳號衝突 → 存憑證、記下 email，然後繼續拋出給頁面顯示 */
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
  if (!ctx) throw new Error('useAuth 必須在 <AuthProvider> 內使用');
  return ctx;
}
