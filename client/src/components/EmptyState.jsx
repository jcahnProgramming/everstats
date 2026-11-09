import { ClockIcon, DatabaseIcon, MapIcon, ScaleIcon } from '../chrome/icons.jsx';

/**
 * The four empty states. They must never look alike (CLAUDE.md, "Honesty rules"):
 *
 *   soon        Coming soon      the feature isn't built yet
 *   nodata      No data yet      it exists, this thing just has nothing yet (e.g. you've added no characters)
 *   nocoverage  No coverage      outside what Everstats tracks (a ruleset or statistic it doesn't know, a region)
 *   unranked    Unranked         tracked, but the ruleset is below the grading population
 *
 * Each has its own label, icon and border style (theme/base.css .state-*), so they differ without colour too.
 */
const KINDS = {
  soon: { label: 'Coming soon', Icon: ClockIcon },
  nodata: { label: 'No data yet', Icon: DatabaseIcon },
  nocoverage: { label: 'No coverage here', Icon: MapIcon },
  unranked: { label: 'Unranked', Icon: ScaleIcon },
};

export function EmptyState({ kind, title, children }) {
  const { label, Icon } = KINDS[kind];
  return (
    <div className={`state state-${kind}`} role="status">
      <span className="state-icon"><Icon size={24} /></span>
      <span className="state-kind">{label}</span>
      <div className="state-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** "Unranked — grading opens at N tracked characters", N from the admin setting. */
export function UnrankedNote({ minPopulation }) {
  return (
    <EmptyState kind="unranked" title={`Grading opens at ${Number(minPopulation).toLocaleString('en-US')} tracked characters`}>
      <span>Each ruleset is graded on its own. Until it has that many tracked characters, its characters show Unranked instead of a letter.</span>
    </EmptyState>
  );
}

/** Where a value came from and how fresh it is. Every stat will carry one; in the scaffold both are unknown. */
export function Provenance({ source = null, fetchedAt = null }) {
  return (
    <div className="provenance">
      <span><b>Source</b> {source ?? 'none yet'}</span>
      <span><b>Fresh as of</b> {fetchedAt ?? 'never fetched'}</span>
    </div>
  );
}
