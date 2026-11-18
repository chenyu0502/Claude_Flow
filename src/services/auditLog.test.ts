import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  setDoc: vi.fn(),
  doc: vi.fn(() => 'new-log-ref'),
  collection: vi.fn(() => 'logs-col'),
}));
const fb = vi.hoisted(() => ({ auth: { currentUser: null as unknown }, db: {} }));

vi.mock('../lib/firebase', () => fb);
vi.mock('firebase/firestore', () => ({
  collection: fs.collection,
  doc: fs.doc,
  setDoc: fs.setDoc,
  serverTimestamp: () => 'SERVER_TIME',
  getDocs: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  startAfter: vi.fn(),
  where: vi.fn(),
  Timestamp: class {},
}));

import { addAdminLogToBatch, describeDetail, describeDevice, logSelfEvent, toAuditLog } from './auditLog';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
};

beforeEach(() => {
  vi.clearAllMocks();
  fb.auth.currentUser = { uid: 'alice', email: 'alice@x.tw' };
});

describe('describeDevice', () => {
  it('整理成「瀏覽器 · 作業系統」', () => {
    expect(describeDevice(UA.chromeWin)).toBe('Chrome · Windows');
    expect(describeDevice(UA.edge)).toBe('Edge · Windows');
    expect(describeDevice(UA.safariIphone)).toBe('Safari · iOS');
    expect(describeDevice(UA.firefoxMac)).toBe('Firefox · macOS');
    expect(describeDevice(UA.chromeAndroid)).toBe('Chrome · Android');
  });

  it('沒有 User-Agent 時為 null', () => {
    expect(describeDevice('')).toBeNull();
    expect(describeDevice(undefined)).toBeNull();
  });
});

describe('logSelfEvent', () => {
  it('以目前登入者的身分寫入，時間交給伺服器', async () => {
    fs.setDoc.mockResolvedValue(undefined);
    await logSelfEvent('login', { method: 'google.com' });
    expect(fs.setDoc).toHaveBeenCalledWith('new-log-ref', {
      type: 'login',
      actorUid: 'alice',
      actorEmail: 'alice@x.tw',
      targetUid: null,
      detail: { method: 'google.com' },
      device: expect.anything(),
      createdAt: 'SERVER_TIME',
    });
  });

  it('未登入時不寫', async () => {
    fb.auth.currentUser = null;
    await logSelfEvent('logout', {});
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  it('寫入失敗只記 console，不拋錯（不影響原本的操作）', async () => {
    fs.setDoc.mockRejectedValue(new Error('permission-denied'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(logSelfEvent('logout', {})).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('addAdminLogToBatch', () => {
  it('把日誌加進批次，帶上對象 uid', () => {
    const batch = { set: vi.fn() };
    addAdminLogToBatch(batch as never, 'role_change', 'bob', { role: 'admin' });
    expect(batch.set).toHaveBeenCalledWith(
      'new-log-ref',
      expect.objectContaining({ type: 'role_change', actorUid: 'alice', targetUid: 'bob', detail: { role: 'admin' } }),
    );
  });

  it('未登入時拋錯（批次不會被送出）', () => {
    fb.auth.currentUser = null;
    expect(() => addAdminLogToBatch({ set: vi.fn() } as never, 'disabled_change', 'bob', { disabled: true })).toThrow(
      '請先登入',
    );
  });
});

describe('describeDetail / toAuditLog', () => {
  it('detail 轉成給人看的說明', () => {
    expect(describeDetail({ type: 'login', detail: { method: 'github.com' } })).toBe('GitHub');
    expect(describeDetail({ type: 'provider_unlink', detail: { provider: 'password' } })).toBe('Email/密碼');
    expect(describeDetail({ type: 'profile_update', detail: { fields: ['displayName', 'photoURL'] } })).toBe(
      '顯示名稱、頭像',
    );
    expect(describeDetail({ type: 'role_change', detail: { role: 'admin' } })).toBe('改為管理員');
    expect(describeDetail({ type: 'disabled_change', detail: { disabled: false } })).toBe('啟用');
    expect(describeDetail({ type: 'logout', detail: {} })).toBe('');
  });

  it('缺欄位或型別不對時給安全預設值', () => {
    const log = toAuditLog('x', { type: 'weird', actorUid: 5, detail: 'oops' });
    expect(log).toMatchObject({ id: 'x', actorUid: '', actorEmail: null, targetUid: null, detail: {}, device: null });
  });
});
