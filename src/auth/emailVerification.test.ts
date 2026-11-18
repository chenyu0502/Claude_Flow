import { describe, expect, it } from 'vitest';
import { needsEmailVerification } from './emailVerification';

const user = (emailVerified: boolean, ...providers: string[]) => ({
  emailVerified,
  providerData: providers.map((providerId) => ({ providerId })),
});

describe('needsEmailVerification', () => {
  it('未登入不需要驗證', () => {
    expect(needsEmailVerification(null)).toBe(false);
    expect(needsEmailVerification(undefined)).toBe(false);
  });

  it('只用 Email/密碼且未驗證 → 需要驗證', () => {
    expect(needsEmailVerification(user(false, 'password'))).toBe(true);
  });

  it('Email/密碼已驗證 → 不需要', () => {
    expect(needsEmailVerification(user(true, 'password'))).toBe(false);
  });

  it('GitHub 登入即使 emailVerified 為 false 也不需要（信箱由 GitHub 驗證過）', () => {
    expect(needsEmailVerification(user(false, 'github.com'))).toBe(false);
    expect(needsEmailVerification(user(false, 'github.com', 'password'))).toBe(false);
  });

  it('Google 登入不需要', () => {
    expect(needsEmailVerification(user(true, 'google.com'))).toBe(false);
  });

  it('沒有任何登入方式資料（例如匿名）不需要', () => {
    expect(needsEmailVerification(user(false))).toBe(false);
  });
});
