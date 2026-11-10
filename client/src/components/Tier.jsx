import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TIER_LETTERS, bandRanges, tierBarParts } from '../../../server/stats/tiers.js';
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
export function TierBadge({ letter = null, size = 'md', loading = false, label, provisional = null }) {
  const l = loading ? null : letter;
  // 0.9.0: a PROVISIONAL letter (below a minimum, from the score so far): a hatched ring in the letter's colour around a
  // hollow shield, "≈B", never the solid fill of a real letter. Shown only where a real letter is null.
  const p = !loading && !l && provisional ? provisional : null;
  const cls = loading ? 'is-loading' : l ? l.toLowerCase() : p ? `prov ${p.toLowerCase()}` : 'u';
  const aria = label ?? (loading ? 'Tier loading' : l ? `Tier ${l}` : p ? `Unranked, provisionally ${p}` : 'Unranked');
  const badge = (
    <span className={`tier ${size} ${cls}`} role="img" aria-label={aria}>
      <b aria-hidden="true">{loading ? '' : l ?? (p ? `≈${p}` : '–')}</b>
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
 * A distribution of letters (design: guild "Members by tier"), 0.9.0: the bar shows RANKED members only, as S/A/B/C/D
 * proportions, every non-zero letter wide enough to read its letter and count ("S 1") (server/stats/tiers.js
 * tierBarParts). Unranked is never a segment and never folded into D: it has its own line, with why. The counts are
 * also said in words, so it never relies on the bar alone. letters: { S, A, B, C, D, unranked }. unrankedWhy: a node
 * (a link) after "below a tier minimum".
 */
/**
 * 0.9.2: which segments are too narrow for "letter + count". Each segment carries an invisible copy of its full label
 * (.tb-measure); a segment narrower than that copy shows its letter only, with the count in its tooltip and in the
 * words under the bar. Re-measured whenever the bar's width changes (a card, a phone, a resized window).
 */
function useNarrowSegments(ref, key) {
  const [narrow, setNarrow] = useState('');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      const out = [];
      for (const seg of el.children) {
        const m = seg.querySelector('.tb-measure');
        if (m && m.offsetWidth + 4 > seg.clientWidth) out.push(seg.dataset.letter);
      }
      const next = out.join('');
      setNarrow((prev) => (prev === next ? prev : next));
    };
    check();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
    };
  }, [ref, key]);
  return narrow;
}

export function TierDistribution({ letters, label = 'Members by tier', unrankedWhy = null }) {
  const { ranked, parts } = tierBarParts(letters);
  const unranked = letters.unranked ?? 0;
  const words = TIER_LETTERS.map((l) => `${l} ${formatNumber(letters[l] ?? 0)}`).join(' · ');
  const bar = useRef(null);
  const narrow = useNarrowSegments(bar, parts.map((p) => `${p.letter}${p.n}:${p.pct}`).join('|'));
  return (
    <div className="stack gap-8">
      <span className="eyebrow">{label}</span>
      {ranked > 0 ? (
        <div ref={bar} className="tierbar tierbar-ranked" role="img" aria-label={`Ranked: ${words}`}>
          {parts.map((p) => (
            <span key={p.letter} data-letter={p.letter} className={`${p.letter.toLowerCase()}${narrow.includes(p.letter) ? ' is-narrow' : ''}`} style={{ width: `${p.pct}%` }} title={`${p.letter}: ${formatNumber(p.n)}`}>
              {narrow.includes(p.letter) ? p.letter : `${p.letter} ${formatNumber(p.n)}`}
              <span className="tb-measure" aria-hidden="true">{p.letter} {formatNumber(p.n)}</span>
            </span>
          ))}
        </div>
      ) : <span className="t2 small">Nobody here has a letter yet.</span>}
      {ranked > 0 && <span className="t2 small tier-words">{formatNumber(ranked)} ranked · {words}</span>}
      {unranked > 0 && (
        <span className="t2 small tier-unranked-line">
          <TierBadge letter={null} size="sm" />
          <span className="tier-unranked-text">{formatNumber(unranked)} unranked: below a tier minimum{unrankedWhy ? <> · {unrankedWhy}</> : null}</span>
        </span>
      )}
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
      <TierBadge letter={brief.letter} size="md" provisional={brief.provisional ?? null} />
      <span className="stack gap-2">
        <span className="eyebrow">Overall tier</span>
        <span className="small strong-text">{brief.letter ? `Tier ${brief.letter}` : brief.provisional ? <ProvisionalText letter={brief.provisional} /> : 'Unranked'}</span>
        {brief.reason && <span className="muted xsmall">{brief.reason}</span>}
        <span className="xsmall">Why this tier →</span>
      </span>
    </Link>
  );
}

/**
 * "≈ B (provisional)" (0.9.0): the words beside a provisional badge. A provisional letter is what the score so far
 * would earn against the ruleset's last full grading, for someone still below a minimum; it is never on a board.
 */
export function ProvisionalText({ letter }) {
  return <span className="tier-prov-text">≈ {letter} <span className="tier-prov-word">(provisional)</span></span>;
}
