import { Link } from 'react-router-dom';
import { Icon } from '../chrome/Icon.jsx';
import { RenderFrame, Spinner } from './Stats.jsx';
import { TierBadge } from './Tier.jsx';

/**
 * The page-level states of design v1 (design/v1/states) besides the four empty states (EmptyState.jsx):
 *
 *   CharacterLoading    a character lookup in progress          (states/loading)
 *   CharacterNotFound   the lookup found nobody                 (states/character-not-found)
 *   ServiceUnavailable  something upstream isn't answering      (states/api-unavailable)
 *   render-not-ready    <RenderFrame pending />                 (states/render-not-ready)
 *   sign-in-not-configured: on the sign-in page itself (SignInPages.jsx)
 */

/** The name echoes what was searched; everything else shimmers. aria-busy on the sheet, a status line. */
export function CharacterLoading({ name, surname }) {
  const blocks = Array.from({ length: 6 }, (_, i) => <span key={i} className="skel skel-block" />);
  return (
    <section className="sheet stack gap-24 sheet-pad" aria-busy="true">
      <div className="row gap-24 sheet-top">
        <div className="stack gap-12 flex-fill">
          <h1 className="h-display char-name">{name} <span className="surname">{surname}</span></h1>
          <span className="t2 small" role="status">Looking this character up…</span>
          <span className="skel skel-line w-60" />
          <span className="skel skel-line w-40" />
        </div>
        <TierBadge size="lg" loading />
      </div>
      <div className="grid-auto">
        <div className="stack gap-6">{blocks}</div>
        <div className="render skel loading-render"><Spinner size="xxxl" /></div>
        <div className="stack gap-6">{blocks}</div>
      </div>
    </section>
  );
}

/** Honest about why a character can be missing; a search box prefilled with the query lives on the page. */
export function CharacterNotFound({ name, surname, known = null, children }) {
  return (
    <section className="panel pad-28 stack gap-16 narrow-panel">
      <svg viewBox="0 0 64 64" aria-hidden="true" className="state-glyph">
        <circle cx="32" cy="32" r="28" className="glyph-ring" />
        <text x="32" y="42" textAnchor="middle" fontSize="28" className="glyph-q">?</text>
      </svg>
      <h1 className="h2">No “{name} {surname}” in the US region — yet</h1>
      <p className="t2">Blizzard only lists a character once it has reached level 10 and logged out at least once, and new characters can take a little while to show.</p>
      {known && (
        <p className="t2 small">
          Everstats knows of {known.name} {known.surname} from a Battle.net account list{Number.isInteger(known.level) ? `, at level ${known.level}` : ''}, but Blizzard
          doesn’t serve their profile yet.{Number.isInteger(known.level) && known.level < 10 ? ' Characters appear at level 10.' : ' The account list can run 20–40 minutes ahead of the profile.'}
        </p>
      )}
      <ul className="t2 small stack gap-4 tips">
        <li>Just hit 10? Log out fully, wait a few minutes, then try again.</li>
        <li>Check the spelling of both the first name and the surname.</li>
      </ul>
      {children}
    </section>
  );
}

/**
 * Something Everstats depends on isn't answering. Two forms (states/api-unavailable): with older data to show, an
 * inline alert above it (`inline`); with nothing to show, a centred panel. `detail` is a short status line.
 */
export function ServiceUnavailable({ title, children, inline = false, onRetry = null, detail = null }) {
  if (inline) {
    return (
      <div className="note err" role="alert">
        <Icon name="error" />
        <div className="stack gap-4 flex-fill"><b>{title}</b>{children && <span className="small">{children}</span>}</div>
        {onRetry && <button type="button" className="btn sm" onClick={onRetry}><Icon name="refresh" size="sm" />Retry now</button>}
      </div>
    );
  }
  return (
    <section className="panel pad-28 stack gap-12 center-panel" role="alert">
      <svg viewBox="0 0 64 64" aria-hidden="true" className="state-glyph">
        <circle cx="32" cy="32" r="28" className="glyph-err" />
        <path d="M22 22l20 20M42 22L22 42" className="glyph-err-x" />
      </svg>
      <h1 className="h2">{title}</h1>
      {children && <p className="t2 narrow-text">{children}</p>}
      <div className="row gap-10 justify-center">
        {onRetry && <button type="button" className="btn gold" onClick={onRetry}>Try again</button>}
        <Link className="btn ghost" to="/leaderboards">Browse leaderboards</Link>
      </div>
      {detail && <span className="mono muted xsmall">{detail}</span>}
    </section>
  );
}

export { RenderFrame };
