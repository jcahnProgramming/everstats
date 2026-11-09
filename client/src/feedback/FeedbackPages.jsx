import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { formatDateTime } from '../format.js';
import { startProvider } from '../pages/SignInPages.jsx';
import { useSession } from '../session.jsx';

/**
 * Feedback and contact (0.7.1), built from v1 parts (panel, field, radio buttons, note). Plain text only: messages are
 * shown as text (white-space kept), never as HTML, and links in them are never made clickable.
 *
 *   /feedback            the form. ?type=bug&page=/c/…&about=render pre-fills it ("Report a wrong render").
 *                        Signed out: a note says replies can only come on Discord, with Battle.net / Discord sign-in
 *                        buttons. The draft lives in THIS BROWSER (localStorage) until it's sent: signing in comes back
 *                        to /feedback?restore=1 with it intact. Nothing is sent to the server before "Send".
 *   /settings/feedback   "Your feedback": a thread per message, Everstats' replies, and replying back.
 */
export const FEEDBACK_TYPES = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'question', label: 'Question' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'other', label: 'Other' },
];
const TYPE_LABEL = Object.fromEntries(FEEDBACK_TYPES.map((t) => [t.id, t.label]));
export const RENDER_REPORT = 'The render doesn’t match this character.';
const DRAFT_KEY = 'everstats.feedback.draft';
const MIN = 10;
const MAX = 4000;

const readDraft = () => {
  try {
    const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null');
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
};
const writeDraft = (d) => {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private mode or storage off: the draft just isn't kept */
  }
};
const clearDraft = () => {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
};

/** Where "Feedback" links go: the form, about the page you're on. */
export const feedbackHref = (pathname, extra = {}) => `/feedback?${new URLSearchParams({ page: pathname, ...extra }).toString()}`;

function initialForm(params) {
  const draft = readDraft();
  const prefilled = params.has('type') || params.has('about');
  if (draft && (params.get('restore') === '1' || !prefilled)) {
    return { type: draft.type ?? 'bug', message: draft.message ?? '', page: draft.page ?? params.get('page') ?? '', discord: draft.discord ?? '' };
  }
  const type = FEEDBACK_TYPES.some((t) => t.id === params.get('type')) ? params.get('type') : 'bug';
  return { type, message: params.get('about') === 'render' ? `${RENDER_REPORT}\n\n` : '', page: params.get('page') ?? '', discord: '' };
}

export function FeedbackPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => initialForm(params));
  const [website, setWebsite] = useState(''); // the honeypot: people never see it
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  // The draft is kept in this browser as it's typed, so a sign-in round trip (or a closed tab) doesn't lose it.
  useEffect(() => {
    if (!sent && (form.message.trim() || form.discord.trim())) writeDraft(form);
  }, [form, sent]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const length = [...form.message.trim()].length;
  const send = async (e) => {
    e.preventDefault();
    setProblem(null);
    if (length < MIN) return setProblem(`Your message needs at least ${MIN} characters.`);
    setBusy(true);
    try {
      const r = await api('/api/feedback', { method: 'POST', body: { ...form, website } });
      clearDraft();
      setSent(r);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  const signIn = (id) => {
    writeDraft(form);
    startProvider(id, 'sign_in', '/feedback?restore=1').catch((err) => setProblem(err.message));
  };

  if (sent) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">Thanks: it’s sent</h1>
        <div className="note ok"><Icon name="check" /><span>
          {sent.signedIn
            ? <>It’s linked to your account. When Everstats replies, the reply appears in <Link to="/settings/feedback">Your feedback</Link> and a dot shows on your account button.</>
            : form.discord.trim()
              ? <>You weren’t signed in, so a reply can only come on Discord, to <b className="mono">{form.discord.trim()}</b>.</>
              : <>You weren’t signed in and left no Discord username, so Everstats can read this but can’t reply.</>}
        </span></div>
        <div className="row gap-10"><Link className="btn" to={form.page && form.page.startsWith('/') ? form.page : '/'}>Back to where you were</Link><button type="button" className="btn ghost" onClick={() => { setSent(null); setForm({ type: 'bug', message: '', page: form.page, discord: '' }); }}>Send another</button></div>
      </div>
    );
  }

  const providers = session.providers.filter((p) => p.configured);
  return (
    <div className="wrap page-pad stack gap-24 narrow-wrap">
      <div className="stack gap-8">
        <h1 className="h1">Feedback</h1>
        <p className="t2">Report a bug, suggest an idea, ask a question or reach out. One person reads everything.</p>
      </div>
      <form className="panel pad-24 stack gap-18" onSubmit={send} noValidate>
        <fieldset className="plain-fieldset stack gap-8">
          <legend className="lbl">What is it?</legend>
          <div className="radio-list" role="radiogroup" aria-label="What is it?">
            {FEEDBACK_TYPES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={form.type === t.id} className="btn sm" onClick={() => set('type', t.id)}>{t.label}</button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="fb-msg">Your message</label>
          <textarea id="fb-msg" className="inp" rows={8} maxLength={MAX} value={form.message} onChange={(e) => set('message', e.target.value)} aria-describedby="fb-msg-note" required />
          <span className="help" id="fb-msg-note">{length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')} · at least {MIN} characters. Plain text: links won’t be clickable.</span>
        </div>
        <Field label="The page it’s about" help="Filled in with the page you came from. Change it if it’s about another one." value={form.page} onChange={(e) => set('page', e.target.value)} maxLength={300} placeholder="/c/name-surname" />
        <Field label="Your Discord username, if you’d like a reply there (optional)" value={form.discord} onChange={(e) => set('discord', e.target.value)} maxLength={37} autoComplete="off" spellCheck="false" />
        {/* The honeypot: hidden from people and from screen readers. Bots that fill every field give themselves away. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="fb-website">Website</label>
          <input id="fb-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        {!session.loading && !session.signedIn && (
          <div className="note small" role="note">
            <Icon name="info" />
            <span className="flex-fill stack gap-10">
              <span>Sign in to get replies right here on Everstats. Otherwise we can only reply on Discord, if you leave your username.</span>
              {providers.length > 0 && (
                <span className="row gap-8 wrap-row">
                  {providers.map((p) => <button key={p.id} type="button" className="btn sm" onClick={() => signIn(p.id)}>Sign in with {p.label}</button>)}
                  <span className="muted xsmall">Your draft stays in this browser and comes back after signing in.</span>
                </span>
              )}
            </span>
          </div>
        )}
        {session.signedIn && <span className="muted xsmall">Sent as {session.user?.claimed ? <span className="mono">@{session.user.username}</span> : 'your account'}. Replies appear in <Link to="/settings/feedback">Your feedback</Link>.</span>}
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        <div className="row gap-10">
          <Button className="btn gold" type="submit" loading={busy}>Send</Button>
          <span className="muted xsmall">Kept until Everstats deletes it, or you delete your account. <Link to="/privacy">Privacy</Link></span>
        </div>
      </form>
    </div>
  );
}

/** Your feedback: every message this account sent, as threads, newest activity first. */
export function YourFeedbackPage() {
  const session = useSession();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    try {
      setThreads((await api('/api/account/feedback')).threads);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn, load]);

  if (session.loading) return <div className="wrap page-pad"><h1 className="h1">Your feedback</h1></div>;
  if (!session.signedIn) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">Your feedback</h1>
        <EmptyState kind="nodata" title="Sign in to see your messages and Everstats’ replies"><span><Link to="/sign-in">Sign in</Link></span></EmptyState>
      </div>
    );
  }
  return (
    <div className="wrap page-pad stack gap-24 narrow-wrap">
      <nav className="crumbs small" aria-label="Breadcrumb"><Link to="/settings">Settings</Link><span aria-hidden="true"> / </span><span>Your feedback</span></nav>
      <div className="row gap-12 wrap-row">
        <h1 className="h1 flex-fill">Your feedback</h1>
        <Link className="btn gold sm" to="/feedback">Send feedback</Link>
      </div>
      {error && <ServiceUnavailable inline title="Couldn’t load your messages" onRetry={load}>{error}</ServiceUnavailable>}
      {threads?.length === 0 && <EmptyState kind="nodata" title="No messages yet"><span>Messages you send while signed in appear here, with Everstats’ replies.</span></EmptyState>}
      {threads?.map((t) => (
        <Thread key={t.id} thread={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onChanged={(nt) => {
          setThreads((list) => list.map((x) => (x.id === nt.id ? nt : x)));
          session.refresh();
        }} />
      ))}
    </div>
  );
}

function Thread({ thread: t, open, onToggle, onChanged }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (open && t.unread) api(`/api/account/feedback/${t.id}`).then((r) => onChanged(r.thread), () => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      onChanged((await api(`/api/account/feedback/${t.id}/reply`, { method: 'POST', body: { message: reply } })).thread);
      setReply('');
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  const replied = t.messages.some((m) => m.author === 'everstats');
  return (
    <section className="panel clip fb-thread">
      <button type="button" className="fb-head" aria-expanded={open} onClick={onToggle}>
        <span className="tag">{TYPE_LABEL[t.type]}</span>
        <span className="flex-fill ellipsis t2 small">{t.messages[0]?.body}</span>
        {t.unread && <span className="dot-unread" aria-label="New reply" />}
        <span className="muted xsmall nowrap">{replied ? 'Replied' : 'Sent'} · {formatDateTime(t.updatedAt)}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" />
      </button>
      {open && (
        <div className="pad-20 stack gap-14">
          {t.page && <span className="muted xsmall">About <span className="mono">{t.page}</span></span>}
          <ol className="plain stack gap-10 fb-messages">
            {t.messages.map((m) => (
              <li key={m.id} className={`fb-msg ${m.author}`}>
                <span className="eyebrow">{m.author === 'everstats' ? 'Everstats' : 'You'} · {formatDateTime(m.at)}</span>
                <p className="fb-body">{m.body}</p>
              </li>
            ))}
          </ol>
          <form className="stack gap-8" onSubmit={send}>
            <label className="lbl" htmlFor={`fb-reply-${t.id}`}>Reply</label>
            <textarea id={`fb-reply-${t.id}`} className="inp" rows={3} maxLength={MAX} value={reply} onChange={(e) => setReply(e.target.value)} />
            {problem && <span className="help err" role="alert">{problem}</span>}
            <Button className="btn sm self-start" type="submit" loading={busy} disabled={!reply.trim()}>Send reply</Button>
          </form>
        </div>
      )}
    </section>
  );
}
