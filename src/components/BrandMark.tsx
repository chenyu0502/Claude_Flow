/** Claude Flow 的品牌圖形：陶土色圓角方塊裡一道流動的線（與 public/favicon.svg 相同）。 */
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path
        d="M7 19c3.2-5.2 6.4-5.2 9 0s5.8 5.2 9 0"
        fill="none"
        stroke="var(--primary-text)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="11" cy="11" r="2.2" fill="var(--gold-soft)" />
    </svg>
  );
}
