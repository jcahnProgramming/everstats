import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { useEditing } from '../chrome/updates.js';
import { Button, Modal } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * The player's side of moderation (0.8.2; server/moderation/player.js):
 *   BannedPage    /banned: what a sign-in to a banned account sees, and the only thing it can do (appeal, sign out)
 *   NoticeGate    warnings and other moderation notes, shown once on the next page load, acknowledged
 *   ReportButton  "Report" on a profile or a guild's description: what's wrong + an optional note, honeypot
 * Every word here says plainly what happened and why, never who did it ("Everstats").
 */
const untilWords = (ban) => (ban.permanent ? 'This ban is permanent.' : `It ends on ${formatDateTime(ban.until)}.`);

export function BannedPage() {
  const session = useSession();
  const toast = useToasts();
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  useEditing(message.trim().length > 0);
  const banned = session.stage === 'banned';
  useEffect(() => {
    if (!banned) return;
    api('/api/banned').then(setData, (err) => setProblem(err.message));
  }, [banned]);

  if (session.loading) return <div className="wrap page-pad"><span className="t2 small" role="status">Loading…</span></div>;
  if (!banned) {
    if (session.signedIn) return <Navigate to="/" replace />;
    return (
      <div className="wrap page-pad narrow-wrap stack gap-20">
        <h1 className="h1">No ban to show</h1>
        <EmptyState kind="nodata" title={session.banEnded ? 'Your ban has ended' : 'You’re not signed in to a banned account'}>
          <span>{session.banEnded ? 'Sign in again to use your account as before.' : 'This page shows a ban notice after signing in to a banned account.'} <Link to="/sign-in">Sign in</Link></span>
        </EmptyState>
      </div>
    );
  }
  const ban = data?.ban ?? session.ban;
  const appeal = data?.appeal ?? null;
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await api('/api/banned/appeal', { method: 'POST', body: { message, website } });
      setData((d) => ({ ...d, appeal: r.appeal ?? d?.appeal ?? null }));
      setMessage('');
      toast.ok('Appeal sent', 'Everstats reads every appeal. Any answer shows on this page.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} });
    await session.refresh();
  };
  return (
    <div className="wrap page-pad narrow-wrap stack gap-24">
      <h1 className="h1">Your account is banned</h1>
      <section className="panel pad-20 stack gap-12 ban-notice" aria-labelledby="ban-why">
        <div className="row gap-10"><Icon name="lock" /><b id="ban-why">{ban.permanent ? 'Banned permanently' : 'Banned for now'}</b></div>
        <p className="t2">Everstats banned this account on {formatDateTime(ban.since)}. {untilWords(ban)}</p>
        <div className="stack gap-4"><span className="eyebrow">Why</span><p className="fb-body">{ban.reason}</p></div>
        {ban.message && <div className="stack gap-4"><span className="eyebrow">Message from Everstats</span><p className="fb-body">{ban.message}</p></div>}
        <p className="muted small">While the ban lasts, your profile, bio, social links and badges aren’t shown to anyone, and you can’t use the signed-in parts of Everstats. Nothing has been deleted: your characters stay on their pages and the leaderboards as Blizzard’s data, and everything else comes back as it was when the ban ends or is lifted.</p>
      </section>
      <section className="panel pad-20 stack gap-14" aria-labelledby="appeal-h">
        <h2 className="h3" id="appeal-h">Appeal</h2>
        {appeal?.messages?.length > 0 && (
          <ol className="plain stack gap-10 fb-messages">
            {appeal.messages.map((m) => (
              <li key={m.id} className={`fb-msg ${m.author}`}>
                <span className="eyebrow">{m.author === 'everstats' ? 'Everstats' : 'You'} · {formatDateTime(m.at)}</span>
                <p className="fb-body">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="t2 small">{appeal ? 'Add to your appeal. Answers from Everstats show here.' : 'If you think this is a mistake, or you’ve fixed what it was about, say so here. Everstats reads every appeal; any answer shows on this page.'}</p>
        <form className="stack gap-10" onSubmit={send}>
          <label className="lbl" htmlFor="appeal-msg">Your appeal</label>
          <textarea id="appeal-msg" className="inp" rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="hp" aria-hidden="true">
            <label htmlFor="appeal-website">Website</label>
            <input id="appeal-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
          <div className="row gap-8 wrap-row">
            <Button type="submit" className="gold" loading={busy} disabled={message.trim().length < 10}>Send appeal</Button>
            <span className="muted xsmall">At least 10 characters. Plain text.</span>
          </div>
        </form>
      </section>
      <button type="button" className="btn ghost self-start" onClick={signOut}>Sign out</button>
    </div>
  );
}

/** The slim note under the top bar while a banned sign-in browses the public site. */
export function BannedStrip() {
  const session = useSession();
  const { pathname } = useLocation();
  if (session.stage !== 'banned' || pathname === '/banned') return null;
  return (
    <div className="update-bar ban-strip" role="status">
      <div className="wrap in">
        <Icon name="lock" size="sm" />
        <span className="flex-fill">This account is banned{session.ban?.permanent ? '' : ` until ${formatDateTime(session.ban?.until)}`}.</span>
        <Link className="btn sm" to="/banned">Ban notice and appeal</Link>
      </div>
    </div>
  );
}

/** Warnings and other moderation notes: one at a time, until acknowledged (closing the dialog counts). Never over the admin area. */
export function NoticeGate() {
  const session = useSession();
  const { pathname } = useLocation();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const count = session.signedIn ? session.notices ?? 0 : 0;
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  useEffect(() => {
    if (!count) {
      setList(null);
      return;
    }
    api('/api/account/notices').then((r) => setList(r.notices), () => setList([]));
  }, [count]);
  if (inAdmin || !list?.length) return null;
  const n = list[0];
  const ack = async () => {
    setBusy(true);
    await api(`/api/account/notices/${n.id}/ack`, { method: 'POST', body: {} }).catch(() => {});
    setBusy(false);
    if (list.length > 1) setList(list.slice(1));
    else await session.refresh();
  };
  return (
    <Modal title={n.title} busy={busy} onClose={ack} actions={<Button className="gold" loading={busy} onClick={ack}>I understand</Button>}>
      <div className="stack gap-12">
        <p className="t2">{n.text}</p>
        {n.reason && <div className="stack gap-4"><span className="eyebrow">Why</span><p className="fb-body">{n.reason}</p></div>}
        {n.message && <div className="stack gap-4"><span className="eyebrow">Message from Everstats</span><p className="fb-body">{n.message}</p></div>}
        <p className="muted xsmall">{formatDateTime(n.at)}{list.length > 1 ? ` · ${list.length - 1} more after this` : ''}. Questions? Use Feedback at the bottom of any page.</p>
      </div>
    </Modal>
  );
}

const WHAT = [
  { id: 'username', label: 'Their username' },
  { id: 'display_name', label: 'Their display name' },
  { id: 'bio', label: 'Their bio' },
  { id: 'social', label: 'A social handle' },
  { id: 'badges', label: 'Badge misuse' },
  { id: 'other', label: 'Something else' },
];

/**
 * "Report": a profile (whom = '@name', socials = the handles on it) or a guild's description (guild = slug). Signed-in
 * and signed-out visitors alike. The reported person never learns who reported them: Everstats doesn't keep it.
 */
export function ReportButton({ username = null, guild = null, socials = [], label = 'Report' }) {
  const toast = useToasts();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState(guild ? 'guild_description' : null);
  const [platform, setPlatform] = useState(null);
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  useEditing(open && (note.trim().length > 0 || (what !== null && !guild)));
  const close = () => {
    setOpen(false);
    setProblem(null);
  };
  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const path = guild ? `/api/guilds/${encodeURIComponent(guild)}/report` : `/api/users/${encodeURIComponent(username)}/report`;
      await api(path, { method: 'POST', body: guild ? { note, website } : { what, platform, note, website } });
      setOpen(false);
      setNote('');
      setWhat(guild ? 'guild_description' : null);
      setPlatform(null);
      toast.ok('Report sent', 'Thanks. Everstats looks at every report. Nobody is told who sent it.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  const ready = guild ? true : what && (what !== 'social' || platform);
  return (
    <>
      <button type="button" className="btn ghost sm report-btn" onClick={() => setOpen(true)}><Icon name="warning" size="sm" />{label}</button>
      {open && (
        <Modal title={guild ? 'Report this guild’s description' : `Report @${username}`} busy={busy} onClose={close}
          actions={<><button type="button" className="btn ghost" onClick={close}>Cancel</button><Button className="gold" loading={busy} disabled={!ready} onClick={send}>Send report</Button></>}>
          <div className="stack gap-14">
            {!guild && (
              <fieldset className="stack gap-8 plain-fieldset">
                <legend className="lbl">What’s wrong?</legend>
                <div className="radio-list" role="radiogroup" aria-label="What’s wrong?">
                  {WHAT.filter((w) => w.id !== 'social' || socials.length > 0).map((w) => (
                    <button key={w.id} type="button" role="radio" aria-checked={what === w.id} className={`btn sm ${what === w.id ? 'gold' : 'ghost'} left`} onClick={() => { setWhat(w.id); if (w.id !== 'social') setPlatform(null); }}>{w.label}</button>
                  ))}
                </div>
              </fieldset>
            )}
            {what === 'social' && (
              <fieldset className="stack gap-8 plain-fieldset">
                <legend className="lbl">Which handle?</legend>
                <div className="radio-list" role="radiogroup" aria-label="Which handle?">
                  {socials.map((s) => (
                    <button key={s.platform} type="button" role="radio" aria-checked={platform === s.platform} className={`btn sm ${platform === s.platform ? 'gold' : 'ghost'} left`} onClick={() => setPlatform(s.platform)}>{s.label} <span className="mono">{s.handle}</span></button>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="stack gap-6">
              <label className="lbl" htmlFor="report-note">Anything we should know? (optional)</label>
              <textarea id="report-note" className="inp" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              <span className="muted xsmall">Plain text, up to 500 characters. Links aren’t made clickable.</span>
            </div>
            <div className="hp" aria-hidden="true">
              <label htmlFor="report-website">Website</label>
              <input id="report-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <p className="muted xsmall">The person you report is never told who reported them: Everstats doesn’t keep who sends a report.</p>
            {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
          </div>
        </Modal>
      )}
    </>
  );
}
