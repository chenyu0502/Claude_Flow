/**
 * 使用者填的名字與字幕 → 動畫 HTML 的 ?cf= 參數。
 *
 * 動畫裡的 CFX(鍵, 原字) 讀這個 JSON：n1/n2/n3 是三兄妹（大哥、二哥、妹妹），
 * n1u/n2u/n3u 給像素風用（只接受英文，動畫端會轉大寫），end 是結尾字幕，hit 是擊中時的狀聲字。
 * 空字串代表沿用原字，所以這裡只送有填的欄位。
 */
import type { AnimationStyle } from './catalog';

export interface StudioText {
  /** 大哥、二哥、妹妹 */
  names: [string, string, string];
  end: string;
  hit: string;
}

export const DEFAULT_TEXT: StudioText = {
  names: ['Eugene', 'Max', 'Hannah'],
  end: '下雪天，最開心！',
  hit: '啪！',
};

export const LIMITS = { name: 8, end: 12, hit: 4 } as const;

/** 以「字」計算長度（中文、emoji 都算一個） */
export const charLength = (s: string) => [...s].length;

export function validateText(text: StudioText, style: AnimationStyle): string[] {
  const errors: string[] = [];
  if (style.fields.includes('names')) {
    const names = text.names.map((n) => n.trim());
    if (names.some((n) => charLength(n) > LIMITS.name)) errors.push(`名字最多 ${LIMITS.name} 個字`);
    if (style.latinNames && names.some((n) => n && !/^[A-Za-z]+$/.test(n))) {
      errors.push('像素風的字型只有英文字母，名字請用英文（例如 AMY）');
    }
    const filled = names.map((n, i) => n || DEFAULT_TEXT.names[i]);
    if (new Set(filled).size < 3) errors.push('三個名字不能相同');
  }
  if (style.fields.includes('end') && charLength(text.end.trim()) > LIMITS.end) {
    errors.push(`結尾字幕最多 ${LIMITS.end} 個字`);
  }
  if (style.fields.includes('hit') && charLength(text.hit.trim()) > LIMITS.hit) {
    errors.push(`擊中字最多 ${LIMITS.hit} 個字`);
  }
  return errors;
}

/** 只送和預設不同、且這個畫風用得到的欄位 */
export function textToParam(text: StudioText, style: AnimationStyle): Record<string, string> {
  const out: Record<string, string> = {};
  if (style.fields.includes('names')) {
    text.names.forEach((raw, i) => {
      const n = raw.trim();
      if (!n || n === DEFAULT_TEXT.names[i]) return;
      out[style.latinNames ? `n${i + 1}u` : `n${i + 1}`] = n;
    });
  }
  const end = text.end.trim();
  if (style.fields.includes('end') && end && end !== DEFAULT_TEXT.end) out.end = end;
  const hit = text.hit.trim();
  if (style.fields.includes('hit') && hit && hit !== DEFAULT_TEXT.hit) out.hit = hit;
  return out;
}

/** iframe 用的網址：export=1 關掉動畫自己的播放迴圈，由工作室控制每一格 */
export function pieceSrc(base: string, text: StudioText, style: AnimationStyle): string {
  const cf = textToParam(text, style);
  const q = new URLSearchParams({ export: '1' });
  if (Object.keys(cf).length) q.set('cf', JSON.stringify(cf));
  return `${base}?${q.toString()}`;
}

/** 下載檔名：三兄妹打雪仗_Q版小鎮風.mp4（去掉檔名不允許的字元） */
export function fileName(style: AnimationStyle, ext: 'mp4' | 'png', suffix = ''): string {
  const safe = `${style.name}${suffix}`.replace(/[\\/:*?"<>|\s]+/g, '');
  return `三兄妹打雪仗_${safe}.${ext}`;
}
