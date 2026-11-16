import { Palette } from 'lucide-react';
import { nextUiStyle, uiStyleLabel, useUiStyle } from '../uiStyle';

/** 導覽列上的介面風格開關：每按一次切換到下一種風格（溫暖質感 ⇄ 現代簡約）。 */
export default function StyleToggle() {
  const [style, setStyle] = useUiStyle();
  const next = nextUiStyle(style);
  const label = `切換介面風格（目前：${uiStyleLabel(style)}，按一下改為${uiStyleLabel(next)}）`;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon style-toggle"
      onClick={() => setStyle(next)}
      aria-label={label}
      title={label}
      data-style-current={style}
    >
      <Palette size={18} aria-hidden="true" />
    </button>
  );
}
