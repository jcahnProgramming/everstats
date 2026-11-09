import { TIER_BANDS } from '../../../server/stats/tiers.js';

/**
 * Tier badge (design/v1/components/tier-badge.md): a shield with the letter S/A/B/C/D, or "–" for Unranked.
 *
 *   <TierBadge letter="A" size="sm" />     sm 22×26 (tables) · md 40×47 (category cards) · lg 116×136 (overall)
 *   <TierBadge letter={null} />            Unranked: sunken fill, dashed-feeling ring, "–", aria-label "Unranked"
 *   <TierBadge loading />                  while a lookup runs
 *
 * Rank is told three ways, never by colour alone: the letter, the fill and the frame. The large S gets the glow and
 * three pips. Badges are never interactive themselves; wrap one in a.tier-link for that.
 */
export function TierBadge({ letter = null, size = 'md', loading = false, label }) {
  const l = loading ? null : letter;
  const cls = loading ? 'is-loading' : l ? l.toLowerCase() : 'u';
  const aria = label ?? (loading ? 'Tier loading' : l ? `Tier ${l}` : 'Unranked');
  const badge = (
    <span className={`tier ${size} ${cls}`} role="img" aria-label={aria}>
      <b aria-hidden="true">{loading ? '' : l ?? '–'}</b>
    </span>
  );
  if (size !== 'lg' || l !== 'S') return badge;
  return (
    <span className="tier-stack">
      <span className="tierglow">{badge}</span>
      <span className="pips" aria-hidden="true"><i /><i /><i /></span>
    </span>
  );
}

/** What each letter means. It describes the rule (CLAUDE.md "Tiers"); it shows no one's grade. */
export function TierLegend() {
  let from = 0;
  return (
    <ul className="plain stack gap-8 tier-legend">
      {TIER_BANDS.map((b) => {
        const range = from === 0 ? `Top ${b.share}%` : from + b.share === 100 ? `Bottom ${b.share}%` : `Next ${b.share}% (${from}–${from + b.share}%)`;
        from += b.share;
        return (
          <li key={b.letter} className="row gap-12">
            <TierBadge letter={b.letter} size="sm" />
            <span className="t2 small">{range} of their ruleset</span>
          </li>
        );
      })}
      <li className="row gap-12">
        <TierBadge letter={null} size="sm" />
        <span className="t2 small">Unranked: the ruleset doesn't have enough tracked characters to grade yet</span>
      </li>
    </ul>
  );
}
