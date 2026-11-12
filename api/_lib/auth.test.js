// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthCache, verifyAdmin } from './auth.js';

const ENV = { VITE_FIREBASE_PROJECT_ID: 'demo-proj' };

/** 產生一個（未簽章的）測試用 JWT。真正的簽章驗證由 Firestore 負責，這裡只需要 payload。 */
function makeToken(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const validToken = (uid = 'alice') => makeToken({ user_id: uid, sub: uid, exp: future() });

/** 模擬 Firestore REST 的 users/{uid} 回應。 */
function firestoreReturns(status, fields) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ fields }),
  }));
}

const adminFields = { role: { stringValue: 'admin' }, disabled: { booleanValue: false } };

beforeEach(() => {
  clearAuthCache();
});

describe('verifyAdmin', () => {
  it('沒有 Authorization 標頭 → 401，不打 Firestore', async () => {
    const f = firestoreReturns(200, adminFields);
    expect(await verifyAdmin(undefined, ENV, f)).toEqual({ ok: false, status: 401, error: '請先登入' });
    expect(await verifyAdmin('Basic abc', ENV, f)).toMatchObject({ ok: false, status: 401 });
    expect(f).not.toHaveBeenCalled();
  });

  it('token 格式錯誤 → 401', async () => {
    const f = firestoreReturns(200, adminFields);
    expect(await verifyAdmin('Bearer not-a-jwt', ENV, f)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyAdmin(`Bearer ${makeToken({ exp: future() })}`, ENV, f)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('token 已過期 → 401，不打 Firestore', async () => {
    const f = firestoreReturns(200, adminFields);
    const expired = makeToken({ user_id: 'alice', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await verifyAdmin(`Bearer ${expired}`, ENV, f)).toMatchObject({ ok: false, status: 401 });
    expect(f).not.toHaveBeenCalled();
  });

  it('未設定專案 ID → 500', async () => {
    const f = firestoreReturns(200, adminFields);
    expect(await verifyAdmin(`Bearer ${validToken()}`, {}, f)).toMatchObject({ ok: false, status: 500 });
  });

  it('管理員 → 通過，並用使用者自己的 token 讀 users/{uid}', async () => {
    const f = firestoreReturns(200, adminFields);
    const token = validToken('alice');
    expect(await verifyAdmin(`Bearer ${token}`, ENV, f)).toEqual({ ok: true, uid: 'alice' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(
      'https://firestore.googleapis.com/v1/projects/demo-proj/databases/(default)/documents/users/alice',
    );
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('VITE_USE_EMULATOR=true 時改連本機 Emulator', async () => {
    const f = firestoreReturns(200, adminFields);
    await verifyAdmin(`Bearer ${validToken()}`, { ...ENV, VITE_USE_EMULATOR: 'true' }, f);
    expect(f.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-proj\//);
  });

  it('一般使用者 → 403', async () => {
    const f = firestoreReturns(200, { role: { stringValue: 'user' }, disabled: { booleanValue: false } });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, f)).toMatchObject({ ok: false, status: 403 });
  });

  it('已停用的管理員 → 403', async () => {
    const f = firestoreReturns(200, { role: { stringValue: 'admin' }, disabled: { booleanValue: true } });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, f)).toMatchObject({ ok: false, status: 403 });
  });

  it('缺 disabled 欄位的管理員 → 403（與 Security Rules 的 isAdmin 一致）', async () => {
    const f = firestoreReturns(200, { role: { stringValue: 'admin' } });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, f)).toMatchObject({ ok: false, status: 403 });
  });

  it('Firestore 拒絕 token（偽造或不屬於此 uid）→ 401 / 403', async () => {
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, firestoreReturns(401))).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, firestoreReturns(403))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('沒有 users 文件 → 403', async () => {
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, firestoreReturns(404))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('Firestore 連不上或出錯 → 503（拒絕，不放行）', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, down)).toMatchObject({ ok: false, status: 503 });
    expect(await verifyAdmin(`Bearer ${validToken()}`, ENV, firestoreReturns(500))).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('驗證通過的結果會快取，同一個 token 不再重打 Firestore', async () => {
    const f = firestoreReturns(200, adminFields);
    const header = `Bearer ${validToken()}`;
    await verifyAdmin(header, ENV, f);
    await verifyAdmin(header, ENV, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('被拒絕的結果不快取', async () => {
    const f = firestoreReturns(200, { role: { stringValue: 'user' }, disabled: { booleanValue: false } });
    const header = `Bearer ${validToken()}`;
    await verifyAdmin(header, ENV, f);
    await verifyAdmin(header, ENV, f);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
