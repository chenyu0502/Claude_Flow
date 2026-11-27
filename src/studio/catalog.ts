/**
 * 動畫工作室的畫風清單。
 *
 * 每個畫風對應 public/animations/<id>.html（由 scripts/import-animations.mjs 從 Claude_Animate 匯入）。
 * fields 是該畫風畫面上真的會出現、可以替換的文字；匯入腳本執行時會印出實際找到的欄位，兩邊要一致。
 */
export type TextField = 'names' | 'end' | 'hit';

export type StyleGroup = 'craft' | 'anime' | 'retro';

export interface AnimationStyle {
  id: string;
  name: string;
  group: StyleGroup;
  blurb: string;
  /** names：三兄妹的名字；end：結尾字幕；hit：大雪球砸下時的狀聲字 */
  fields: TextField[];
  /** 名字只能用英文（像素字型只有大寫英文字母） */
  latinNames?: boolean;
}

export const GROUPS: { id: StyleGroup | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'craft', label: '手作質感' },
  { id: 'anime', label: '動漫' },
  { id: 'retro', label: '復古・幾何' },
];

export const STYLES: AnimationStyle[] = [
  { id: 'papercut', name: '剪紙風', group: 'craft', blurb: '色紙剪貼，紙張纖維與陰影', fields: ['end', 'hit'] },
  { id: 'riso', name: 'Riso 印刷風', group: 'craft', blurb: '雙色孔版印刷，網點與套色偏移', fields: ['end', 'hit'] },
  { id: 'sketch', name: '素描本風', group: 'craft', blurb: '鉛筆線稿加淡彩', fields: ['end', 'hit'] },
  { id: 'ink', name: '墨水插畫風', group: 'craft', blurb: '鋼筆排線與水彩', fields: ['end', 'hit'] },
  { id: 'pastoral', name: '手繪田園風', group: 'craft', blurb: '溫暖水彩背景、田園小屋', fields: ['end', 'hit'] },
  { id: 'cozy', name: 'Q 版小鎮風', group: 'anime', blurb: '圓潤玩具感、暖色光暈', fields: ['end', 'hit'] },
  { id: 'anime', name: '動畫冒險風', group: 'anime', blurb: '賽璐璐上色、小雪精靈', fields: ['end', 'hit'] },
  { id: 'wafu', name: '和風劍戟風', group: 'anime', blurb: '和服花紋、浪花招式、直書字幕', fields: ['end', 'hit'] },
  { id: 'ocean', name: '海洋冒險風', group: 'anime', blurb: '熱血漫畫、港口與海盜船', fields: ['end', 'names'] },
  { id: 'mecha', name: '機甲作戰風', group: 'anime', blurb: '90 年代作戰畫面、HUD 鎖定框', fields: ['end'] },
  { id: 'epic', name: '黑暗奇幻史詩風', group: 'anime', blurb: '低飽和、厚重線條、旁白字幕', fields: ['end'] },
  { id: 'rpg', name: 'RPG 戰鬥風', group: 'anime', blurb: '回合制戰鬥介面、魔法與傷害數字', fields: ['end', 'names'] },
  { id: 'pixel', name: '像素風', group: 'retro', blurb: '16 位元遊戲機畫面與計分板', fields: ['names'], latinNames: true },
  { id: 'iso', name: '等角線稿風', group: 'retro', blurb: '等角透視的細線插畫', fields: ['end', 'hit'] },
  { id: 'math', name: '數學動畫風', group: 'retro', blurb: '黑底幾何、拋物線與公式', fields: ['end', 'names'] },
];

export const DEFAULT_STYLE_ID = 'cozy';

export function findStyle(id: string | null | undefined): AnimationStyle {
  return STYLES.find((s) => s.id === id) ?? STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!;
}

export const pieceUrl = (id: string) => `/animations/${id}.html`;
export const thumbUrl = (id: string) => `/animations/thumbs/${id}.jpg`;
