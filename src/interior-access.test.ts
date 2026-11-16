import { describe, expect, it } from 'vitest';
import { decideInteriorAccess, isPublicShareView } from './interior-access';
import type { UserProfile } from './types/user';

const profile = (disabled: boolean) => ({ uid: 'u', role: 'user', disabled }) as UserProfile;

describe('isPublicShareView', () => {
  it('唯讀分享連結（#share= 與 ?g=）不需要登入', () => {
    expect(isPublicShareView({ hash: '#share=abc_-123', search: '' })).toBe(true);
    expect(isPublicShareView({ hash: '', search: '?g=0123abcd' })).toBe(true);
  });

  it('一般開啟、其他 hash 或查詢參數都要登入', () => {
    expect(isPublicShareView({ hash: '', search: '' })).toBe(false);
    expect(isPublicShareView({ hash: '#plan', search: '?x=1' })).toBe(false);
    expect(isPublicShareView({ hash: '#xshare=abc', search: '' })).toBe(false);
  });
});

describe('decideInteriorAccess', () => {
  it('未登入 → 導向登入頁', () => {
    expect(decideInteriorAccess(false, undefined)).toBe('login');
  });

  it('已登入但使用者資料還在讀取 → 保持隱藏', () => {
    expect(decideInteriorAccess(true, undefined)).toBeNull();
  });

  it('已登入且未停用 → 可以使用（不限管理員）', () => {
    expect(decideInteriorAccess(true, profile(false))).toBe('allow');
  });

  it('帳號已停用 → 停用提示', () => {
    expect(decideInteriorAccess(true, profile(true))).toBe('disabled');
  });

  it('沒有 Claude Flow 使用者資料 → 提示先從 Claude Flow 登入', () => {
    expect(decideInteriorAccess(true, null)).toBe('no-profile');
  });
});
