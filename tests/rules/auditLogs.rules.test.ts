/// <reference types="node" />
// auditLogs（登入紀錄與操作日誌）的 Security Rules 測試：需要 Firestore Emulator。
// 執行：npm run test:rules
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

/** 登入憑證帶 email，與 actorEmail 比對 */
const dbAs = (uid: string) =>
  testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore() as unknown as Firestore;

async function seedUser(uid: string, role: 'admin' | 'user' = 'user', disabled = false) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      uid,
      email: `${uid}@example.com`,
      displayName: uid,
      photoURL: null,
      role,
      disabled,
      providers: ['google.com'],
      createdAt: Timestamp.fromDate(new Date('2024-01-01')),
      lastLoginAt: Timestamp.fromDate(new Date('2024-01-01')),
    });
  });
}

function log(uid: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'login',
    actorUid: uid,
    actorEmail: `${uid}@example.com`,
    targetUid: null,
    detail: { method: 'google.com' },
    device: 'Chrome · Windows',
    createdAt: serverTimestamp(),
    ...extra,
  };
}

const newLogRef = (db: Firestore) => doc(collection(db, 'auditLogs'));

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-claude-flow',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
afterAll(async () => {
  await testEnv?.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedUser('alice');
  await seedUser('bob');
  await seedUser('admin', 'admin');
});

describe('自己的事件', () => {
  it('登入、註冊、登出、改密碼、驗證信箱、綁定、個人資料都能記錄', async () => {
    const db = dbAs('alice');
    const cases = [
      { type: 'login', detail: { method: 'password' } },
      { type: 'register', detail: { method: 'password' } },
      { type: 'logout', detail: {} },
      { type: 'password_change', detail: {} },
      { type: 'email_verified', detail: {} },
      { type: 'provider_link', detail: { provider: 'github.com' } },
      { type: 'provider_unlink', detail: { provider: 'google.com' } },
      { type: 'profile_update', detail: { fields: ['displayName'] } },
    ];
    for (const c of cases) await assertSucceeds(setDoc(newLogRef(db), log('alice', c)));
  });

  it('device 可以是 null', async () => {
    await assertSucceeds(setDoc(newLogRef(dbAs('alice')), log('alice', { device: null })));
  });

  it('未登入不能寫', async () => {
    const db = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(setDoc(newLogRef(db), log('alice')));
  });

  it('不能冒用別人的身分或 email', async () => {
    const db = dbAs('alice');
    await assertFails(setDoc(newLogRef(db), log('bob')));
    await assertFails(setDoc(newLogRef(db), log('alice', { actorEmail: 'bob@example.com' })));
  });

  it('時間必須由伺服器決定', async () => {
    const past = Timestamp.fromDate(new Date('2020-01-01'));
    await assertFails(setDoc(newLogRef(dbAs('alice')), log('alice', { createdAt: past })));
  });

  it('不認得的事件類型、多餘欄位、不合法的 detail 都拒絕', async () => {
    const db = dbAs('alice');
    await assertFails(setDoc(newLogRef(db), log('alice', { type: 'hack' })));
    await assertFails(setDoc(newLogRef(db), log('alice', { extra: 1 })));
    await assertFails(setDoc(newLogRef(db), log('alice', { detail: { method: 'facebook.com' } })));
    await assertFails(setDoc(newLogRef(db), log('alice', { detail: { method: 'google.com', note: 'x' } })));
    await assertFails(setDoc(newLogRef(db), log('alice', { type: 'logout', detail: { x: 1 } })));
    await assertFails(
      setDoc(newLogRef(db), log('alice', { type: 'profile_update', detail: { fields: ['role'] } })),
    );
    await assertFails(setDoc(newLogRef(db), log('alice', { device: 'x'.repeat(101) })));
  });

  it('自己的事件不能指定 targetUid', async () => {
    await assertFails(setDoc(newLogRef(dbAs('alice')), log('alice', { targetUid: 'bob' })));
  });

  it('寫入後不能修改、不能刪除（管理員也不行）', async () => {
    const ref = newLogRef(dbAs('alice'));
    await assertSucceeds(setDoc(ref, log('alice')));
    await assertFails(updateDoc(ref, { type: 'logout' }));
    await assertFails(deleteDoc(ref));
    await assertFails(deleteDoc(doc(dbAs('admin'), 'auditLogs', ref.id)));
  });
});

describe('讀取', () => {
  it('一般使用者只能讀自己的紀錄，查詢必須限定 actorUid', async () => {
    const aliceRef = newLogRef(dbAs('alice'));
    const bobRef = newLogRef(dbAs('bob'));
    await setDoc(aliceRef, log('alice'));
    await setDoc(bobRef, log('bob'));

    await assertSucceeds(getDoc(doc(dbAs('alice'), 'auditLogs', aliceRef.id)));
    await assertFails(getDoc(doc(dbAs('alice'), 'auditLogs', bobRef.id)));
    const db = dbAs('alice');
    await assertSucceeds(
      getDocs(query(collection(db, 'auditLogs'), where('actorUid', '==', 'alice'), orderBy('createdAt', 'desc'), limit(10))),
    );
    await assertFails(getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'))));
  });

  it('管理員可以讀全部', async () => {
    await setDoc(newLogRef(dbAs('alice')), log('alice'));
    await assertSucceeds(getDocs(query(collection(dbAs('admin'), 'auditLogs'), orderBy('createdAt', 'desc'))));
  });

  it('被停用的管理員不能讀全部', async () => {
    await seedUser('admin', 'admin', true);
    await assertFails(getDocs(query(collection(dbAs('admin'), 'auditLogs'), orderBy('createdAt', 'desc'))));
  });
});

describe('管理員操作', () => {
  const adminLog = (type: string, detail: Record<string, unknown>, targetUid = 'alice') =>
    log('admin', { type, detail, targetUid });

  it('調整角色：和實際變更寫在同一批次 → 成功', async () => {
    const db = dbAs('admin');
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', 'alice'), { role: 'admin' });
    batch.set(newLogRef(db), adminLog('role_change', { role: 'admin' }));
    await assertSucceeds(batch.commit());
  });

  it('停用帳號：和實際變更寫在同一批次 → 成功', async () => {
    const db = dbAs('admin');
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', 'alice'), { disabled: true });
    batch.set(newLogRef(db), adminLog('disabled_change', { disabled: true }));
    await assertSucceeds(batch.commit());
  });

  it('沒有實際變更就不能記（憑空捏造）', async () => {
    const db = dbAs('admin');
    await assertFails(setDoc(newLogRef(db), adminLog('role_change', { role: 'admin' })));
    // 記錄的值與實際寫入的值不同
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', 'alice'), { disabled: true });
    batch.set(newLogRef(db), adminLog('disabled_change', { disabled: false }));
    await assertFails(batch.commit());
  });

  it('角色沒變（本來就是 user）不能記成調整', async () => {
    const db = dbAs('admin');
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', 'alice'), { disabled: false });
    batch.set(newLogRef(db), adminLog('role_change', { role: 'user' }));
    await assertFails(batch.commit());
  });

  it('一般使用者不能寫管理員操作', async () => {
    const db = dbAs('bob');
    await assertFails(setDoc(newLogRef(db), log('bob', { type: 'role_change', detail: { role: 'admin' }, targetUid: 'alice' })));
  });

  it('管理員不能把自己當對象', async () => {
    const db = dbAs('admin');
    await assertFails(setDoc(newLogRef(db), adminLog('role_change', { role: 'user' }, 'admin')));
  });
});
