import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Modal, Segmented, Tabs } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime } from '../format.js';
import { FEEDBACK_TYPES } from '../feedback/FeedbackPages.jsx';

/**
 * /admin/feedback (0.7.1), linked only from /admin; its API sits behind the admin 404 gate. One inbox: unread, read,
 * replied, archived; filter by type. Each message shows the sender's @username or "signed out", the Discord username
 * they left, the page and the time. Replies go into the thread and are shown to the player as from "Everstats", never
 * a person. Signed-out messages can't get a reply here: their Discord name is shown prominently, with "Reply on
 * Discord". Private notes are only ever seen here. Everything is plain text: links are never clickable, no HTML.
 */
const TYPE_LABEL = Object.fromEntries(FEEDBACK_TYPES.map((t) => [t.id, t.label]));

export function FeedbackAdminPage() {
  const navigate = useNavigate();
  const [state, setState] = useState('unread');
  const [type, setType] = useState('all');
  const [list, setList] = useState(undefined);
  const [open, setOpen] = useState(null);
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setList(await api(`/api/admin/feedback?state=${state}${type === 'all' ? '' : `&type=${type}`}`));
    } catch (err) {
      if (err.status === 404) setList(null);
      else setProblem(err.message);
    }
  }, [state, type]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (list === null) navigate('/admin/sign-in', { replace: true });
  }, [list, navigate]);
  if (list === null) return null;
  if (list === undefined) return <div className="wrap page-pad">{problem ? <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div> : <span className="t2 small" role="status">Loading…</span>}</div>;

  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-12 wrap-row">
        <h1 className="h1 admin-title">Feedback</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <Link className="btn ghost sm" to="/admin">Back to admin</Link>
      </div>
      <Tabs label="Inbox" idPrefix="fb" value={state} onChange={(s) => { setState(s); setOpen(null); }}
        tabs={['unread', 'read', 'replied', 'archived'].map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1), count: list.counts[s] }))} />
      <Segmented label="Type" options={[{ id: 'all', label: 'All types' }, ...FEEDBACK_TYPES]} value={type} onChange={setType} />
      <div className="split fb-admin" role="tabpanel" id={`fb-panel-${state}`} aria-labelledby={`fb-tab-${state}`}>
        <div className="main stack gap-8">
          {list.threads.length === 0 && <EmptyState kind="nodata" compact title={`Nothing ${state}`}><span>Messages land here as people send them.</span></EmptyState>}
          {list.threads.map((t) => (
            <button key={t.id} type="button" className={`panel fb-row${open === t.id ? ' is-open' : ''}`} aria-pressed={open === t.id} onClick={() => setOpen(t.id)}>
              <span className="row gap-8 wrap-row">
                <span className="tag">{TYPE_LABEL[t.type]}</span>
                <b className="small">{t.sender.username ? `@${t.sender.username}` : t.sender.signedIn ? `Account #${t.sender.accountId}` : 'Signed out'}</b>
                {t.discord && <span className="mono xsmall t2">Discord: {t.discord}</span>}
                <span className="spacer" />
                <span className="muted xsmall">{formatDateTime(t.updatedAt)}{t.messages > 1 ? ` · ${t.messages} messages` : ''}</span>
              </span>
              <span className="t2 small fb-preview">{t.preview}</span>
              {t.page && <span className="muted xsmall mono">{t.page}</span>}
            </button>
          ))}
        </div>
        <div className="side">
          {open ? <ThreadAdmin key={open} id={open} onChanged={load} onDeleted={() => { setOpen(null); load(); }} /> : <span className="muted small">Choose a message.</span>}
        </div>
      </div>
    </div>
  );
}

function ThreadAdmin({ id, onChanged, onDeleted }) {
  const toast = useToasts();
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    api(`/api/admin/feedback/${id}`).then((r) => { setT(r.thread); onChanged(); }, (err) => setProblem(err.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (what, fn) => {
    setBusy(what);
    setProblem(null);
    try {
      setT((await fn()).thread);
      onChanged();
      return true;
    } catch (err) {
      setProblem(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  if (problem && !t) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!t) return <span className="t2 small" role="status">Loading…</span>;
  const signedOut = !t.sender.signedIn;
  return (
    <section className="panel pad-20 stack gap-14" aria-label="Message">
      <div className="row gap-8 wrap-row">
        <span className="tag">{TYPE_LABEL[t.type]}</span>
        <span className="tag">{t.state}</span>
        <b>{t.sender.username ? <Link className="mono" to={`/u/${t.sender.username}`}>@{t.sender.username}</Link> : signedOut ? 'Signed out' : `Account #${t.sender.accountId} (no username)`}</b>
      </div>
      <span className="muted xsmall">Sent {formatDateTime(t.createdAt)}{t.page ? <> · about <span className="mono">{t.page}</span></> : null}</span>
      {t.discord && (
        <div className={`note small${signedOut ? ' warn' : ''}`}>
          <Icon name="provider-chat" />
          <span>Discord: <b className="mono">{t.discord}</b>{signedOut ? ' · reply on Discord: a reply here can’t reach a signed-out sender.' : ''}</span>
        </div>
      )}
      {signedOut && !t.discord && <div className="note small"><Icon name="info" /><span>Sent signed out with no Discord username: there’s no way to reply.</span></div>}
      <ol className="plain stack gap-10 fb-messages">
        {t.messages.map((m) => (
          <li key={m.id} className={`fb-msg ${m.author}`}>
            <span className="eyebrow">{m.author === 'everstats' ? 'Everstats (you)' : 'Them'} · {formatDateTime(m.at)}</span>
            <p className="fb-body">{m.body}</p>
          </li>
        ))}
      </ol>
      {!signedOut && (
        <div className="stack gap-6">
          <label className="lbl" htmlFor="fb-admin-reply">Reply (shown to them as from “Everstats”)</label>
          <textarea id="fb-admin-reply" className="inp" rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
          <Button className="btn gold sm self-start" loading={busy === 'reply'} disabled={!reply.trim()} onClick={async () => {
            if (await act('reply', () => api(`/api/admin/feedback/${t.id}/reply`, { method: 'POST', body: { message: reply } }))) {
              setReply('');
              toast.ok('Reply sent', 'They see it in Your feedback, with a dot on their account button.');
            }
          }}>Send reply</Button>
        </div>
      )}
      <div className="stack gap-6">
        <span className="lbl">Private notes</span>
        {t.notes.length === 0 ? <span className="muted xsmall">None. Only you see these.</span> : (
          <ul className="plain stack gap-6">{t.notes.map((n) => <li key={n.id} className="well pad-12"><span className="muted xsmall">{formatDateTime(n.at)}</span><p className="fb-body small">{n.body}</p></li>)}</ul>
        )}
        <textarea aria-label="New private note" className="inp" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button className="btn sm self-start" loading={busy === 'note'} disabled={!note.trim()} onClick={async () => {
          if (await act('note', () => api(`/api/admin/feedback/${t.id}/notes`, { method: 'POST', body: { body: note } }))) setNote('');
        }}>Add note</Button>
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-8 wrap-row">
        {t.state !== 'replied' && <button type="button" className="btn sm ghost" onClick={() => act('state', () => api(`/api/admin/feedback/${t.id}/state`, { method: 'PUT', body: { state: 'replied' } }))}>Mark replied</button>}
        {t.state !== 'archived' && <button type="button" className="btn sm ghost" onClick={() => act('state', () => api(`/api/admin/feedback/${t.id}/state`, { method: 'PUT', body: { state: 'archived' } }))}>Archive</button>}
        {t.state !== 'unread' && <button type="button" className="btn sm ghost" onClick={() => act('state', () => api(`/api/admin/feedback/${t.id}/state`, { method: 'PUT', body: { state: 'unread' } }))}>Mark unread</button>}
        <span className="spacer" />
        <button type="button" className="btn sm danger" onClick={() => setDeleting(true)}>Delete…</button>
      </div>
      {deleting && (
        <Modal title="Delete this message?" onClose={() => setDeleting(false)} actions={<><button type="button" className="btn ghost" onClick={() => setDeleting(false)}>Cancel</button><button type="button" className="btn danger" onClick={async () => {
          await api(`/api/admin/feedback/${t.id}`, { method: 'DELETE' });
          setDeleting(false);
          toast.ok('Deleted');
          onDeleted();
        }}>Delete for good</button></>}>
          <p className="t2">The thread, its replies and your notes are deleted for good, and disappear from the sender’s Your feedback too.</p>
        </Modal>
      )}
    </section>
  );
}
