import { useEffect, useState } from 'react';
import { Link } from '../scope.jsx';
import { api } from '../api.js';
import { formatNumber } from '../format.js';
import { startProvider } from '../pages/SignInPages.jsx';
import { useSession } from '../session.jsx';
import { Icon } from './Icon.jsx';
import { providerUsable } from '../features.js';

// 0.10.3: why a provider's button is disabled: no keys yet, or its feature switch is off.
const notUsable = (p) => (p?.configured ? 'switched off for now' : 'not configured');

/**
 * Giving signed-out visitors a reason to sign in (0.8.0), without nagging: no modal, nothing blocked, everything stays
 * readable without an account. Signed-in players never see any of it.
 *
 *   <WhySignIn>      the home page section: the live benefits (GET /api/why-sign-in; their wording lives in ONE place,
 *                    server/signin/benefits.js, and each shows only while its feature is live), big Battle.net and
 *                    Discord buttons, and the real counts of tracked characters and guilds (exact, never rounded up).
 *   <SignInNudge>    the small, dismissible note on character and guild pages ("Is this your character?"). Dismissing
 *                    is a per-viewer convenience in localStorage (wrapped: a blocked store just means it shows again).
 */
const readDismissed = (key) => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeDismissed = (key) => {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* private mode: it shows again next time, which is fine */
  }
};

export function WhySignIn() {
  const session = useSession();
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/why-sign-in').then((d) => { if (live) setData(d); }, () => {});
    return () => {
      live = false;
    };
  }, []);
  if (session.loading || session.signedIn || session.stage === 'second_factor' || !data) return null;
  const bnet = session.providers.find((p) => p.id === 'battlenet');
  const discord = session.providers.find((p) => p.id === 'discord');
  const start = (id) => startProvider(id, 'sign_in', '/').catch(() => {});
  return (
    <section className="wrap stack gap-18 why-sign-in" aria-labelledby="why-sign-in-h">
      <div className="orn"><span className="gem" /><h2 className="h2" id="why-sign-in-h">Why sign in?</h2><span className="rule" /></div>
      <div className="panel pad-24 stack gap-20">
        <ul className="plain grid-auto col-md gap-14 why-list">
          {data.benefits.map((b) => (
            <li key={b.id} className="row gap-10 align-start">
              <span className="why-check" aria-hidden="true"><Icon name="check" size="sm" /></span>
              <span className="stack gap-2"><b className="strong-text">{b.title}</b><span className="t2 small">{b.text}</span></span>
            </li>
          ))}
        </ul>
        <div className="row gap-12 wrap-row">
          {providerUsable(bnet)
            ? <button type="button" className="btn gold lg" onClick={() => start('battlenet')}>Sign in with Battle.net</button>
            : <button type="button" className="btn lg" disabled>Battle.net: {notUsable(bnet)}</button>}
          {providerUsable(discord)
            ? <button type="button" className="btn lg" onClick={() => start('discord')}>Sign in with Discord</button>
            : <button type="button" className="btn lg" disabled>Discord: {notUsable(discord)}</button>}
        </div>
        <span className="t2 small">{data.note} Everything here stays readable without an account.</span>
        <span className="muted xsmall">
          <b className="strong-text">{formatNumber(data.counts.characters)}</b> character{data.counts.characters === 1 ? '' : 's'} and <b className="strong-text">{formatNumber(data.counts.guilds)}</b> guild{data.counts.guilds === 1 ? '' : 's'} tracked so far.
        </span>
      </div>
    </section>
  );
}

/** The small note on a page. `id` keys the dismissal (one per kind of page, not per character). */
export function SignInNudge({ id, icon = 'user', returnTo, children }) {
  const session = useSession();
  const key = `es.nudge.${id}`;
  const [hidden, setHidden] = useState(() => readDismissed(key));
  if (hidden || session.loading || session.signedIn || session.stage === 'second_factor') return null;
  const bnet = session.providers.find((p) => p.id === 'battlenet');
  return (
    <div className="note gold signup-call" role="note">
      <Icon name={icon} />
      <span className="flex-fill">{children}</span>
      {providerUsable(bnet)
        ? <button type="button" className="btn sm gold" onClick={() => startProvider('battlenet', 'sign_in', returnTo).catch(() => {})}>Sign in with Battle.net</button>
        : <Link className="btn sm" to="/sign-in">Sign in</Link>}
      <button type="button" className="btn ghost sm icon" aria-label="Dismiss" title="Dismiss" onClick={() => { writeDismissed(key); setHidden(true); }}><Icon name="close" size="sm" /></button>
    </div>
  );
}
