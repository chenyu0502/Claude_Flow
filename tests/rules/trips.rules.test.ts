/// <reference types="node" />
// trips（旅遊規劃的行程）的 Security Rules 測試：需要 Firestore Emulator。
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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const dbAs = (uid: string, token: Record<string, unknown> = {}) =>
  testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, ...token }).firestore() as unknown as Firestore;

/** Email/密碼註冊且尚未驗證信箱的帳號 */
const unverifiedDb = (uid: string) =>
  dbAs(uid, { email_verified: false, firebase: { sign_in_provider: 'password', identities: { email: [`${uid}@example.com`] } } });

async function seedUser(uid: string, disabled = false) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      uid,
      email: `${uid}@example.com`,
      displayName: uid,
      photoURL: null,
      role: 'user',
      disabled,
      providers: ['google.com'],
      createdAt: Timestamp.fromDate(new Date('2024-01-01')),
      lastLoginAt: Timestamp.fromDate(new Date('2024-01-01')),
    });
  });
}

function trip(uid: string, extra: Record<string, unknown> = {}) {
  return {
    ownerUid: uid,
    ownerName: uid,
    title: '京都 5 日',
    json: JSON.stringify({ title: '京都 5 日', dayPlans: [] }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

/** 以規則之外的身分建立 alice 的行程 t1 */
async function seedTrip(id = 't1', uid = 'alice') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'trips', id), {
      ...trip(uid),
      createdAt: Timestamp.fromDate(new Date('2026-01-01')),
      updatedAt: Timestamp.fromDate(new Date('2026-01-01')),
    });
  });
}

const newTripRef = (db: Firestore) => doc(collection(db, 'trips'));

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
  await seedUser('carol', true); // 已停用
});

describe('建立', () => {
  it('登入且未停用的使用者可以建立自己的行程', async () => {
    await assertSucceeds(setDoc(newTripRef(dbAs('alice')), trip('alice')));
  });

  it('不能替別人建立行程', async () => {
    await assertFails(setDoc(newTripRef(dbAs('alice')), trip('bob')));
  });

  it('未登入、已停用、沒有使用者資料、未驗證信箱的帳號都不能建立', async () => {
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(setDoc(newTripRef(anon), trip('alice')));
    await assertFails(setDoc(newTripRef(dbAs('carol')), trip('carol')));
    await assertFails(setDoc(newTripRef(dbAs('nobody')), trip('nobody')));
    await seedUser('dave');
    await assertFails(setDoc(newTripRef(unverifiedDb('dave')), trip('dave')));
  });

  it('時間必須由伺服器決定', async () => {
    const past = Timestamp.fromDate(new Date('2020-01-01'));
    await assertFails(setDoc(newTripRef(dbAs('alice')), trip('alice', { createdAt: past })));
    await assertFails(setDoc(newTripRef(dbAs('alice')), trip('alice', { updatedAt: past })));
  });

  it('欄位必須完整且不能多出其他欄位', async () => {
    const { ownerName: _omit, ...missing } = trip('alice');
    await assertFails(setDoc(newTripRef(dbAs('alice')), missing));
    await assertFails(setDoc(newTripRef(dbAs('alice')), trip('alice', { role: 'admin' })));
  });

  it('標題與內容的型別與長度受限', async () => {
    const db = dbAs('alice');
    await assertFails(setDoc(newTripRef(db), trip('alice', { title: '' })));
    await assertFails(setDoc(newTripRef(db), trip('alice', { title: 'x'.repeat(101) })));
    await assertFails(setDoc(newTripRef(db), trip('alice', { json: '' })));
    await assertFails(setDoc(newTripRef(db), trip('alice', { json: { title: 'x' } })));
    await assertFails(setDoc(newTripRef(db), trip('alice', { json: 'x'.repeat(300001) })));
    await assertSucceeds(setDoc(newTripRef(db), trip('alice', { ownerName: null })));
  });
});

describe('讀取：知道 ID 就能看，但不能瀏覽別人的清單', () => {
  beforeEach(() => seedTrip());

  it('建立者與其他登入使用者都能用 ID 讀取', async () => {
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'trips', 't1')));
    await assertSucceeds(getDoc(doc(dbAs('bob'), 'trips', 't1')));
  });

  it('未登入、已停用、沒有使用者資料的帳號不能讀', async () => {
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anon, 'trips', 't1')));
    await assertFails(getDoc(doc(dbAs('carol'), 'trips', 't1')));
    await assertFails(getDoc(doc(dbAs('nobody'), 'trips', 't1')));
  });

  it('只能列出自己的行程', async () => {
    const mine = query(collection(dbAs('alice'), 'trips'), where('ownerUid', '==', 'alice'));
    await assertSucceeds(getDocs(mine));
    const others = query(collection(dbAs('bob'), 'trips'), where('ownerUid', '==', 'alice'));
    await assertFails(getDocs(others));
    await assertFails(getDocs(collection(dbAs('bob'), 'trips')));
  });
});

describe('修改與刪除：只有建立者', () => {
  beforeEach(() => seedTrip());

  it('建立者可以修改內容與標題', async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs('alice'), 'trips', 't1'), { title: '京都 6 日', json: '{"title":"京都 6 日"}', updatedAt: serverTimestamp() }),
    );
  });

  it('其他人不能修改或刪除', async () => {
    await assertFails(updateDoc(doc(dbAs('bob'), 'trips', 't1'), { title: '改掉', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(dbAs('bob'), 'trips', 't1')));
  });

  it('建立者不能把行程轉給別人，也不能改建立時間', async () => {
    const ref = doc(dbAs('alice'), 'trips', 't1');
    await assertFails(updateDoc(ref, { ownerUid: 'bob', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  it('修改時 updatedAt 必須由伺服器決定', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'trips', 't1'), { title: '京都 6 日' }));
  });

  it('建立者可以刪除', async () => {
    await assertSucceeds(deleteDoc(doc(dbAs('alice'), 'trips', 't1')));
  });

  it('帳號被停用後不能再修改或刪除自己的行程', async () => {
    await seedTrip('t2', 'carol');
    await assertFails(updateDoc(doc(dbAs('carol'), 'trips', 't2'), { title: 'x', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(dbAs('carol'), 'trips', 't2')));
  });
});
