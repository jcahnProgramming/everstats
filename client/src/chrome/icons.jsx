// Inline stroke icons and the round emblem. Colours come from currentColor or tokens, never written here.
const Svg = ({ size = 20, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

/** The round launch emblem: a ring, a compass rose and an E. Ring, fill and mark are theme tokens. */
export function Emblem({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" style={{ fill: 'var(--emblem-fill)', stroke: 'var(--emblem-ring)' }} strokeWidth="2.5" />
      <circle cx="24" cy="24" r="17" style={{ stroke: 'var(--emblem-ring)' }} fill="none" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
      <path d="M24 5 L26 22 L24 24 L22 22 Z M24 43 L22 26 L24 24 L26 26 Z M5 24 L22 22 L24 24 L22 26 Z M43 24 L26 26 L24 24 L26 22 Z" style={{ fill: 'var(--emblem-ring)' }} opacity="0.55" />
      <text x="24" y="30.5" textAnchor="middle" fontFamily="Palatino Linotype, Palatino, Georgia, serif" fontSize="18" fontWeight="700" style={{ fill: 'var(--emblem-mark)' }}>E</text>
    </svg>
  );
}

export const SearchIcon = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Svg>;
export const TrophyIcon = (p) => <Svg {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" /></Svg>;
export const UserIcon = (p) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></Svg>;
export const ClockIcon = (p) => <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></Svg>;
export const DatabaseIcon = (p) => <Svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></Svg>;
export const MapIcon = (p) => <Svg {...p}><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" /><path d="M9 4v14M15 6v14" /></Svg>;
export const ScaleIcon = (p) => <Svg {...p}><path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0Zm12 0-3 6a3 3 0 0 0 6 0Z" /></Svg>;
export const KeyIcon = (p) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></Svg>;
export const ShieldIcon = (p) => <Svg {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" /></Svg>;
export const ChevronLeft = (p) => <Svg {...p}><path d="m15 6-6 6 6 6" /></Svg>;
