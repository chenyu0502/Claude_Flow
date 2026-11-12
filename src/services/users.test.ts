import { beforeEach, describe, expect, it, vi } from 'vitest';

// 攔下 onSnapshot，測試直接餵假的快照進去。
const firestore = vi.hoisted(() => ({
  listener: null as null | ((snap: unknown) => void),
  options: null as unknown,
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'users-col'),
  query: vi.fn(() => 'users-query'),
  orderBy: vi.fn(),
  doc: vi.fn(),
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

import { subscribeAllUsers } from './users';

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
