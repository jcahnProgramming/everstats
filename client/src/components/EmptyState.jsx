import { formatNumber, timeAgo } from '../format.js';
import { Icon } from '../chrome/Icon.jsx';
import { TierBadge } from './Tier.jsx';

/**
 * The four empty states. They must never look alike (CLAUDE.md, "Honesty rules"), and each has its own label, icon
 * and border, so they differ without colour too:
 *
 *   soon        Coming soon       the feature isn't built yet            solid gold-tinted frame, clock icon
 *   nodata      No data yet       built, and this has nothing yet        DASHED box, chart icon (design: no-data-yet)
 *   nocoverage  No coverage here  outside what Everstats tracks          HATCHED panel, crossed circle (design: no-coverage-here)
 *   unranked    Unranked          ruleset below the grading population   the "–" shield + a progress line (design: unranked)
 *
 * 0.4.0 adds four more, each again with its own label, icon and border (none shares one with another):
 *   collecting  Collecting data   a weekly/monthly board before a whole period of snapshots exists   DOTTED frame, trend icon
 *   hidden      Hidden            a character its owner has hidden                   DOUBLE frame, lock icon
 *   couldnt     Couldn't check    Blizzard or a sign-in token failed: unknown, not "none"   danger bar on the left, warning icon
 *   tied        Everyone's tied   every tracked character has the same value         solid frame, accent rule on top, sort icon
 *
 * The design (design/v1/states) has no "Coming soon" state: the mockups show every feature as built. This one is
 * made from the design's own parts (panel, gem, tag, clock icon) so it fits, but its solid frame is shared with none
 * of the other three.
 *
 *   <EmptyState kind="soon" title="Leaderboards are coming soon">Optional explanation</EmptyState>
 *   compact: a smaller version for inside a card
 */
const KINDS = {
  soon: { label: 'Coming soon', icon: 'clock' },
  nodata: { label: 'No data yet', icon: 'chart' },
  nocoverage: { label: 'No coverage here', icon: 'no-coverage' },
  collecting: { label: 'Collecting data', icon: 'trend-up' },
  hidden: { label: 'Hidden', icon: 'lock' },
  couldnt: { label: 'Couldn’t check', icon: 'warning' },
  tied: { label: 'Everyone’s tied', icon: 'sort' },
};

export function EmptyState({ kind, title, children, compact = false, action = null }) {
  if (kind === 'unranked') return <UnrankedNote compact={compact} />;
  const { label, icon } = KINDS[kind];
  return (
    <div className={`state state-${kind}${compact ? ' compact' : ''}`} role="status">
      <Icon name={icon} size={compact ? 'md' : 'xl'} className="state-icon" />
      <div className="stack gap-8 state-body">
        <span className="state-kind">{label}</span>
        {title && <strong className="state-title">{title}</strong>}
        {children && <div className="t2 small stack gap-6">{children}</div>}
        {action}
      </div>
    </div>
  );
}

/**
 * "Unranked — grading opens at N tracked characters" (design/v1/states/unranked). N is the admin setting
 * grading.minPopulation. The progress line toward N shows only when the ruleset's tracked count is actually known:
 * before characters are tracked it says so instead of drawing a bar from a guess.
 */
export function UnrankedNote({ minPopulation = null, tracked = null, ruleset = null, compact = false }) {
  const n = Number.isInteger(minPopulation) ? formatNumber(minPopulation) : 'N';
  const known = Number.isInteger(tracked) && Number.isInteger(minPopulation) && minPopulation > 0;
  return (
    <div className={`state state-unranked${compact ? ' compact' : ''}`} role="status">
      <TierBadge letter={null} size={compact ? 'md' : 'lg'} />
      <div className="stack gap-12 state-body">
        <span className="state-kind">Unranked</span>
        {ruleset && <span className="tag state-ruleset">{ruleset}</span>}
        <strong className="state-title">Unranked — grading opens at {n} tracked characters</strong>
        {!compact && (
          <p className="t2 small">
            Tiers are graded only against the same ruleset, so a ruleset needs enough characters for percentiles to mean
            something. Leaderboards still work while it's unranked.
          </p>
        )}
        {known ? (
          <div className="stack gap-6">
            <div className="bar warn"><span className="bar-fill" style={{ width: `${Math.min(100, (tracked / minPopulation) * 100)}%` }} /></div>
            <span className="muted xsmall">{formatNumber(tracked)} of {n} tracked · every lookup counts</span>
          </div>
        ) : (
          <span className="muted xsmall">Tracked characters: not counted yet. Everstats isn't tracking any characters so far.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Freshness dot + words (design .fresh): fresh (green), stale (amber, older than staleAfterMs), never (hollow).
 * `at` null means the thing was never fetched, said in words, never as a zero.
 */
export function Fresh({ at = null, staleAfterMs = 36 * 60 * 60 * 1000, prefix = '', never = 'Never fetched' }) {
  if (!at) return <span className="fresh old"><i />{never}</span>;
  const stale = Date.now() - Date.parse(at) > staleAfterMs;
  return <span className={`fresh${stale ? ' stale' : ''}`}><i />{prefix}{timeAgo(at)}</span>;
}

/**
 * Where a section's data came from and how fresh it is. Every section keeps one (CLAUDE.md "Provenance"); until
 * lookups exist, the source is "none yet" and the time is "never fetched".
 */
export function Provenance({ source = null, fetchedAt = null, children = null }) {
  return (
    <div className="provenance">
      <span><b>Source</b> {source ?? 'none yet'}</span>
      <Fresh at={fetchedAt} prefix="Fetched " />
      {children}
    </div>
  );
}
