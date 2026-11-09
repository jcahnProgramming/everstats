import { Link } from 'react-router-dom';
import { TIER_LETTERS, bandRanges } from '../../../server/stats/tiers.js';
import { formatNumber } from '../format.js';

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

/**
 * What each letter means, from the LIVE shares (admin setting tiers.shares, sent by the API). It describes the rule;
 * it shows no one's grade. `minPopulation`: the ruleset minimum, for the Unranked line.
 */
export function TierLegend({ shares, minPopulation = null }) {
  return (
    <ul className="plain stack gap-8 tier-legend">
      {bandRanges(shares).map((b) => (
        <li key={b.letter} className="row gap-12">
          <TierBadge letter={b.letter} size="sm" />
          <span className="t2 small">{b.share === 0 ? 'Nobody (share set to 0%)' : `${b.range} of their ruleset`}</span>
        </li>
      ))}
      <li className="row gap-12">
        <TierBadge letter={null} size="sm" />
        <span className="t2 small">Unranked: {minPopulation ? `the ruleset has fewer than ${formatNumber(minPopulation)} tier-eligible characters, or ` : ''}the character doesn't meet a minimum yet (the page says which)</span>
      </li>
    </ul>
  );
}

/** "Top 5%" etc. for a letter under the given shares. */
export function letterRange(letter, shares) {
  return bandRanges(shares).find((b) => b.letter === letter)?.range ?? null;
}

/**
 * A distribution of letters (design: guild "Members by tier"): the tier bar, sized by the real counts, plus the same
 * counts in words, so it never relies on the bar alone. letters: { S, A, B, C, D, unranked }.
 */
export function TierDistribution({ letters, label = 'Members by tier' }) {
  const total = [...TIER_LETTERS, 'unranked'].reduce((n, l) => n + (letters[l] ?? 0), 0);
  const parts = [...TIER_LETTERS.map((l) => [l, l.toLowerCase(), l]), ['unranked', 'u', '–']].filter(([k]) => letters[k] > 0);
  const words = [...TIER_LETTERS.map((l) => `${l} ${formatNumber(letters[l] ?? 0)}`), `Unranked ${formatNumber(letters.unranked ?? 0)}`].join(' · ');
  return (
    <div className="stack gap-8">
      <span className="eyebrow">{label}</span>
      {total > 0 && (
        <div className="tierbar" role="img" aria-label={words}>
          {parts.map(([k, cls, text]) => <span key={k} className={cls} style={{ flex: letters[k] }}>{text}</span>)}
        </div>
      )}
      <span className="t2 small tier-words">{words}</span>
    </div>
  );
}

/** A small letter (or "–") linking to the character's "Why this tier", for lists. */
export function TierLink({ slug, letter }) {
  if (!slug) return <TierBadge letter={letter} size="sm" />;
  return (
    <Link className="tier-link" to={`/c/${encodeURIComponent(slug)}#why-tier`} aria-label={letter ? `Tier ${letter}: why` : 'Unranked: why'}>
      <TierBadge letter={letter} size="sm" label={letter ? `Tier ${letter}` : 'Unranked'} />
    </Link>
  );
}

/**
 * A featured character's tier (dashboard, profile): the letter, or Unranked with the reason in words, and a link to
 * its "Why this tier". brief: { letter, status, reason } from the API (server/tiers/view.js tierBrief), null = hidden.
 */
export function TierBrief({ brief, slug }) {
  if (!brief) return null;
  return (
    <Link className="row gap-12 tier-brief" to={`/c/${encodeURIComponent(slug)}#why-tier`}>
      <TierBadge letter={brief.letter} size="md" />
      <span className="stack gap-2">
        <span className="eyebrow">Overall tier</span>
        <span className="small strong-text">{brief.letter ? `Tier ${brief.letter}` : 'Unranked'}</span>
        {brief.reason && <span className="muted xsmall">{brief.reason}</span>}
        <span className="xsmall">Why this tier →</span>
      </span>
    </Link>
  );
}
