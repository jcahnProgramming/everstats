import { Link, useParams } from 'react-router-dom';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import './pages.css';

// One statistic's leaderboard on one ruleset. The statistic and ruleset registries are empty until the discovery
// pass, so any address here is honestly "not covered": Everstats knows no statistic or ruleset yet.
const COLUMNS = ['Rank', 'Character', 'Value', 'Guild', 'Fresh as of'];

export function StatLeaderboardPage() {
  const { ruleset, statistic } = useParams();
  return (
    <>
      <div className="page-head">
        <p className="eyebrow smallcaps"><Link to="/leaderboards">Leaderboards</Link> · {ruleset}</p>
        <h1>{statistic}</h1>
      </div>

      <EmptyState kind="nocoverage" title="Everstats doesn't track this statistic yet">
        <span>No statistic or ruleset has been loaded from Blizzard yet, so there's no “{statistic}” leaderboard on “{ruleset}”.</span>
      </EmptyState>

      <section className="panel" aria-labelledby="board-h">
        <div className="panel-head">
          <h2 id="board-h">Top characters</h2>
          <span className="faint">Ranked, paged</span>
        </div>
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>{COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td colSpan={COLUMNS.length} className="board-empty">No rows. Nothing is ranked yet.</td></tr>
            </tbody>
          </table>
        </div>
        <Provenance />
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="climb-h">
          <div className="panel-head"><h2 id="climb-h">Climbers this week</h2></div>
          <div className="placeholder-frame">Biggest gains over the last seven days of snapshots.</div>
        </section>
        <section className="panel" aria-labelledby="guilds-h">
          <div className="panel-head"><h2 id="guilds-h">Guild rankings</h2></div>
          <div className="placeholder-frame">Guilds ranked on this statistic.</div>
        </section>
      </div>
    </>
  );
}
