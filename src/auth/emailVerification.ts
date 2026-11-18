/**
 * Email 驗證的判斷：只有「只用 Email/密碼登入」且尚未驗證信箱的帳號需要驗證。
 *
 * - Google 登入的 Email 由 Google 驗證過，Firebase 會標成 emailVerified = true。
 * - GitHub 登入時 Firebase 常把 emailVerified 標成 false，但信箱一樣由 GitHub 驗證過，
 *   不能因此擋住 GitHub 使用者，所以只看「是否全部都是 password」。
 * - 綁定了 Google 的 Email/密碼帳號，Firebase 會把 emailVerified 改成 true。
 *
 * 主站守衛、台股、室內設計共用這個判斷，三個入口的行為才會一致。
 */
export function needsEmailVerification(
  user: { emailVerified?: boolean; providerData?: { providerId: string }[] } | null | undefined,
): boolean {
  if (!user || user.emailVerified) return false;
  const providers = user.providerData ?? [];
  return providers.length > 0 && providers.every((p) => p.providerId === 'password');
}
