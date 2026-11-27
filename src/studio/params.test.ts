import { findStyle } from './catalog';
import { DEFAULT_TEXT, fileName, pieceSrc, textToParam, validateText, type StudioText } from './params';

const text = (over: Partial<StudioText>): StudioText => ({ ...DEFAULT_TEXT, ...over });

describe('textToParam', () => {
  it('預設文字不送任何參數', () => {
    expect(textToParam(DEFAULT_TEXT, findStyle('rpg'))).toEqual({});
  });

  it('只送這個畫風用得到的欄位', () => {
    const t = text({ names: ['阿哲', 'Max', '小涵'], end: '好冷！', hit: '咚！' });
    // 機甲作戰只有結尾字幕
    expect(textToParam(t, findStyle('mecha'))).toEqual({ end: '好冷！' });
    // RPG 有名字與結尾，沒有擊中字；沒改的名字不送
    expect(textToParam(t, findStyle('rpg'))).toEqual({ n1: '阿哲', n3: '小涵', end: '好冷！' });
    expect(textToParam(t, findStyle('cozy'))).toEqual({ end: '好冷！', hit: '咚！' });
  });

  it('像素風的名字用 n1u 等鍵', () => {
    expect(textToParam(text({ names: ['amy', 'Max', 'Hannah'] }), findStyle('pixel'))).toEqual({ n1u: 'amy' });
  });

  it('前後空白不算', () => {
    expect(textToParam(text({ end: '  下雪天，最開心！ ' }), findStyle('cozy'))).toEqual({});
  });
});

describe('validateText', () => {
  it('預設文字沒有錯誤', () => {
    expect(validateText(DEFAULT_TEXT, findStyle('rpg'))).toEqual([]);
  });

  it('擋下太長的字幕與重複的名字', () => {
    const errs = validateText(text({ names: ['Max', 'Max', 'Hannah'], end: '一二三四五六七八九十十一十二十三' }), findStyle('ocean'));
    expect(errs).toContain('三個名字不能相同');
    expect(errs.some((e) => e.startsWith('結尾字幕最多'))).toBe(true);
  });

  it('沒有名字的畫風不檢查名字', () => {
    expect(validateText(text({ names: ['A', 'A', 'A'] }), findStyle('mecha'))).toEqual([]);
  });

  it('像素風只接受英文名字', () => {
    expect(validateText(text({ names: ['阿哲', 'Max', 'Hannah'] }), findStyle('pixel'))).toHaveLength(1);
  });

  it('emoji 算一個字', () => {
    expect(validateText(text({ hit: '💥💥💥💥' }), findStyle('cozy'))).toEqual([]);
  });
});

describe('pieceSrc / fileName', () => {
  it('網址帶 export=1，有改文字才帶 cf', () => {
    const style = findStyle('cozy');
    expect(pieceSrc('/animations/cozy.html', DEFAULT_TEXT, style)).toBe('/animations/cozy.html?export=1');
    const url = new URL(pieceSrc('/animations/cozy.html', text({ hit: '咚！' }), style), 'http://x');
    expect(JSON.parse(url.searchParams.get('cf')!)).toEqual({ hit: '咚！' });
  });

  it('檔名去掉空白與不允許的字元', () => {
    expect(fileName(findStyle('rpg'), 'mp4')).toBe('三兄妹打雪仗_RPG戰鬥風.mp4');
    expect(fileName(findStyle('cozy'), 'png', '_2.5秒')).toBe('三兄妹打雪仗_Q版小鎮風_2.5秒.png');
  });

  it('找不到的畫風退回預設', () => {
    expect(findStyle('nope').id).toBe('cozy');
  });
});
