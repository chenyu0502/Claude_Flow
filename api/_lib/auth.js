/**
 * API 的登入驗證：只有 Claude Flow 的管理員能呼叫 /api/*。
 *
 * 做法是拿使用者自己的 Firebase ID token 去讀 Firestore 的 users/{uid}：
 * - token 是偽造的、過期的、或不屬於這個 uid，Firestore 會直接拒絕（401/403），
 *   簽章由 Google 驗證，這裡不必自己驗 JWT，也不需要額外套件；
 * - 不需要 service account 金鑰，Vercel 上不必多放一份機密；
 * - 讀到的文件就是 Claude Flow 的使用者資料，順便確認 role 與 disabled。
 *
 * 這依賴 Firestore 規則「本人可讀自己的 users 文件」（見 firestore.rules）。
 */

/** 驗證通過的結果快取多久。被降級或停用的管理員最多再用這麼久。 */
const CACHE_TTL_MS = 60 * 1000;
/** 快取上限，超過就整個清掉；正常只有一兩位管理員，不需要更精緻的淘汰策略。 */
const CACHE_MAX_ENTRIES = 200;

/** @type {Map<string, { uid: string, expiresAt: number }>} token → 驗證通過的結果 */
const cache = new Map();

/** 測試用：清空快取。 */
export function clearAuthCache() {
  cache.clear();
}

/**
 * @typedef {{ ok: true, uid: string } | { ok: false, status: number, error: string }} AuthResult
 */

/** @returns {AuthResult} */
function fail(status, error) {
  return { ok: false, status, error };
}

/**
 * 解出 JWT 的 payload（不驗簽章，只用來取 uid 與到期時間；真正的驗證交給 Firestore）。
 * @param {string} token
 * @returns {object|null}
 */
function decodePayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 確認請求來自未停用的管理員。
 *
 * @param {string|undefined} authorization 請求的 Authorization 標頭
 * @param {Record<string, string|undefined>} env 環境變數
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<AuthResult>}
 */
export async function verifyAdmin(authorization, env, fetchImpl = fetch) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match) return fail(401, '請先登入');
  const token = match[1];

  const now = Date.now();
  const cached = cache.get(token);
  if (cached && cached.expiresAt > now) return { ok: true, uid: cached.uid };
  if (cached) cache.delete(token);

  const payload = decodePayload(token);
  const uid = payload?.user_id ?? payload?.sub;
  if (typeof uid !== 'string' || !uid) return fail(401, '登入憑證格式不正確');

  const expiresAtMs = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  if (expiresAtMs <= now) return fail(401, '登入已過期，請重新整理頁面');

  const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return fail(500, '伺服器未設定 Firebase 專案（VITE_FIREBASE_PROJECT_ID）');

  // 開發模式連本機 Emulator。正式環境若誤設成 true，127.0.0.1 上沒有 Emulator，
  // 請求會失敗並回 503——失敗時拒絕，不會變成放行。
  const host =
    env.VITE_USE_EMULATOR === 'true' ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
  const url = `${host}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;

  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return fail(503, '暫時無法驗證登入狀態，請稍後再試');
  }

  if (res.status === 401) return fail(401, '登入憑證無效，請重新登入');
  if (res.status === 403 || res.status === 404) return fail(403, '台股分析只開放給管理員使用');
  if (!res.ok) return fail(503, '暫時無法驗證登入狀態，請稍後再試');

  let doc;
  try {
    doc = await res.json();
  } catch {
    return fail(503, '暫時無法驗證登入狀態，請稍後再試');
  }

  const role = doc?.fields?.role?.stringValue;
  const disabled = doc?.fields?.disabled?.booleanValue;
  if (role !== 'admin' || disabled !== false) return fail(403, '台股分析只開放給管理員使用');

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(token, { uid, expiresAt: Math.min(now + CACHE_TTL_MS, expiresAtMs) });
  return { ok: true, uid };
}
