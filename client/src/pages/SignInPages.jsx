import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { WebAuthnAbortService } from '@simplewebauthn/browser';
import { api } from '../api.js';
import { authError } from '../authMessages.js';
import { BrandMark } from '../chrome/BrandMark.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Spinner } from '../components/Stats.jsx';
import { passkeySignIn, passkeysSupported, wasCancelled } from '../passkeyClient.js';
import { useSession } from '../session.jsx';
import { OFF_WORDS, providerUsable } from '../features.js';

/** Starts an OAuth round trip: the server answers the provider's URL and the page goes there. */
export async function startProvider(providerId, intent, returnTo) {
  const { url } = await api(`/api/auth/${providerId}/start`, { method: 'POST', body: { intent, returnTo } });
  window.location.assign(url);
}

/** "Battle.net or Discord", from the provider registry (never a list typed here). */
export const providerNames = (providers, joiner = 'or') => {
  const labels = providers.map((p) => p.label);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} ${joiner} ${labels.at(-1)}`;
};

/**
 * What to say when a passkey sign-in ends without signing in. Browsers deliberately report "no passkey for this
 * site" and "you cancelled" the same way (NotAllowedError), so the page can't tell them apart and says both.
 * A passkey the server doesn't know (an admin passkey, one removed in Settings) gets its own first line.
 */
function noPasskeyNote(providers, unknown) {
  const names = providerNames(providers) || 'a sign-in provider';
  return {
    title: `No passkey yet — sign in with ${names}, then add one in Settings.`,
    detail: unknown
      ? "The passkey your browser offered isn't on an Everstats account. (The admin passkey and passkeys removed in Settings don't work here.)"
      : "If you have added one, your browser didn't offer it: try again, or use the device it's saved on.",
  };
}

/**
 * Sign in (design/v1/pages/sign-in, plus states/sign-in-not-configured).
 *
 *   providers   one button each, from the provider registry (/api/session). A provider without keys is a disabled
 *               button saying "Not configured": "isn't set up yet" is said about providers only, never passkeys.
 *   passkey     always offered when the browser supports passkeys: passkeys ARE set up; they're added from Settings
 *               once an account exists. While the browser's prompt is open the card shows "Waiting for your passkey".
 */
export function SignInPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [problem, setProblem] = useState(authError(params.get('error')));
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const next = params.get('next') || '/';

  // 0.8.2: a banned sign-in has only its notice.
  if (session.stage === 'banned') return <Navigate to="/banned" replace />;
  if (session.signedIn) {
    return (
      <AuthCard>
        <CardHead title="You're signed in" />
        <Link className="btn gold lg" to="/settings">Go to account settings</Link>
        <p className="muted xsmall center-text">Link another provider or add a passkey there.</p>
      </AuthCard>
    );
  }

  const providers = session.providers ?? [];
  const configured = providers.filter((p) => p.configured);
  const go = async (id) => {
    setBusy(id);
    setProblem(null);
    setNote(null);
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
    setNote(null);
    try {
      const r = await passkeySignIn('/api/auth/passkey/options', '/api/auth/passkey/verify');
      await session.refresh();
      navigate(r.next ?? '/');
    } catch (err) {
      if (wasCancelled(err)) setNote(noPasskeyNote(providers, false));
      else if (err.code === 'passkey_failed') setNote(noPasskeyNote(providers, true));
      else setProblem(err.message);
      setBusy(null);
    }
  };
  const cancelPasskey = () => {
    WebAuthnAbortService.cancelCeremony();
    setBusy(null);
  };

  if (busy === 'passkey') {
    return (
      <AuthCard>
        <div className="stack gap-14 center-text passkey-wait">
          <Spinner size="xxxl" />
          <h1 className="h2 h2-wait" role="status">Waiting for your passkey</h1>
          <p className="t2 small">Follow your browser's prompt. No code needed — passkeys skip two-factor.</p>
          <button type="button" className="btn ghost sm" onClick={cancelPasskey}>Cancel</button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <CardHead title="Sign in" mark>
        <p className="t2 small">Optional — every page is public. Signing in lets you choose a theme, and soon, highlights your own characters on the boards.</p>
      </CardHead>

      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      {session.error && (
        <div className="note err small" role="alert"><Icon name="error" /><span>Couldn't check which sign-in methods are available: {session.error}</span></div>
      )}
      {!session.loading && !session.error && providers.length > 0 && configured.length === 0 && (
        <div className="note warn small"><Icon name="warning" /><span>{providerNames(providers)} sign-in isn't set up yet, so new accounts can't be made. Every character, statistic and leaderboard works without one.</span></div>
      )}

      <div className="stack gap-10">
        {providers.map((p) => (
          providerUsable(p) ? (
            <Button key={p.id} className="lg left" loading={busy === p.id} disabled={busy !== null && busy !== p.id} onClick={() => go(p.id)}>
              <Icon name="provider-account" size="md" />
              <span className="flex-fill left-text">Continue with {p.label}</span>
            </Button>
          ) : (
            <button key={p.id} type="button" className="btn lg between" disabled>
              <span>Continue with {p.label}</span><span className="muted xsmall">{p.configured ? OFF_WORDS.discord : 'Not configured'}</span>
            </button>
          )
        ))}
        {passkeysSupported() ? (
          <>
            {providers.length > 0 && <div className="orn or-rule"><span className="rule" /><span className="muted xsmall">or</span><span className="rule" /></div>}
            <button type="button" className="btn gold lg" onClick={withPasskey} disabled={busy !== null}>
              <Icon name="passkey" size="md" />Sign in with a passkey
            </button>
            <span className="muted xsmall center-text">Passkeys are added from Account settings after your first sign-in.</span>
          </>
        ) : (
          <span className="muted xsmall center-text">This browser doesn't support passkeys.</span>
        )}
      </div>

      {note && (
        <div className="note small" role="status">
          <Icon name="info" />
          <div className="stack gap-4"><b>{note.title}</b><span>{note.detail}</span></div>
        </div>
      )}

      <p className="muted xsmall center-text">
        Your first sign-in with {providerNames(providers) || 'a provider'} creates your account. Already have one through
        another provider? Sign in with that one and link this one from Settings.
      </p>
    </AuthCard>
  );
}

/**
 * The 2FA step (design/v1/pages/sign-in-2fa) after a Battle.net / Discord sign-in on an account with 2FA on.
 * "Use a recovery code instead" swaps the input's format; the server accepts either in the same field.
 *
 * Left out from the design, on purpose: "Trust this browser for 30 days" (it would let a sign-in skip 2FA, an auth
 * change this pass doesn't make) and its proposed 60-second cooldown (the real limit is the server's: 5 wrong codes
 * per account and 10 per network in 15 minutes, and its message is shown as it comes).
 */
export function SecondFactorPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const cancel = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} });
    await session.refresh();
    navigate('/sign-in');
  };

  if (!session.loading && session.stage !== 'second_factor') {
    return (
      <AuthCard>
        <CardHead title="Two-factor code" />
        <EmptyState kind="nodata" compact title="No sign-in is waiting for a code">
          <span>It may have expired (you have 10 minutes). <Link to="/sign-in">Sign in again</Link>.</span>
        </EmptyState>
      </AuthCard>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await api('/api/auth/second-factor', { method: 'POST', body: { code } });
      await session.refresh();
      navigate(r.next ?? target);
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <form className="stack gap-22" onSubmit={submit} noValidate>
        <div className="stack gap-8">
          <span className="eyebrow">Step 2 of 2 · Sign-in verified</span>
          <h1 className="h1 h1-auth">Two-factor code</h1>
          <p className="t2 small">{recovery ? 'Enter one of your recovery codes. Each one works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        </div>
        <Field
          key={recovery ? 'recovery' : 'otp'}
          label={recovery ? 'Recovery code' : 'Authentication code'}
          inputClassName="otp-lg"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={recovery ? 'XXXX-XXXX' : '000 000'}
          maxLength={recovery ? 11 : 7}
          readOnly={busy}
          error={problem}
          help={recovery ? null : 'Codes refresh every 30 seconds.'}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <Button type="submit" className="gold lg" loading={busy}>Verify and sign in</Button>
        <div className="row gap-8 small between">
          <button type="button" className="btn ghost sm" onClick={cancel}><Icon name="arrow-left" size="sm" />Other method</button>
          <button type="button" className="linklike" onClick={() => { setRecovery((r) => !r); setCode(''); setProblem(null); }}>
            {recovery ? 'Use the authenticator code' : 'Use a recovery code instead'}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}

/** The centred gilt card both sign-in steps sit on. */
export function AuthCard({ children }) {
  return (
    <div className="auth-page">
      <div className="sheet stack gap-22 auth-card">{children}</div>
    </div>
  );
}

function CardHead({ title, mark = false, children }) {
  return (
    <div className="stack gap-8 center-text auth-head">
      {mark && <span className="auth-mark"><BrandMark /></span>}
      <h1 className="h1 h1-auth">{title}</h1>
      {children}
    </div>
  );
}
