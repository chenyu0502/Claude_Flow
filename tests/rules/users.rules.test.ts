/// <reference types="node" />
// Firestore Security Rules 测试：需要 Firestore Emulator（127.0.0.1:8080）。
// 执行：npm run test:rules
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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-claude-flow';

let testEnv: RulesTestEnvironment;

type Seed = {
  uid: string;
  role?: 'admin' | 'user';
  disabled?: boolean;
  displayName?: string | null;
};

function profileData(s: Seed) {
  return {
    uid: s.uid,
    email: `${s.uid}@example.com`,
    displayName: s.displayName === undefined ? s.uid : s.displayName,
    photoURL: null,
    role: s.role ?? 'user',
    disabled: s.disabled ?? false,
    providers: ['password'],
    createdAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00Z')),
    lastLoginAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00Z')),
  };
}

async function seed(...users: Seed[]) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const u of users) {
      await setDoc(doc(db, 'users', u.uid), profileData(u));
    }
  });
}

/** 本人建档时的合法数据（与 ensureUserProfile 写入的一致） */
function newProfile(uid: string) {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: 'New User',
    photoURL: null,
    role: 'user',
    disabled: false,
    providers: ['google.com'],
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
}

function dbAs(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
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
});

describe('未登录', () => {
  it('不能读、不能 list、不能建立', async () => {
    await seed({ uid: 'alice' });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(setDoc(doc(db, 'users', 'alice2'), newProfile('alice2')));
  });
});

describe('本人建立文档', () => {
  it('合法建立成功', async () => {
    await assertSucceeds(setDoc(doc(dbAs('alice'), 'users', 'alice'), newProfile('alice')));
  });

  it('自封 admin 被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), { ...newProfile('alice'), role: 'admin' }),
    );
  });

  it('disabled=true 被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), { ...newProfile('alice'), disabled: true }),
    );
  });

  it('建立别人 uid 的文档被拒', async () => {
    await assertFails(setDoc(doc(dbAs('alice'), 'users', 'bob'), newProfile('bob')));
  });

  it('uid 字段与文档 ID 不一致被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), { ...newProfile('alice'), uid: 'bob' }),
    );
  });

  it('多余字段被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), { ...newProfile('alice'), isVip: true }),
    );
  });

  it('createdAt 不是 serverTimestamp 被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), {
        ...newProfile('alice'),
        createdAt: Timestamp.fromDate(new Date('2000-01-01T00:00:00Z')),
      }),
    );
  });

  it('displayName 超过 50 字被拒', async () => {
    await assertFails(
      setDoc(doc(dbAs('alice'), 'users', 'alice'), {
        ...newProfile('alice'),
        displayName: 'x'.repeat(51),
      }),
    );
  });
});

describe('本人读取与更新', () => {
  beforeEach(async () => {
    await seed({ uid: 'alice' }, { uid: 'bob' });
  });

  it('可读自己的文档', async () => {
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'users', 'alice')));
  });

  it('不能读别人的文档', async () => {
    await assertFails(getDoc(doc(dbAs('alice'), 'users', 'bob')));
  });

  it('非 admin list 被拒', async () => {
    await assertFails(getDocs(collection(dbAs('alice'), 'users')));
  });

  it('改 displayName 成功', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { displayName: 'Alice' }));
  });

  it('displayName 改成 null 成功', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { displayName: null }));
  });

  it('displayName 超过 50 字被拒', async () => {
    await assertFails(
      updateDoc(doc(dbAs('alice'), 'users', 'alice'), { displayName: 'x'.repeat(51) }),
    );
  });

  it('displayName 非字符串被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { displayName: 123 }));
  });

  it('登录同步 email/providers/lastLoginAt 成功（ensureUserProfile 的写法）', async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs('alice'), 'users', 'alice'), {
        email: 'alice-new@example.com',
        providers: ['password', 'github.com'],
        lastLoginAt: serverTimestamp(),
      }),
    );
  });

  it('lastLoginAt 不是 serverTimestamp 被拒', async () => {
    await assertFails(
      updateDoc(doc(dbAs('alice'), 'users', 'alice'), {
        lastLoginAt: Timestamp.fromDate(new Date('2030-01-01T00:00:00Z')),
      }),
    );
  });

  it('providers 含不支持的值被拒', async () => {
    await assertFails(
      updateDoc(doc(dbAs('alice'), 'users', 'alice'), { providers: ['facebook.com'] }),
    );
  });

  it('改 role 被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { role: 'admin' }));
  });

  it('改 disabled 被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { disabled: true }));
  });

  it('改 uid / createdAt 被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { uid: 'bob' }));
    await assertFails(
      updateDoc(doc(dbAs('alice'), 'users', 'alice'), { createdAt: serverTimestamp() }),
    );
  });

  it('新增多余字段被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'alice'), { isVip: true }));
  });

  it('改别人的文档被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('alice'), 'users', 'bob'), { displayName: 'hacked' }));
  });

  it('删除自己的文档被拒', async () => {
    await assertFails(deleteDoc(doc(dbAs('alice'), 'users', 'alice')));
  });
});

describe('已停用的本人', () => {
  beforeEach(async () => {
    await seed({ uid: 'carol', disabled: true });
  });

  it('仍可读自己的文档', async () => {
    await assertSucceeds(getDoc(doc(dbAs('carol'), 'users', 'carol')));
  });

  it('不能写自己的文档', async () => {
    await assertFails(updateDoc(doc(dbAs('carol'), 'users', 'carol'), { displayName: 'Carol' }));
    await assertFails(
      updateDoc(doc(dbAs('carol'), 'users', 'carol'), { lastLoginAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(dbAs('carol'), 'users', 'carol'), { disabled: false }));
  });
});

describe('admin', () => {
  beforeEach(async () => {
    await seed({ uid: 'admin', role: 'admin' }, { uid: 'alice' }, { uid: 'bob' });
  });

  it('可读任何人的文档', async () => {
    await assertSucceeds(getDoc(doc(dbAs('admin'), 'users', 'alice')));
  });

  it('可 list 全部（含 orderBy createdAt desc）', async () => {
    const db = dbAs('admin');
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'))));
  });

  it('可改他人 role', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { role: 'user' }));
  });

  it('可改他人 disabled', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { disabled: true }));
    await assertSucceeds(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { disabled: false }));
  });

  it('role 非法值被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { role: 'owner' }));
  });

  it('disabled 非 bool 被拒', async () => {
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { disabled: 'yes' }));
  });

  it('不能改自己的 role / disabled', async () => {
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'admin'), { role: 'user' }));
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'admin'), { disabled: true }));
  });

  it('仍可以本人身份改自己的 displayName', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('admin'), 'users', 'admin'), { displayName: 'Boss' }));
  });

  it('不能改他人 displayName / email', async () => {
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { displayName: 'x' }));
    await assertFails(updateDoc(doc(dbAs('admin'), 'users', 'alice'), { email: 'x@example.com' }));
  });

  it('同时改 role 与 displayName 被拒', async () => {
    await assertFails(
      updateDoc(doc(dbAs('admin'), 'users', 'alice'), { role: 'admin', displayName: 'x' }),
    );
  });

  it('不能删除任何文档', async () => {
    await assertFails(deleteDoc(doc(dbAs('admin'), 'users', 'alice')));
    await assertFails(deleteDoc(doc(dbAs('admin'), 'users', 'admin')));
  });

  it('不能替他人建立文档', async () => {
    await assertFails(setDoc(doc(dbAs('admin'), 'users', 'dave'), newProfile('dave')));
  });
});

describe('已停用的 admin', () => {
  beforeEach(async () => {
    await seed({ uid: 'admin', role: 'admin', disabled: true }, { uid: 'alice' });
  });

  it('失去 admin 权限', async () => {
    const db = dbAs('admin');
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { disabled: true }));
  });

  it('仍可读自己的文档', async () => {
    await assertSucceeds(getDoc(doc(dbAs('admin'), 'users', 'admin')));
  });
});

describe('没有 users 文档的登录用户', () => {
  it('不会被当成 admin', async () => {
    await seed({ uid: 'alice' });
    const db = dbAs('ghost');
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('读自己不存在的文档是允许的（ensureUserProfile 的 getDoc）', async () => {
    await assertSucceeds(getDoc(doc(dbAs('ghost'), 'users', 'ghost')));
  });
});

describe('portfolios（台股分析）', () => {
  it('本人可讀寫自己的投資組合', async () => {
    await assertSucceeds(setDoc(doc(dbAs('alice'), 'portfolios', 'alice'), { cash: 1000 }));
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'portfolios', 'alice')));
  });

  it('不能讀寫別人的投資組合（含 admin）', async () => {
    await seed({ uid: 'admin', role: 'admin' });
    await assertFails(getDoc(doc(dbAs('alice'), 'portfolios', 'bob')));
    await assertFails(setDoc(doc(dbAs('alice'), 'portfolios', 'bob'), { cash: 1 }));
    await assertFails(getDoc(doc(dbAs('admin'), 'portfolios', 'alice')));
  });

  it('未登入不能讀寫', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'portfolios', 'alice')));
    await assertFails(setDoc(doc(db, 'portfolios', 'alice'), { cash: 1 }));
  });
});

describe('其他集合', () => {
  it('全部拒绝（含 admin）', async () => {
    await seed({ uid: 'admin', role: 'admin' });
    await assertFails(getDoc(doc(dbAs('admin'), 'posts', 'p1')));
    await assertFails(setDoc(doc(dbAs('admin'), 'posts', 'p1'), { a: 1 }));
    await assertFails(setDoc(doc(dbAs('alice'), 'users', 'alice', 'private', 'x'), { a: 1 }));
  });
});
