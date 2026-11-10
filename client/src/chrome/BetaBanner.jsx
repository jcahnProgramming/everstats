import { useState } from 'react';
import { Link } from '../scope.jsx';
import { Icon } from './Icon.jsx';
import { useSession } from '../session.jsx';

/**
 * The beta, in the frame of every page, only while the owner's beta window is open (/api/session → beta.open):
 *
 *   <BetaBadge />    a "Beta" tag beside the wordmark, linking to /beta
 *   <BetaBanner />   a slim one-line banner under the top bar, linking to /beta, dismissible PER BROWSER
 *
 * Dismissing is a per-viewer convenience kept in localStorage, keyed by the window's opening date (a later reopening
 * shows the banner again). Storage may be unavailable (private mode, blocked site data): every read and write is
 * wrapped, and without storage the banner just shows, and closes for this page view only. On phones it stays one
 * line (the text truncates), so it never pushes the page around.
 */
const KEY = 'everstats.betaBanner.dismissed';

function readDismissed() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeDismissed(value) {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* no storage: dismissed for this page view only */
  }
}

export function BetaBadge() {
  const { beta } = useSession();
  if (!beta?.open) return null;
  return <Link to="/beta" className="tag gold beta-badge" aria-label="Everstats is in beta: what that means">Beta</Link>;
}

export function BetaBanner() {
  const { beta, signedIn, loading } = useSession();
  const [dismissed, setDismissed] = useState(readDismissed);
  // 0.9.2: an invitation to sign up, so only for signed-out visitors (a signed-in player already has an account; the
  // header's beta badge still links to /beta for everyone).
  if (!beta?.open || loading || signedIn) return null;
  const stamp = String(beta.openedAt ?? 'open');
  if (dismissed === stamp) return null;
  return (
    <div className="beta-banner" role="region" aria-label="Beta">
      <div className="wrap beta-banner-in">
        <Link to="/beta" className="beta-banner-link">
          <b>Beta now open</b>
          <span className="beta-banner-text">Sign up and your characters join the boards; every account made during the beta gets the Beta Tester badge.</span>
        </Link>
        <button
          type="button"
          className="btn ghost sm icon beta-banner-close"
          aria-label="Dismiss the beta banner"
          onClick={() => {
            writeDismissed(stamp);
            setDismissed(stamp);
          }}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
    </div>
  );
}
