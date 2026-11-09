import { Link, useParams } from 'react-router-dom';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';

/**
 * One statistic's leaderboard on one ruleset (design/v1/pages/leaderboard-single).
 *
 * The statistic and ruleset registries are empty until the discovery pass, so every address here is honestly
 * "No coverage here": Everstats knows no statistic or ruleset yet. That is the design's hatched no-coverage panel
 * (states/no-coverage-here), never the dashed "No data yet", which means a board that exists and is empty.
 * The address parts are shown as they came, never prettified into a name Everstats doesn't know.
 */
export function StatLeaderboardPage() {
  const { ruleset, statistic } = useParams();
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="stack gap-10">
        <nav aria-label="Breadcrumb" className="crumbs xsmall"><Link to="/leaderboards">Leaderboards</Link><span aria-hidden="true">/</span><span className="mono">{ruleset}</span></nav>
        <h1 className="h1 mono-title">{statistic}</h1>
      </div>

      <section className="panel clip stack" aria-labelledby="board-h">
        <div className="row board-head">
          <h2 className="h3 muted" id="board-h">Top characters</h2>
          <span className="tag mono">{ruleset}</span>
        </div>
        <div className="pad-16 stack gap-14">
          <EmptyState kind="nocoverage" title="Everstats doesn't track this statistic yet">
            <span>No statistic or ruleset has been loaded from Blizzard yet, so there's no “{statistic}” board on “{ruleset}”: no board at all, not an empty one.</span>
            <span className="row gap-8"><Link className="btn sm ghost" to="/leaderboards">Back to boards</Link></span>
          </EmptyState>
          <Provenance />
        </div>
      </section>

      <div className="grid-auto col-lg">
        <section className="panel pad-20 stack gap-12" aria-labelledby="climb-h">
          <h2 className="h3" id="climb-h">Climbers this week</h2>
          <EmptyState kind="soon" compact title="Biggest gains over the last seven daily snapshots" />
        </section>
        <section className="panel pad-20 stack gap-12" aria-labelledby="guilds-h">
          <h2 className="h3" id="guilds-h">Guild rankings</h2>
          <EmptyState kind="soon" compact title="Guilds ranked on this statistic" />
        </section>
      </div>
    </div>
  );
}
