// WAYVE brand (from the product mockup): a single-stroke wave mark + "WAYVE" set tight and heavy. Static, never animated.
export function WaveMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 32 20" fill="none" aria-hidden className={className}>
      <path d="M2 15.5c3.2 0 4.4-9 8.2-9 3.6 0 4 7 7.4 7 3.1 0 4.3-8 7.4-10.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The logo. `size` ≈ cap height in px. `markOnly` for tight spots (tab icons, favicons). */
export function Logo({ size = 20, className, markOnly = false }: { size?: number; className?: string; markOnly?: boolean }) {
  return (
    <span className={['inline-flex items-center gap-[0.32em] text-fg select-none', className].filter(Boolean).join(' ')} role="img" aria-label="WAYVE"
      style={{ fontSize: size }}>
      <WaveMark size={size * 0.95} />
      {!markOnly && <span aria-hidden style={{ fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>WAYVE</span>}
    </span>
  );
}
