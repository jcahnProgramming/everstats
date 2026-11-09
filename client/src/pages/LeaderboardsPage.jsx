import { EmptyState, UnrankedNote } from '../components/EmptyState.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { useCoverage } from '../useCoverage.js';
import './pages.css';

// Leaderboards: one per statistic, per ruleset, browsed by category. Rulesets come from Blizzard's own list (never
// typed in here), so until they're loaded this page has nothing to choose from, and says so.
export function LeaderboardsPage() {
  const { coverage, error } = useCoverage();
  return (
    <>
      <div className="page-head">
        <p className="eyebrow smallcaps">Leaderboards · US</p>
        <h1>Leaderboards</h1>
        <p className="muted">Every statistic gets its own leaderboard on each ruleset, and guilds are ranked too.</p>
      </div>

      <EmptyState kind="soon" title="Leaderboards are coming soon">
        <span>They fill in as Everstats starts tracking characters.</span>
      </EmptyState>

      <section className="panel" aria-labelledby="rulesets-h">
        <div className="panel-head"><h2 id="rulesets-h">Rulesets</h2></div>
        {error && <p className="notice notice-danger">{error}</p>}
        {coverage && coverage.rulesets === null && (
          <EmptyState kind="nocoverage" title="No rulesets loaded yet">
            <span>Rulesets come from the game's own list, so a new one (Hardcore, when it launches) appears by itself. Each ruleset is ranked and graded separately.</span>
          </EmptyState>
        )}
      </section>

      <section className="panel" aria-labelledby="cats-h">
        <div className="panel-head"><h2 id="cats-h">Categories</h2></div>
        <EmptyState kind="nocoverage" title="No statistic categories yet">
          <span>Categories are read from Blizzard's statistics, not chosen by Everstats.</span>
        </EmptyState>
      </section>

      <section className="panel" aria-labelledby="grading-h">
        <div className="panel-head"><h2 id="grading-h">Grading</h2></div>
        <TierLegend />
        {coverage && <UnrankedNote minPopulation={coverage.minPopulation} />}
      </section>
    </>
  );
}
