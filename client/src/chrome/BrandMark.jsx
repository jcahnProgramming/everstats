/** The small brand mark (design/v1/assets/emblem/mark.svg, inlined so it follows the page theme). */
export function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" className="mark-ring" />
      <path d="M32 6 L35 29 L58 32 L35 35 L32 58 L29 35 L6 32 L29 29 Z" className="mark-rose" />
      <text x="32" y="42" textAnchor="middle" fontSize="28" className="mark-letter">E</text>
    </svg>
  );
}

/** The large compass emblem (design/v1/assets/emblem/emblem.svg): the home page hero. */
export function Emblem({ className = '' }) {
  return (
    <svg viewBox="0 0 200 200" className={`emblem ${className}`} role="img" aria-label="Everstats emblem: a compass rose with an E">
      <circle cx="100" cy="100" r="96" className="em-outer" />
      <circle cx="100" cy="100" r="88" className="em-dash" />
      <circle cx="100" cy="100" r="70" className="em-disc" />
      <circle cx="100" cy="100" r="62" className="em-inner" />
      <path d="M100 8 L106 92 L192 100 L106 108 L100 192 L94 108 L8 100 L94 92 Z" className="em-rose" />
      <path d="M100 30 L103 97 L170 100 L103 103 L100 170 L97 103 L30 100 L97 97 Z" className="em-rose-2" />
      <path d="M100 52 L134 100 L100 148 L66 100 Z" className="em-diamond" />
      <text x="100" y="116" textAnchor="middle" fontSize="48" className="em-letter">E</text>
      <text x="100" y="20" textAnchor="middle" fontSize="8" className="em-point">N</text>
      <text x="186" y="103" textAnchor="middle" fontSize="8" className="em-point">E</text>
      <text x="100" y="190" textAnchor="middle" fontSize="8" className="em-point">S</text>
      <text x="14" y="103" textAnchor="middle" fontSize="8" className="em-point">W</text>
    </svg>
  );
}

/** The compass ring behind a character render (design/v1/assets/emblem/compass-ring.svg). */
export function CompassRing({ className = 'ring' }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="96" className="cr-outer" />
      <circle cx="100" cy="100" r="84" className="cr-dash" />
      <path d="M100 4 L105 95 L196 100 L105 105 L100 196 L95 105 L4 100 L95 95 Z" className="cr-rose" />
    </svg>
  );
}
