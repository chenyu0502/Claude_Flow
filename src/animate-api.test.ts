import { describe, expect, it, vi } from 'vitest';
import { createAnimateBridge, writeScript } from './animate-api';

const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('writeScript', () => {
  it('帶登入憑證與使用者金鑰呼叫 /api/animate/script', async () => {
    const f = ok({ available: true, script: { title: 't' } });
    const r = await writeScript(async () => 'tok', '貓咪', { duration: 8, geminiKey: 'AIzaKEY' }, f as unknown as typeof fetch);
    expect(r.available).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/animate/script');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Gemini-Key': 'AIzaKEY' });
    expect(JSON.parse(init.body)).toEqual({ prompt: '貓咪', duration: 8 });
  });
  it('沒有金鑰時不帶 X-Gemini-Key', async () => {
    const f = ok({ available: false, reason: 'x' });
    await writeScript(async () => 'tok', '貓', {}, f as unknown as typeof fetch);
    expect(f.mock.calls[0][1].headers['X-Gemini-Key']).toBeUndefined();
  });
  it('拿不到登入憑證、連不上、HTTP 錯誤都回 available: false 與說明', async () => {
    expect((await writeScript(async () => { throw new Error(); }, '貓')).reason).toMatch(/登入/);
    const down = vi.fn().mockRejectedValue(new Error('net'));
    expect((await writeScript(async () => 't', '貓', {}, down as unknown as typeof fetch)).reason).toMatch(/連不上/);
    const bad = ok({ error: '請描述你想看的故事' }, 400);
    expect((await writeScript(async () => 't', '', {}, bad as unknown as typeof fetch)).reason).toBe('請描述你想看的故事');
  });
  it('createAnimateBridge 帶出 uid', () => {
    expect(createAnimateBridge('u1', async () => 't').uid).toBe('u1');
  });
});
