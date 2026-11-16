import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UI_STYLE_STORAGE_KEY, readStoredUiStyle } from '../uiStyle';
import StyleToggle from './StyleToggle';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.style;
});

describe('StyleToggle', () => {
  it('預設是溫暖質感，按一下切到現代簡約並記住，再按一下切回來', async () => {
    render(<StyleToggle />);
    const btn = screen.getByRole('button', { name: /切換介面風格（目前：溫暖質感/ });

    await userEvent.click(btn);
    expect(document.documentElement.dataset.style).toBe('modern');
    expect(localStorage.getItem(UI_STYLE_STORAGE_KEY)).toBe('modern');
    expect(screen.getByRole('button', { name: /目前：現代簡約/ })).toBeInTheDocument();

    await userEvent.click(btn);
    expect(document.documentElement.dataset.style).toBe('warm');
    expect(localStorage.getItem(UI_STYLE_STORAGE_KEY)).toBe('warm');
  });

  it('以頁面上已套用的風格為初始狀態（由 index.html 的內嵌腳本先套用）', () => {
    document.documentElement.dataset.style = 'modern';
    render(<StyleToggle />);
    expect(screen.getByRole('button', { name: /目前：現代簡約/ })).toBeInTheDocument();
  });
});

describe('readStoredUiStyle', () => {
  it('沒有儲存或值不合法時回傳預設的溫暖質感', () => {
    expect(readStoredUiStyle()).toBe('warm');
    localStorage.setItem(UI_STYLE_STORAGE_KEY, 'neon');
    expect(readStoredUiStyle()).toBe('warm');
    localStorage.setItem(UI_STYLE_STORAGE_KEY, 'modern');
    expect(readStoredUiStyle()).toBe('modern');
  });
});
