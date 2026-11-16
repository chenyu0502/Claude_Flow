/**
 * 介面風格：溫暖質感（預設）與現代簡約。
 *
 * 風格以 <html data-style="..."> 表示，樣式只覆寫 CSS 變數（見 styles.css 的現代簡約段落）。
 * 選擇記在這台瀏覽器的 localStorage；index.html 開頭有一段同樣邏輯的內嵌腳本，
 * 在畫面渲染前先套用，避免重新整理時先閃一下預設風格。兩邊的 KEY 與合法值必須一致。
 */
import { useCallback, useState } from 'react';

export type UiStyle = 'warm' | 'modern';

export const UI_STYLES: { id: UiStyle; label: string }[] = [
  { id: 'warm', label: '溫暖質感' },
  { id: 'modern', label: '現代簡約' },
];

export const DEFAULT_UI_STYLE: UiStyle = 'warm';
export const UI_STYLE_STORAGE_KEY = 'cf-ui-style';

function isUiStyle(v: unknown): v is UiStyle {
  return v === 'warm' || v === 'modern';
}

/** 讀取已儲存的風格；沒有、不合法或 localStorage 無法使用時回傳預設值。 */
export function readStoredUiStyle(): UiStyle {
  try {
    const v = localStorage.getItem(UI_STYLE_STORAGE_KEY);
    return isUiStyle(v) ? v : DEFAULT_UI_STYLE;
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

/** 目前套用在頁面上的風格 */
export function currentUiStyle(): UiStyle {
  const v = document.documentElement.dataset.style;
  return isUiStyle(v) ? v : DEFAULT_UI_STYLE;
}

/** 套用並記住風格。localStorage 寫入失敗（無痕模式等）時仍會套用到當下頁面。 */
export function applyUiStyle(style: UiStyle) {
  document.documentElement.dataset.style = style;
  try {
    localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
  } catch {
    /* 無法記住也不影響當下切換 */
  }
}

export function nextUiStyle(style: UiStyle): UiStyle {
  const i = UI_STYLES.findIndex((s) => s.id === style);
  return UI_STYLES[(i + 1) % UI_STYLES.length].id;
}

export function uiStyleLabel(style: UiStyle): string {
  return UI_STYLES.find((s) => s.id === style)?.label ?? style;
}

/** React 用：目前風格與切換函式 */
export function useUiStyle(): [UiStyle, (style: UiStyle) => void] {
  const [style, setStyle] = useState<UiStyle>(() => currentUiStyle());
  const change = useCallback((next: UiStyle) => {
    applyUiStyle(next);
    setStyle(next);
  }, []);
  return [style, change];
}
