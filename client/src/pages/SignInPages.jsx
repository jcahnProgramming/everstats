import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { authError } from '../authMessages.js';
import { KeyIcon, ShieldIcon } from '../chrome/icons.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { passkeySignIn, passkeysSupported, wasCancelled } from '../passkeyClient.js';
import { useSession } from '../session.jsx';
import './pages.css';

/** Starts an OAuth round trip: the server answers the provider's URL and the page goes there. */
export async function startProvider(providerId, intent, returnTo) {
  const { url } = await api(`/api/auth/${providerId}/start`, { method: 'POST', body: { intent, returnTo } });
  window.location.assign(url);
}

export function SignInPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [problem, setProblem] = useState(authError(params.get('error')));
  const [busy, setBusy] = useState(null);
  const next = params.get('next') || '/';

  if (session.signedIn) {
    return (
      <>
        <div className="page-head"><h1>You're signed in</h1></div>
        <p className="muted"><Link to="/settings">Go to Settings</Link> to link another provider or add a passkey.</p>
      </>
    );
  }

  const configured = session.providers.filter((p) => p.configured);
  const go = async (id) => {
    setBusy(id);
    setProblem(null);
    try {
      await startProvider(id, 'sign_in', next);
    } catch (err) {
      setProblem(err.message);
      setBusy(null);
    }
  };
  const withPasskey = async () => {
    setBusy('passkey');
    setProblem(null);
    try {
      const r = await passkeySignIn('/api/auth/passkey/options', '/api/auth/passkey/verify');
      await session.refresh();
      navigate(r.next ?? '/');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
      setBusy(null);
    }
  };

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Sign in</h1>
        <p className="muted">Accounts are optional: everything public works without one. Signing in lets you choose a theme and, soon, add your characters.</p>
      </div>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}

      {!session.loading && configured.length === 0 && (
        <EmptyState kind="soon" title="Sign-in isn't set up yet">
          <span>Battle.net and Discord sign-in switch on once the site's keys are entered. Nothing is broken; it just isn't open yet.</span>
        </EmptyState>
      )}

      <div className="signin-options">
        {session.providers.map((p) => (
          p.configured ? (
            <button key={p.id} type="button" className="btn btn-primary" onClick={() => go(p.id)} aria-disabled={busy !== null}>
              <ShieldIcon size={18} /> {busy === p.id ? 'Opening…' : `Continue with ${p.label}`}
            </button>
          ) : (
            <p key={p.id} className="list-item"><span>{p.label}</span><span className="chip">Not set up yet</span></p>
          )
        ))}
        {passkeysSupported() && (
          <button type="button" className="btn" onClick={withPasskey} aria-disabled={busy !== null}>
            <KeyIcon size={18} /> {busy === 'passkey' ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
          </button>
        )}
      </div>

      <div className="panel-sub stack">
        <p className="faint">Your first sign-in with Battle.net or Discord creates your account. Passkeys are added from Settings once you're in, and skip the 2FA code.</p>
        <p className="faint">Already have an account through the other provider? Sign in with that one and link this one from Settings. Signing in with a provider that isn't linked makes a separate account.</p>
      </div>
    </div>
  );
}

export function SecondFactorPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!session.loading && session.stage !== 'second_factor') {
    return (
      <div className="stack narrow">
        <div className="page-head"><h1>Two-factor code</h1></div>
        <EmptyState kind="nodata" title="No sign-in is waiting for a code">
          <span>It may have expired (you have 10 minutes). <Link to="/sign-in">Sign in again</Link>.</span>
        </EmptyState>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api('/api/auth/second-factor', { method: 'POST', body: { code } });
      await session.refresh();
      navigate(target);
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="stack narrow" onSubmit={submit}>
      <div className="page-head">
        <h1>Two-factor code</h1>
        <p className="muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      </div>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      <div className="field">
        <label htmlFor="code">Code</label>
        <input id="code" className="input input-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" maxLength={11} readOnly={busy} />
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" aria-disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" className="btn btn-ghost" onClick={async () => { await api('/api/auth/sign-out', { method: 'POST', body: {} }); await session.refresh(); navigate('/'); }}>Cancel sign-in</button>
      </div>
    </form>
  );
}
