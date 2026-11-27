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

/** 一句要配音的台詞 */
export interface VoiceLine {
  text: string;
  /** 說話的角色名字（同一個角色用同一個聲音） */
  speaker: string;
  /** boy、girl、man、woman、old-man、old-woman、cat、dog */
  voice: string;
}

export interface VoiceClip {
  sampleRate: number;
  /** 16 位元單聲道 PCM（little-endian），base64 */
  pcm: string;
}

export interface AnimateVoiceResult {
  available: boolean;
  /** 和輸入的台詞一一對應 */
  clips?: VoiceClip[];
  model?: string;
  reason?: string;
}

export interface AnimateBridge {
  uid: string;
  writeScript(prompt: string, opts?: WriteScriptOptions): Promise<AnimateScriptResult>;
  /** 整部動畫的台詞一次配音（/api/animate/voice）；失敗時 available: false，網頁端改用瀏覽器內建語音 */
  speak(lines: VoiceLine[], opts?: { mood?: string; geminiKey?: string }): Promise<AnimateVoiceResult>;
}

/** 呼叫動畫製作的 API：帶登入憑證與使用者金鑰，所有錯誤都轉成 available: false 與說明 */
async function callApi<T extends { available: boolean; reason?: string }>(
  path: string,
  payload: unknown,
  getIdToken: () => Promise<string>,
  geminiKey: string | undefined,
  failLabel: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  let token: string;
  try {
    token = await getIdToken();
  } catch {
    return { available: false, reason: '無法取得登入狀態，請重新整理頁面後再試。' } as T;
  }
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(geminiKey ? { 'X-Gemini-Key': geminiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { available: false, reason: '連不上伺服器，請確認網路後再試。' } as T;
  }
  let body: Partial<T> & { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 回應（例如逾時的 504） */
  }
  if (!res.ok) return { available: false, reason: body.error || `${failLabel}（HTTP ${res.status}），請稍後再試。` } as T;
  return { ...body, available: !!body.available } as T;
}

export function writeScript(
  getIdToken: () => Promise<string>,
  prompt: string,
  opts: WriteScriptOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AnimateScriptResult> {
  return callApi<AnimateScriptResult>('/api/animate/script', { prompt, duration: opts.duration }, getIdToken, opts.geminiKey, '生成失敗', fetchImpl);
}

export function speak(
  getIdToken: () => Promise<string>,
  lines: VoiceLine[],
  opts: { mood?: string; geminiKey?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AnimateVoiceResult> {
  return callApi<AnimateVoiceResult>('/api/animate/voice', { lines, mood: opts.mood }, getIdToken, opts.geminiKey, '配音失敗', fetchImpl);
}

export function createAnimateBridge(uid: string, getIdToken: () => Promise<string>): AnimateBridge {
  return {
    uid,
    writeScript: (prompt, opts) => writeScript(getIdToken, prompt, opts),
    speak: (lines, opts) => speak(getIdToken, lines, opts),
  };
}
