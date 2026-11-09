import { useSearchParams } from 'react-router-dom';
import { EmptyState, UnrankedNote } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RulesetSwitcher } from '../components/Stats.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { useCoverage } from '../useCoverage.js';

/**
 * Leaderboards index (design/v1/pages/leaderboards-index): pick a ruleset, browse categories of boards.
 *
 * Rulesets come from Blizzard's own list via /api/coverage, never from this file: until they're loaded there is
 * nothing to choose from, and the page says so (No coverage here). The chosen ruleset lives in the address
 * (?ruleset=…). The design's proposal to also remember it in the browser is not built (see the v1 handoff notes).
 */
export function LeaderboardsPage() {
  const { coverage, error } = useCoverage();
  const [params, setParams] = useSearchParams();
  const rulesets = coverage?.rulesets ?? null;
  const ruleset = params.get('ruleset') ?? rulesets?.[0]?.id ?? null;

  return (
    <div className="wrap page-pad stack gap-32">
      <div className="stack gap-18">
        <h1 className="h1">Leaderboards</h1>
        <p className="lead">Every statistic gets its own leaderboard on each ruleset, and guilds are ranked too.</p>
        {error && <ServiceUnavailable inline title="Couldn't load what Everstats covers">{error}</ServiceUnavailable>}
        {Array.isArray(rulesets) && rulesets.length > 0 && (
          <div className="row gap-16">
            <RulesetSwitcher rulesets={rulesets} value={ruleset} onChange={(id) => setParams({ ruleset: id })} large />
            <span className="t2 small">
              <b className="strong-text">{coverage.trackedCharacters === null ? 'Not counted yet:' : formatNumber(coverage.trackedCharacters)}</b> tracked characters
            </span>
          </div>
        )}
      </div>

      {coverage && rulesets === null && (
        <EmptyState kind="nocoverage" title="No rulesets loaded yet">
          <span>Rulesets come from the game's own list, so a new one appears here by itself the day Blizzard adds it. Each ruleset is ranked and graded separately.</span>
        </EmptyState>
      )}

      <section className="stack gap-14" aria-labelledby="cats-h">
        <div className="orn"><span className="gem" /><h2 className="h2 h2-panel" id="cats-h">Categories</h2><span className="rule" /></div>
        <EmptyState kind="soon" title="Leaderboards are coming soon">
          <span>Boards are grouped by the game's own statistic categories, each showing its top three at a glance with a link to the full board. They fill in as Everstats starts tracking characters.</span>
        </EmptyState>
      </section>

      <section className="panel pad-24 stack gap-16" aria-labelledby="grading-h">
        <h2 className="h2 h2-panel" id="grading-h">Grading</h2>
        <TierLegend />
        {coverage && <UnrankedNote minPopulation={coverage.minPopulation} tracked={coverage.trackedCharacters} />}
      </section>
    </div>
  );
}
