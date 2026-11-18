// 在本地 Firebase Emulator 建立測試帳號與 users 文件。
//
// 用法：
//   1. 先啟動 Emulator：npm run emulators
//   2. 另開一個終端：node scripts/seed-emulator.mjs
//
// 建立的帳號（密碼都是 password123）：
//   admin@example.com  → users/{uid}.role = 'admin'
//   user@example.com   → users/{uid}.role = 'user'
//
// 只用 Emulator REST API + Node 內建 fetch（Node 18+），不需要 Admin SDK。
// 重複執行是安全的：帳號已存在就改用登入取得 uid，users 文件會被覆蓋成初始狀態。

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

/** 建立 Auth 帳號；已存在就登入取 uid。回傳 localId (uid) */
async function ensureAuthUser({ email, displayName }) {
  const base = `${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
  const signUp = await postJson(`${base}/accounts:signUp?key=${API_KEY}`, {
    email,
    password: PASSWORD,
    displayName,
    returnSecureToken: true,
  });
  if (signUp.ok) {
    console.log(`  建立 Auth 帳號 ${email}`);
    return signUp.json.localId;
  }
  const message = signUp.json?.error?.message ?? '';
  if (!message.startsWith('EMAIL_EXISTS')) {
    throw new Error(`建立 ${email} 失敗（HTTP ${signUp.status}）：${message || JSON.stringify(signUp.json)}`);
  }
  const signIn = await postJson(`${base}/accounts:signInWithPassword?key=${API_KEY}`, {
    email,
    password: PASSWORD,
    returnSecureToken: true,
  });
  if (!signIn.ok) {
    throw new Error(`${email} 已存在但無法用 ${PASSWORD} 登入：${JSON.stringify(signIn.json)}`);
  }
  console.log(`  Auth 帳號 ${email} 已存在，沿用`);
  return signIn.json.localId;
}

/**
 * 把帳號標成已驗證 Email。測試帳號是 Email/密碼帳號，沒驗證的話會被擋在驗證提示頁
 * （見 src/auth/emailVerification.ts）。Bearer owner 讓 Emulator 以管理者身分更新。
 */
async function markEmailVerified(uid, email) {
  const url = `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
  const res = await postJson(url, { localId: uid, emailVerified: true }, { Authorization: 'Bearer owner' });
  if (!res.ok) throw new Error(`標記 ${email} 為已驗證失敗：${JSON.stringify(res.json)}`);
}

/** 寫入 users/{uid}；Bearer owner 讓 Emulator 繞過 Security Rules */
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
    throw new Error(`寫入 users/${uid} 失敗（HTTP ${res.status}）：${await res.text()}`);
  }
  console.log(`  寫入 users/${uid}（role=${role}）`);
}

async function main() {
  console.log(`Seeding Emulator（project ${PROJECT_ID}）…`);
  for (const account of ACCOUNTS) {
    const uid = await ensureAuthUser(account);
    await markEmailVerified(uid, account.email);
    await writeUserDoc(uid, account);
  }
  console.log(`完成。登入密碼：${PASSWORD}`);
}

main().catch((err) => {
  if (err?.cause?.code === 'ECONNREFUSED') {
    console.error('連不上 Emulator，請先執行 npm run emulators');
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
