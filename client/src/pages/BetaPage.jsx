import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { formatDate } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * /beta: what the beta is and what members get. Two versions, from the owner's beta window (GET /api/beta):
 * open (join now) and ended (thanks, and the perks still listed). The perks are the owner's admin-edited list.
 * Membership is decided only by the window: an account made while it's open is a beta member, for good.
 */
export function BetaPage() {
  const session = useSession();
  const [beta, setBeta] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/api/beta').then(setBeta, (err) => setError(err.message));
  }, []);
  if (error) return <div className="wrap page-pad"><ServiceUnavailable title="Couldn't load the beta page">{error}</ServiceUnavailable></div>;
  if (!beta) return <div className="wrap page-pad"><h1 className="h1">The Everstats beta</h1></div>;

  return (
    <div className="wrap page-pad stack gap-28 narrow-wrap">
      <div className="stack gap-12">
        <span className="tag gold self-start">{beta.open ? 'Beta now open' : 'Beta ended'}</span>
        <h1 className="h1">{beta.open ? 'The Everstats beta is open' : 'The beta has ended — thanks to everyone who joined'}</h1>
        <p className="lead">
          {beta.open
            ? `Everstats is in beta${beta.openedAt ? ` since ${formatDate(beta.openedAt)}` : ''}: character pages and a leaderboard for every statistic are live, and they get better with every player who joins.`
            : `The beta ran${beta.openedAt ? ` from ${formatDate(beta.openedAt)}` : ''}${beta.closedAt ? ` to ${formatDate(beta.closedAt)}` : ''}. Everyone who made an account during it is a beta member.`}
        </p>
      </div>

      {beta.open && (
        <section className="panel pad-24 stack gap-14" aria-labelledby="what-h">
          <h2 className="h2 h2-panel" id="what-h">What “beta” means here</h2>
          <ul className="t2 stack gap-8 beta-list">
            <li><b className="strong-text">Boards are filling up.</b> A rank is out of everyone tracked so far. Every search and every sign-in adds characters, and guild rosters bring in their members.</li>
            <li><b className="strong-text">Things may change.</b> Categories, pages and numbers can move as we learn what Blizzard's data really holds. Tiers and guild pages are the next build.</li>
            <li><b className="strong-text">Feedback is welcome.</b> Something wrong, missing or confusing? Tell us: it shapes 1.0.</li>
          </ul>
        </section>
      )}

      <section className="sheet pad-24 stack gap-14" aria-labelledby="perks-h">
        <h2 className="h2 h2-panel" id="perks-h">What beta members get</h2>
        {beta.perks.length === 0 ? <span className="t2 small">Nothing listed yet.</span> : (
          <ul className="plain stack gap-12">
            {beta.perks.map((p) => (
              <li key={p.title} className="row gap-12 align-start">
                <Icon name="check" />
                <span className="stack gap-2"><b>{p.title}</b>{p.description && <span className="t2 small">{p.description}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted xsmall">Badges arrive with 1.0. Membership is recorded on each account the moment it's created, and it can't be added later.</p>
      </section>

      {beta.open && !session.signedIn && (
        <div className="row gap-12">
          <Link className="btn gold" to="/sign-in">Join: sign in or create an account</Link>
          <span className="muted small">Signing in with Battle.net brings every Forever character on your account in at once.</span>
        </div>
      )}
      {beta.open && session.signedIn && <p className="t2 small">You're signed in. Your beta membership is shown in <Link to="/settings">Settings</Link>.</p>}
    </div>
  );
}
