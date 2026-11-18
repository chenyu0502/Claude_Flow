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
import { needsEmailVerification as computeNeedsVerification } from './emailVerification';
import { logSelfEvent } from '../services/auditLog';

export interface AuthContextValue {
  /** Firebase Auth 使用者；未登入為 null */
  user: User | null;
  /** Firestore users/{uid}；讀取中或不存在為 null */
  profile: UserProfile | null;
  /** 首次判定登入狀態 + 首次載入 profile 完成前為 true */
  loading: boolean;
  isAdmin: boolean;
  isDisabled: boolean;
  /** 只用 Email/密碼登入且尚未驗證信箱；為 true 時守衛會擋住需要登入的頁面 */
  needsEmailVerification: boolean;
  /** 有待綁定的憑證時為衝突的 email，頁面可提示「請用原本方式登入以完成綁定」 */
  pendingLinkEmail: string | null;
  signInWithGoogle(): Promise<void>;
  signInWithGithub(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string, displayName: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** 重新寄送 Email 驗證信 */
  resendVerificationEmail(): Promise<void>;
  /** 重新讀取驗證狀態（使用者點了信中連結之後）；回傳是否已完成驗證 */
  refreshEmailVerification(): Promise<boolean>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** 登出前等日誌寫入的上限：離線時寫入會一直等伺服器回應，不能讓登出卡住 */
const LOGOUT_LOG_TIMEOUT_MS = 1500;

/** 衝突錯誤未帶 email 時用於提示的佔位文字 */
const UNKNOWN_EMAIL = '該 email';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingLinkEmail, setPendingLinkEmail] = useState<string | null>(null);
  /** emailVerified 存在 User 物件上，reload 後物件引用不變，另存一份才會觸發重繪 */
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  /** 同一個值的 ref 版本：refreshEmailVerification 用它判斷「這次才完成驗證」，不受閉包舊值影響 */
  const needsVerificationRef = useRef(false);

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
      needsVerificationRef.current = computeNeedsVerification(firebaseUser);
      setNeedsEmailVerification(needsVerificationRef.current);
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

  // 登入紀錄只在「使用者主動登入」時寫，重新整理頁面時自動恢復登入狀態不算一次登入。
  // 日誌寫入不 await：失敗只記 console，不能拖慢或擋住登入。
  const signInWithGoogle = useCallback(async () => {
    await withConflictCapture(() => authService.signInWithGoogle());
    void logSelfEvent('login', { method: 'google.com' });
  }, [withConflictCapture]);
  const signInWithGithub = useCallback(async () => {
    await withConflictCapture(() => authService.signInWithGithub());
    void logSelfEvent('login', { method: 'github.com' });
  }, [withConflictCapture]);
  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await withConflictCapture(() => authService.signInWithEmail(email, password));
      void logSelfEvent('login', { method: 'password' });
    },
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
      void logSelfEvent('register', { method: 'password' });
    },
    [withConflictCapture],
  );
  const resetPassword = useCallback((email: string) => authService.sendResetEmail(email), []);
  const resendVerificationEmail = useCallback(() => authService.sendVerificationEmail(), []);
  const refreshEmailVerification = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    const fresh = auth.currentUser ?? current;
    const stillNeeds = computeNeedsVerification(fresh);
    // 換一張新的 ID token：舊 token 裡的 email_verified 還是 false，
    // 不換的話 API 與 Firestore 規則要等到 token 自然到期（最長一小時）才會放行。
    if (!stillNeeds) await fresh.getIdToken(true);
    // 只在「這次檢查才變成已驗證」時記一筆，已驗證過的帳號重複檢查不重複記。
    if (needsVerificationRef.current && !stillNeeds) {
      void logSelfEvent('email_verified', {});
    }
    needsVerificationRef.current = stillNeeds;
    setNeedsEmailVerification(stillNeeds);
    return !stillNeeds;
  }, []);
  const signOut = useCallback(async () => {
    pendingCredRef.current = null;
    pendingDisplayNameRef.current = null;
    setPendingLinkEmail(null);
    // 登出要在登出前記：登出後就沒有登入憑證，規則不允許寫入。
    await Promise.race([
      logSelfEvent('logout', {}),
      new Promise((resolve) => setTimeout(resolve, LOGOUT_LOG_TIMEOUT_MS)),
    ]);
    await authService.signOutUser();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      isAdmin: profile?.role === 'admin' && !profile.disabled,
      isDisabled: profile?.disabled === true,
      needsEmailVerification,
      pendingLinkEmail,
      signInWithGoogle,
      signInWithGithub,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      resendVerificationEmail,
      refreshEmailVerification,
      signOut,
    }),
    [
      user,
      profile,
      loading,
      needsEmailVerification,
      pendingLinkEmail,
      signInWithGoogle,
      signInWithGithub,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      resendVerificationEmail,
      refreshEmailVerification,
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
