/**
 * 動畫製作（/animate/）與 Claude Flow 之間的介面。
 *
 * 動畫製作本身不載入 Firebase；animate-gate.ts 通過登入檢查後，把這裡建立的 AnimateBridge
 * 以 window.ClaudeFlowAnimate 提供給它。劇本由 /api/animate/script 請 Gemini 生成。
 */
export interface AnimateScriptResult {
  available: boolean;
  /** 動畫劇本（格式見 animation-studio 的 js/engine/script.js），網頁端會再檢查一次 */
  script?: Record<string, unknown>;
  /** AI 說明替換了哪些引擎沒有的東西 */
  note?: string;
  model?: string;
  reason?: string;
}

export interface WriteScriptOptions {
  /** 8、12 或 16 秒 */
  duration?: number;
  /** 使用者自己的 Gemini 金鑰（只放在請求標頭 X-Gemini-Key，後端優先使用） */
  geminiKey?: string;
}

export interface AnimateBridge {
  uid: string;
  writeScript(prompt: string, opts?: WriteScriptOptions): Promise<AnimateScriptResult>;
}

export async function writeScript(
  getIdToken: () => Promise<string>,
  prompt: string,
  opts: WriteScriptOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AnimateScriptResult> {
  let token: string;
  try {
    token = await getIdToken();
  } catch {
    return { available: false, reason: '無法取得登入狀態，請重新整理頁面後再試。' };
  }
  let res: Response;
  try {
    res = await fetchImpl('/api/animate/script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.geminiKey ? { 'X-Gemini-Key': opts.geminiKey } : {}),
      },
      body: JSON.stringify({ prompt, duration: opts.duration }),
    });
  } catch {
    return { available: false, reason: '連不上伺服器，請確認網路後再試。' };
  }
  let body: Partial<AnimateScriptResult> & { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 回應（例如逾時的 504） */
  }
  if (!res.ok) return { available: false, reason: body.error || `生成失敗（HTTP ${res.status}），請稍後再試。` };
  return { ...body, available: !!body.available };
}

export function createAnimateBridge(uid: string, getIdToken: () => Promise<string>): AnimateBridge {
  return { uid, writeScript: (prompt, opts) => writeScript(getIdToken, prompt, opts) };
}
