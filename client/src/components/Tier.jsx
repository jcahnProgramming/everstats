import { TIER_BANDS } from '../../../server/stats/tiers.js';

/** A tier letter badge. letter null → the dashed "unranked / no grade" badge. */
export function TierBadge({ letter, large = false, label }) {
  const cls = letter ? `tier-${letter.toLowerCase()}` : 'tier-none';
  return (
    <span className={`tier ${cls}${large ? ' tier-lg' : ''}`} role="img" aria-label={label ?? (letter ? `Tier ${letter}` : 'No tier yet')}>
      {letter ?? '–'}
    </span>
  );
}

/** The legend: what each letter means. Describes the rule; it shows no one's grade. */
export function TierLegend() {
  let from = 0;
  return (
    <ul className="list tier-legend">
      {TIER_BANDS.map((b) => {
        const range = from === 0 ? `Top ${b.share}%` : from + b.share === 100 ? `Bottom ${b.share}%` : `Next ${b.share}% (${from}–${from + b.share}%)`;
        from += b.share;
        return (
          <li key={b.letter} className="list-item">
            <span className="row"><TierBadge letter={b.letter} /> <span>{range} of their ruleset</span></span>
          </li>
        );
      })}
    </ul>
  );
}
