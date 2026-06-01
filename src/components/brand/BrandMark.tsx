// The wXMR brand mark: an accent tile with a simplified Monero
// mountain glyph. One mark, used everywhere — no more inline SVGs
// duplicated across pages.

export function BrandMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: 'linear-gradient(155deg, #ff8a45 0%, #ff6a1a 60%, #f05500 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 14px rgba(255,106,26,0.35)',
      }}
      aria-hidden
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        <path d="M12 2 4 9v9h3v-6l5 5 5-5v6h3V9z" fill="#fff" />
      </svg>
    </span>
  );
}

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5 select-none">
      <BrandMark size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        wXMR <span className="font-normal text-ink-3">Bridge</span>
      </span>
    </span>
  );
}
