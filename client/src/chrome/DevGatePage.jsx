import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { SITE_ENVIRONMENT } from '../release.js';
import { useSession } from '../session.jsx';
import { EmptyState } from '../components/EmptyState.jsx';

/**
 * 0.10.3: the dev tester gate's page (server/devgate/gate.js). On the dev site, while the admin's "Dev tester gate"
 * switch is on, every page needs a sign-in, and only accounts holding Dev Tester on production (and the dev admin) get
 * past. AppShell wraps the page in <DevGate>: it asks GET /api/dev-gate once per sign-in state and draws this page
 * instead of the page whenever the gate blocks. Off (production, and dev with the switch off) it draws the page as
 * always and nothing else changes.
 *
 * Only the dev site asks at all (SITE_ENVIRONMENT, from the server's theme boot): production never makes the request
 * and never draws this page, whatever happens.
 *
 * The server is the lock (every API answers 403 dev_gate); this page only says so in words. Sign-in pages, and the
 * admin's own sign-in and enrolment, are always drawn.
 */
const ALWAYS = ['/sign-in', '/sign-in/2fa', '/admin/sign-in', '/admin/enroll'];

export function DevGate({ children }) {
  if (SITE_ENVIRONMENT !== 'dev') return children;
  return <DevSiteGate>{children}</DevSiteGate>;
}

function DevSiteGate({ children }) {
  const { pathname } = useLocation();
  const session = useSession();
  const [gate, setGate] = useState(null);
  const ask = useCallback(() => {
    api('/api/dev-gate').then((r) => setGate(r.gate), () => setGate('unavailable'));
  }, []);
  // Asked again whenever who is signed in changes (sign-in, sign-out, finishing 2FA).
  const who = `${session?.signedIn ? 'in' : 'out'}:${session?.stage ?? ''}:${session?.user?.username ?? ''}`;
  useEffect(() => {
    ask();
  }, [ask, who]);

  if (ALWAYS.includes(pathname.replace(/\/+$/, '') || '/')) return children;
  if (gate === null) return <div className="wrap page-pad"><span className="t2 small" role="status">Loading…</span></div>;
  if (gate === 'off' || gate === 'allowed') return children;
  return <DevGatePage gate={gate} onRetry={ask} />;
}

export function DevGatePage({ gate, onRetry }) {
  const session = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await api('/api/auth/sign-out', { method: 'POST', body: {} });
      await session.refresh();
      navigate('/sign-in');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wrap page-pad narrow-wrap stack gap-20">
      <h1 className="h1" tabIndex={-1}>This is Everstats’ private test site</h1>
      <p className="t2">
        New versions of Everstats are tried out here before they reach everyone at <a href="https://everstats.app">everstats.app</a>.
        Only accounts that test Everstats can use it.
      </p>
      {gate === 'sign-in' && (
        <div className="stack gap-12">
          <p>Sign in with the Battle.net or Discord account you use on everstats.app, or with a passkey.</p>
          <div><Link className="btn gold" to="/sign-in">Sign in</Link></div>
        </div>
      )}
      {gate === 'denied' && (
        <div className="stack gap-12">
          <p>Your account isn’t one of the testers. If you think it should be, ask Everstats staff.</p>
          <div><button type="button" className="btn ghost" onClick={signOut} disabled={busy}>Sign out</button></div>
        </div>
      )}
      {gate === 'unavailable' && (
        <div className="stack gap-12">
          <EmptyState kind="couldnt" compact title="Production couldn’t be asked">
            <span>This site checks with everstats.app whether your account is a tester, and it didn’t answer. Nobody gets in until it does. Try again in a minute.</span>
          </EmptyState>
          <div className="row gap-8">
            <button type="button" className="btn gold" onClick={onRetry}>Try again</button>
            {session?.signedIn && <button type="button" className="btn ghost" onClick={signOut} disabled={busy}>Sign out</button>}
          </div>
        </div>
      )}
    </div>
  );
}
