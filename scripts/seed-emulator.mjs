// 在本地 Firebase Emulator 建立测试账号与 users 文档。
//
// 用法：
//   1. 先启动 Emulator：npm run emulators
//   2. 另开一个终端：node scripts/seed-emulator.mjs
//
// 建立的账号（密码都是 password123）：
//   admin@example.com  → users/{uid}.role = 'admin'
//   user@example.com   → users/{uid}.role = 'user'
//
// 只用 Emulator REST API + Node 内建 fetch（Node 18+），不需要 Admin SDK。
// 重复执行是安全的：账号已存在就改用登录取得 uid，users 文档会被覆盖成初始状态。

const PROJECT_ID = 'demo-claude-flow';
const AUTH_HOST = 'http://127.0.0.1:9099';
const FIRESTORE_HOST = 'http://127.0.0.1:8080';
const API_KEY = 'demo-api-key';
const PASSWORD = 'password123';

const ACCOUNTS = [
  { email: 'admin@example.com', displayName: 'Admin', role: 'admin' },
  { email: 'user@example.com', displayName: 'User', role: 'user' },
];

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** 建立 Auth 账号；已存在就登录取 uid。回传 localId (uid) */
async function ensureAuthUser({ email, displayName }) {
  const base = `${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
  const signUp = await postJson(`${base}/accounts:signUp?key=${API_KEY}`, {
    email,
    password: PASSWORD,
    displayName,
    returnSecureToken: true,
  });
  if (signUp.ok) {
    console.log(`  建立 Auth 账号 ${email}`);
    return signUp.json.localId;
  }
  const message = signUp.json?.error?.message ?? '';
  if (!message.startsWith('EMAIL_EXISTS')) {
    throw new Error(`建立 ${email} 失败（HTTP ${signUp.status}）：${message || JSON.stringify(signUp.json)}`);
  }
  const signIn = await postJson(`${base}/accounts:signInWithPassword?key=${API_KEY}`, {
    email,
    password: PASSWORD,
    returnSecureToken: true,
  });
  if (!signIn.ok) {
    throw new Error(`${email} 已存在但无法用 ${PASSWORD} 登录：${JSON.stringify(signIn.json)}`);
  }
  console.log(`  Auth 账号 ${email} 已存在，沿用`);
  return signIn.json.localId;
}

/** 写入 users/{uid}；Bearer owner 让 Emulator 绕过 Security Rules */
async function writeUserDoc(uid, { email, displayName, role }) {
  const now = new Date().toISOString();
  const fields = {
    uid: { stringValue: uid },
    email: { stringValue: email },
    displayName: { stringValue: displayName },
    photoURL: { nullValue: null },
    role: { stringValue: role },
    disabled: { booleanValue: false },
    providers: { arrayValue: { values: [{ stringValue: 'password' }] } },
    createdAt: { timestampValue: now },
    lastLoginAt: { timestampValue: now },
  };
  const url = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`写入 users/${uid} 失败（HTTP ${res.status}）：${await res.text()}`);
  }
  console.log(`  写入 users/${uid}（role=${role}）`);
}

async function main() {
  console.log(`Seeding Emulator（project ${PROJECT_ID}）…`);
  for (const account of ACCOUNTS) {
    const uid = await ensureAuthUser(account);
    await writeUserDoc(uid, account);
  }
  console.log(`完成。登录密码：${PASSWORD}`);
}

main().catch((err) => {
  if (err?.cause?.code === 'ECONNREFUSED') {
    console.error('连不上 Emulator，请先执行 npm run emulators');
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
