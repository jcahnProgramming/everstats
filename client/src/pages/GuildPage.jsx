import { useParams } from 'react-router-dom';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import './pages.css';

const COLUMNS = ['Member', 'Level', 'Tier', 'Fresh as of'];

export function GuildPage() {
  const { slug } = useParams();
  return (
    <>
      <div className="page-head">
        <p className="eyebrow smallcaps">Guild · US</p>
        <h1>{slug}</h1>
      </div>

      <EmptyState kind="soon" title="Guild pages are coming soon">
        <span>A guild page will list its roster with each member's tier, and its place on the guild leaderboards. Guild rosters are also how Everstats finds new characters to track.</span>
      </EmptyState>

      <section className="panel" aria-labelledby="roster-h">
        <div className="panel-head"><h2 id="roster-h">Roster</h2></div>
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>{COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td colSpan={COLUMNS.length} className="board-empty">No members loaded.</td></tr>
            </tbody>
          </table>
        </div>
        <Provenance />
      </section>

      <section className="panel" aria-labelledby="granks-h">
        <div className="panel-head"><h2 id="granks-h">Guild rankings</h2></div>
        <div className="placeholder-frame">Where this guild places on each leaderboard.</div>
      </section>
    </>
  );
}
