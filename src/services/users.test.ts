import { beforeEach, describe, expect, it, vi } from 'vitest';

// 攔下 onSnapshot，測試直接餵假的快照進去。
const firestore = vi.hoisted(() => ({
  listener: null as null | ((snap: unknown) => void),
  options: null as unknown,
  batch: { update: vi.fn(), commit: vi.fn() },
}));
const auditLog = vi.hoisted(() => ({ addAdminLogToBatch: vi.fn() }));
vi.mock('./auditLog', () => auditLog);

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'users-col'),
  query: vi.fn(() => 'users-query'),
  orderBy: vi.fn(),
  doc: vi.fn((_db: unknown, col: string, id: string) => `${col}/${id}`),
  writeBatch: vi.fn(() => firestore.batch),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: class {},
  onSnapshot: vi.fn((_q: unknown, options: unknown, next: (snap: unknown) => void) => {
    firestore.options = options;
    firestore.listener = next;
    return vi.fn();
  }),
}));

import { setUserDisabled, setUserRole, subscribeAllUsers } from './users';

/** 假的 QuerySnapshot：fromCache 與文件 uid 清單。 */
function snapshot(fromCache: boolean, uids: string[]) {
  return {
    metadata: { fromCache },
    docs: uids.map((uid) => ({
      id: uid,
      data: () => ({ uid, email: `${uid}@example.com`, role: 'user', disabled: false, providers: [] }),
    })),
  };
}

beforeEach(() => {
  firestore.listener = null;
  firestore.options = null;
});

describe('subscribeAllUsers', () => {
  it('開啟 includeMetadataChanges，伺服器確認「內容與快取相同」時才收得到通知', () => {
    subscribeAllUsers(vi.fn());
    expect(firestore.options).toEqual({ includeMetadataChanges: true });
  });

  it('略過第一份快取快照（只有管理員自己），等伺服器資料到了才交出完整清單', () => {
    const onData = vi.fn();
    subscribeAllUsers(onData);

    firestore.listener!(snapshot(true, ['admin']));
    expect(onData).not.toHaveBeenCalled();

    firestore.listener!(snapshot(false, ['tester', 'admin']));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0].map((u: { uid: string }) => u.uid)).toEqual(['tester', 'admin']);
  });

  it('快取與伺服器內容相同時（只有 metadata 從快取變成伺服器）也會交出第一份資料', () => {
    const onData = vi.fn();
    subscribeAllUsers(onData);
    firestore.listener!(snapshot(true, ['admin']));
    firestore.listener!(snapshot(false, ['admin']));
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('收過伺服器資料之後，快取快照（例如離線時的本機變更）照常交出', () => {
    const onData = vi.fn();
    subscribeAllUsers(onData);
    firestore.listener!(snapshot(false, ['tester', 'admin']));
    firestore.listener!(snapshot(true, ['tester', 'admin']));
    expect(onData).toHaveBeenCalledTimes(2);
  });
});

describe('管理員操作與日誌同一批次寫入', () => {
  beforeEach(() => {
    firestore.batch.update.mockClear();
    firestore.batch.commit.mockReset().mockResolvedValue(undefined);
    auditLog.addAdminLogToBatch.mockClear();
  });

  it('setUserRole：更新角色並加入 role_change 日誌，一起 commit', async () => {
    await setUserRole('bob', 'admin');
    expect(firestore.batch.update).toHaveBeenCalledWith('users/bob', { role: 'admin' });
    expect(auditLog.addAdminLogToBatch).toHaveBeenCalledWith(firestore.batch, 'role_change', 'bob', { role: 'admin' });
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('setUserDisabled：更新狀態並加入 disabled_change 日誌', async () => {
    await setUserDisabled('bob', true);
    expect(firestore.batch.update).toHaveBeenCalledWith('users/bob', { disabled: true });
    expect(auditLog.addAdminLogToBatch).toHaveBeenCalledWith(firestore.batch, 'disabled_change', 'bob', {
      disabled: true,
    });
  });

  it('批次失敗時錯誤往上拋（變更與日誌都不會寫入）', async () => {
    firestore.batch.commit.mockRejectedValue(new Error('permission-denied'));
    await expect(setUserRole('bob', 'user')).rejects.toThrow('permission-denied');
  });
});
