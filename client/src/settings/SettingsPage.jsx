import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { authError } from '../authMessages.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { startProvider } from '../pages/SignInPages.jsx';
import { passkeyRegister, passkeySignIn, passkeysSupported, wasCancelled } from '../passkeyClient.js';
import { useSession } from '../session.jsx';
import '../pages/pages.css';

export const THEMES = [
  { id: 'forever', name: 'Forever', blurb: 'Twilight blue, gold and white' },
  { id: 'alliance', name: 'Alliance', blurb: 'Royal blue, gold trim, parchment' },
  { id: 'horde', name: 'Horde', blurb: 'Crimson and charcoal, bronze and ember' },
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null);

export function SettingsPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const notice = params.get('linked') ? { kind: 'success', text: 'Linked. You can now sign in with it too.' } : params.get('error') ? { kind: 'danger', text: authError(params.get('error')) } : null;

  const load = useCallback(async () => {
    try {
      setAccount((await api('/api/account')).account);
    } catch (err) {
      if (err.status !== 401) setLoadError(err.message);
    }
  }, []);
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn, load]);

  if (session.loading) return <div className="page-head"><h1>Settings</h1></div>;

  if (!session.signedIn) {
    return (
      <>
        <div className="page-head">
          <h1>Settings</h1>
          <p className="muted">Settings belong to an account. Everything public works without one.</p>
        </div>
        <ThemeSection current="forever" disabled />
        <p><Link to="/sign-in" className="btn btn-primary">Sign in</Link></p>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        {account && <p className="faint">Account #{account.id} · since {fmt(account.createdAt)}</p>}
      </div>
      {notice && (
        <div className={`notice notice-${notice.kind} row-between`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>Dismiss</button>
        </div>
      )}
      {loadError && <p className="notice notice-danger">{loadError}</p>}
      <ThemeSection current={session.theme} onChange={session.setTheme} />
      {account && (
        <>
          <MethodsSection account={account} providers={session.providers} onChange={setAccount} />
          <PasskeysSection account={account} onChange={setAccount} />
          <TwoFactorSection account={account} onChange={setAccount} />
          <CharactersSection account={account} />
          <MergeSection providers={session.providers} />
        </>
      )}
      <SignOut />
    </>
  );
}

function ThemeSection({ current, onChange, disabled = false }) {
  const [problem, setProblem] = useState(null);
  const choose = async (id) => {
    const before = current;
    onChange(id);
    try {
      await api('/api/account/theme', { method: 'PUT', body: { theme: id } });
      setProblem(null);
    } catch (err) {
      onChange(before);
      setProblem(err.message);
    }
  };
  return (
    <section className="panel" aria-labelledby="theme-h">
      <div className="panel-head">
        <h2 id="theme-h">Theme</h2>
        {disabled && <span className="chip">Signed-in accounts only</span>}
      </div>
      {disabled && <p className="muted">Visitors always see Forever. Sign in to choose a theme; it follows your account to every device.</p>}
      <div className="choices" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            className="choice"
            aria-checked={current === t.id}
            disabled={disabled}
            onClick={() => choose(t.id)}
          >
            <span className="swatch" data-theme={t.id} aria-hidden="true">
              <span className="sw-bg" /><span className="sw-surface" /><span className="sw-accent" /><span className="sw-highlight" />
            </span>
            <span className="display">{t.name}</span>
            <span className="faint">{t.blurb}</span>
          </button>
        ))}
      </div>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </section>
  );
}

function MethodsSection({ account, providers, onChange }) {
  const [problem, setProblem] = useState(null);
  const linked = new Set(account.identities.map((i) => i.provider));
  const unlink = async (id) => {
    try {
      onChange((await api(`/api/account/identities/${id}`, { method: 'DELETE' })).account);
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  };
  const link = async (id) => {
    try {
      await startProvider(id, 'link', '/settings');
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <section className="panel" aria-labelledby="methods-h">
      <div className="panel-head"><h2 id="methods-h">Sign-in providers</h2></div>
      <ul className="list">
        {account.identities.map((i) => (
          <li key={i.id} className="list-item">
            <span className="list-item-main">
              <span>{i.label} <span className="chip chip-success">Linked</span></span>
              <span className="faint">{i.displayName || 'No display name'} · linked {fmt(i.linkedAt)}</span>
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => unlink(i.id)}>Unlink</button>
          </li>
        ))}
        {providers.filter((p) => !linked.has(p.id)).map((p) => (
          <li key={p.id} className="list-item">
            <span className="list-item-main"><span>{p.label}</span><span className="faint">Not linked</span></span>
            {p.configured
              ? <button type="button" className="btn btn-sm" onClick={() => link(p.id)}>Link {p.label}</button>
              : <span className="chip">Not set up yet</span>}
          </li>
        ))}
      </ul>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </section>
  );
}

function PasskeysSection({ account, onChange }) {
  const [problem, setProblem] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await passkeyRegister('/api/account/passkeys/options', '/api/account/passkeys/verify', { verifyBody: { name } });
      onChange(r.account);
      setName('');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setBusy(false);
  };
  const remove = async (id) => {
    try {
      onChange((await api(`/api/account/passkeys/${id}`, { method: 'DELETE' })).account);
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <section className="panel" aria-labelledby="passkeys-h">
      <div className="panel-head"><h2 id="passkeys-h">Passkeys</h2></div>
      <p className="muted">Sign in with your device's fingerprint, face or PIN. A passkey sign-in doesn't ask for a 2FA code.</p>
      {account.passkeys.length === 0 ? (
        <EmptyState kind="nodata" title="No passkeys on this account" />
      ) : (
        <ul className="list">
          {account.passkeys.map((p) => (
            <li key={p.id} className="list-item">
              <span className="list-item-main"><span>{p.name}</span><span className="faint">Added {fmt(p.createdAt)}{p.lastUsedAt ? ` · last used ${fmt(p.lastUsedAt)}` : ' · never used'}</span></span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(p.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {passkeysSupported() ? (
        <div className="row">
          <div className="field">
            <label htmlFor="pk-name">Name (optional)</label>
            <input id="pk-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. My phone" />
          </div>
          <button type="button" className="btn" onClick={add} aria-disabled={busy}>{busy ? 'Waiting for your device…' : 'Add a passkey'}</button>
        </div>
      ) : (
        <p className="faint">This browser doesn't support passkeys.</p>
      )}
      {problem && <p className="notice notice-danger">{problem}</p>}
    </section>
  );
}

function TwoFactorSection({ account, onChange }) {
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(null);
  const on = account.twoFactor.state === 'on';

  const act = (fn) => async (e) => {
    e?.preventDefault();
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const begin = act(async () => setSetup((await api('/api/account/2fa/setup', { method: 'POST', body: {} })).setup));
  const enable = act(async () => {
    const r = await api('/api/account/2fa/enable', { method: 'POST', body: { code } });
    setCodes(r.recoveryCodes);
    setSetup(null);
    setCode('');
    onChange(r.account);
  });
  const disable = act(async () => {
    const r = await api('/api/account/2fa/disable', { method: 'POST', body: { code } });
    setCode('');
    onChange(r.account);
  });
  const regenerate = act(async () => {
    const r = await api('/api/account/2fa/recovery-codes', { method: 'POST', body: { code } });
    setCodes(r.recoveryCodes);
    setCode('');
    onChange(r.account);
  });

  return (
    <section className="panel" aria-labelledby="tfa-h">
      <div className="panel-head">
        <h2 id="tfa-h">Two-factor authentication</h2>
        <span className={`chip ${on ? 'chip-success' : ''}`}>{on ? `On since ${fmt(account.twoFactor.enabledAt)}` : 'Off'}</span>
      </div>
      <p className="muted">With 2FA on, signing in with Battle.net or Discord also asks for a code from an authenticator app. Passkey sign-ins don't.</p>

      {codes && (
        <div className="parchment stack" role="status">
          <strong>Your recovery codes. This is the only time they are shown.</strong>
          <span>Each one works once if you lose your authenticator. Save them somewhere safe now.</span>
          <ul className="list codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy all</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCodes(null)}>I've saved them</button>
          </div>
        </div>
      )}

      {!on && !setup && <div><button type="button" className="btn" onClick={begin}>Turn on 2FA</button></div>}

      {!on && setup && (
        <form className="stack" onSubmit={enable}>
          <div className="row">
            <img className="qr" src={setup.qr} alt="QR code for your authenticator app" />
            <div className="stack">
              <span>Scan this with your authenticator app, or enter the key by hand:</span>
              <code className="mono">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="tfa-code">Code from the app</label>
              <input id="tfa-code" className="input input-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
            </div>
            <button type="submit" className="btn btn-primary">Turn on</button>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>Cancel</button>
          </div>
        </form>
      )}

      {on && (
        <form className="stack" onSubmit={(e) => e.preventDefault()}>
          <p className="faint">{account.twoFactor.recoveryCodesLeft} of 10 recovery codes left.</p>
          <div className="row">
            <div className="field">
              <label htmlFor="tfa-current">Current code (or a recovery code)</label>
              <input id="tfa-current" className="input input-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={11} />
            </div>
            <button type="button" className="btn" onClick={regenerate}>New recovery codes</button>
            <button type="button" className="btn btn-danger" onClick={disable}>Turn off 2FA</button>
          </div>
        </form>
      )}
      {problem && <p className="notice notice-danger">{problem}</p>}
    </section>
  );
}

function CharactersSection({ account }) {
  const hasBnet = account.identities.some((i) => i.provider === 'battlenet');
  return (
    <section className="panel" aria-labelledby="chars-h">
      <div className="panel-head"><h2 id="chars-h">Your characters</h2></div>
      <EmptyState kind="nodata" title="You haven't added any characters" />
      <EmptyState kind="soon" title="Add all your Forever characters at once">
        <span>{hasBnet ? 'Your Battle.net login will be able to list every Forever character on your account.' : 'Link Battle.net above, and it will be able to list every Forever character on your account.'}</span>
      </EmptyState>
    </section>
  );
}

function MergeSection({ providers }) {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const viaProvider = async (id) => {
    try {
      await startProvider(id, 'merge', '/settings/merge');
    } catch (err) {
      setProblem(err.message);
    }
  };
  const viaPasskey = async () => {
    try {
      const r = await passkeySignIn('/api/auth/passkey/options', '/api/auth/passkey/verify', { intent: 'merge' });
      navigate(r.next);
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
  };
  return (
    <section className="panel" aria-labelledby="merge-h">
      <div className="panel-head"><h2 id="merge-h">Merge into another account</h2></div>
      <p className="muted">Made a second account by signing in with a provider you hadn't linked? Prove the account you want to keep by signing in to it here; this account's logins and passkeys move into it, and this account is deleted.</p>
      <div className="row">
        {providers.filter((p) => p.configured).map((p) => (
          <button key={p.id} type="button" className="btn btn-sm" onClick={() => viaProvider(p.id)}>Sign in to the other account with {p.label}</button>
        ))}
        {passkeysSupported() && <button type="button" className="btn btn-sm" onClick={viaPasskey}>…with its passkey</button>}
      </div>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </section>
  );
}

function SignOut() {
  const session = useSession();
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" className="btn btn-ghost" onClick={async () => { await api('/api/auth/sign-out', { method: 'POST', body: {} }); await session.refresh(); navigate('/'); }}>
        Sign out
      </button>
    </div>
  );
}
