import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { useEditing } from '../../chrome/updates.js';
import { Modal, Segmented, Toggle } from '../../components/Controls.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { FEEDBACK_TYPES } from '../../feedback/FeedbackPages.jsx';
import { ActionStatus, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, useAction } from '../shell/parts.jsx';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { useShellInfo } from '../shell/scope.jsx';
import { Filter, GuildResetDialog, GuildText, ModDialog, ReportLine, SearchBox, useModerationMe } from './DirectoryPages.jsx';
import './moderation.css';

/**
 * Inbox (0.10.3, design/v5-admin pages inbox-feedback, inbox-reports; states inbox-empty, inbox-error). Moved here from
 * the 0.7.1 FeedbackAdminPage and the 0.8.2 Reports page.
 *
 *   /admin/inbox/feedback[/:id]   every feedback thread; appeals are a type filter. An open thread shows its linked ban
 *                                 (an appeal), the conversation, private notes and the reply composer. A reply can lift
 *                                 the ban in the same step: the existing unban (reason required, the player sees it) runs
 *                                 first, then the reply is sent.
 *   /admin/inbox/reports          reports grouped by target (profile, guild description, guild link), open / actioned /
 *                                 dismissed. Moderation actions live on the account: a profile group links there.
 *
 * Moderators (only while the Moderator role feature is on) see Reports only (/api/admin/feedback is admin-only).
 *
 * Different from the design, on purpose: no "Save draft" (nothing stores drafts; an unsent reply keeps the page from
 * reloading itself instead); the state filter is the stored states (Unread / Read / Replied / Archived: "Resolved" is
 * Archived); "Open account" and the moderation buttons for a profile report live on the account page; the reply goes to
 * the player's "Your feedback" with a dot on their account button (Everstats sends no email).
 */
const TYPE_LABEL = Object.fromEntries([...FEEDBACK_TYPES.map((t) => [t.id, t.label]), ['appeal', 'Appeal']]);
const TYPE_KIND = { bug: 'err', idea: 'info', appeal: 'warn' };
const STATE_OPTS = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'read', label: 'Read' }, { id: 'replied', label: 'Replied' }, { id: 'archived', label: 'Archived' }];
const TYPE_OPTS = [{ id: '', label: 'All types' }, { id: 'appeal', label: 'Appeals' }, ...FEEDBACK_TYPES.map((t) => ({ id: t.id, label: t.label }))];

function InboxHead() {
  const info = useShellInfo();
  const moderator = info.role === 'moderator';
  const counts = usePanel('inbox-counts', async () => {
    const [fb, rep] = await Promise.all([moderator ? null : api('/api/admin/feedback/counts'), api('/api/admin/moderation/reports/count')]);
    return { unread: fb?.counts?.unread ?? null, open: rep.open };
  }, [moderator]);
  const c = counts.data;
  const tabs = [
    ...(moderator ? [] : [{ to: '/admin/inbox/feedback', label: 'Feedback', prefix: true, count: c?.unread ? `${formatNumber(c.unread)} unread` : null }]),
    { to: '/admin/inbox/reports', label: 'Reports', count: c?.open ? `${formatNumber(c.open)} open` : null },
  ];
  return <PageHead title="Inbox" desc={moderator ? 'Reports from players, grouped by what was reported.' : 'Feedback and reports together. Appeals are feedback threads of type Appeal.'} tabs={tabs} chips={<ScopeChip global />} />;
}

const senderName = (s) => (s.username ? `@${s.username}` : s.signedIn ? `Account #${s.accountId}` : 'Signed out');

// ------------------------------------------------------------------------------------------------- Feedback
export function FeedbackInboxPage() {
  const { id } = useParams();
  const info = useShellInfo();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState('all');
  const [type, setType] = useState('');
  const q = params.get('q') ?? '';
  const list = usePanel(`fb-list-${state}-${type}-${q}`, () => {
    if (info.role === 'moderator') return Promise.resolve(null);
    const qs = new URLSearchParams({ state });
    if (type) qs.set('type', type);
    if (q) qs.set('q', q);
    return api(`/api/admin/feedback?${qs}`);
  }, [state, type, q, info.role]);
  if (info.role === 'moderator') {
    return <><InboxHead /><section className="ap"><Empty icon="no-coverage" title="Feedback is for the admin only" action={<Link className="btn sm" to="/admin/inbox/reports">Open Reports</Link>} /></section></>;
  }
  const keep = q ? `?q=${encodeURIComponent(q)}` : '';
  return (
    <>
      <InboxHead />
      <div className={`twopane${id ? ' show-pane' : ''}`}>
        <div className="list">
          <div className="tbar">
            <SearchBox label="Search feedback" placeholder="Search feedback, @username or Discord name" value={q}
              onSubmit={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set('q', v); else n.delete('q'); return n; })} />
          </div>
          <div className="mod-filters">
            <Segmented label="State" options={STATE_OPTS} value={state} onChange={setState} scroll={false} />
            <Filter label="Type" options={TYPE_OPTS} value={type} onChange={setType} />
          </div>
          <Panel panel={list} title="Threads" id="threads" flush className="flat-panel">
            {(d) => (!d ? null : d.threads.length === 0 ? (
              <Empty icon="inbox" title={state === 'all' && !type && !q ? 'Inbox zero' : 'Nothing here'}>
                {state === 'all' && !type && !q ? 'Messages land here as people send them.' : 'No thread matches this filter.'}
              </Empty>
            ) : (
              <div className="thr-list">
                {d.threads.map((t) => (
                  <Link key={t.id} to={`/admin/inbox/feedback/${t.id}${keep}`} className={`thr${t.state === 'unread' ? ' unread' : ''}`} aria-current={String(t.id) === id ? 'true' : undefined}>
                    <span className="s">{t.type === 'appeal' ? `Appeal from ${senderName(t.sender)}` : senderName(t.sender)}</span>
                    <span className="w">{timeAgo(t.updatedAt)}</span>
                    <span className="x">“{t.preview}”</span>
                    <span className="m">
                      <Chip kind={TYPE_KIND[t.type] ?? 'info'}>{TYPE_LABEL[t.type] ?? t.type}</Chip>
                      {t.state !== 'unread' && <span className="xsmall">{t.state === 'replied' ? 'You replied' : t.state === 'archived' ? 'Archived' : 'Read'}</span>}
                      {t.messages > 1 && <span className="xsmall">{t.messages} messages</span>}
                    </span>
                  </Link>
                ))}
                <div className="pager">{d.threads.length}{d.threads.length >= 200 ? '+ (newest 200)' : ''} thread{d.threads.length === 1 ? '' : 's'} · {formatNumber(d.counts.unread)} unread</div>
              </div>
            ))}
          </Panel>
        </div>
        <div className="pane">
          {id ? <Thread key={id} id={id} back={`/admin/inbox/feedback${keep}`} onChanged={list.reload} /> : (
            <Empty icon="inbox" title="Choose a thread">Pick a message on the left.</Empty>
          )}
        </div>
      </div>
    </>
  );
}

function Thread({ id, back, onChanged }) {
  const navigate = useNavigate();
  const { me } = useModerationMe();
  const p = usePanel(`fb-thread-${id}`, () => api(`/api/admin/feedback/${id}`).then((r) => r.thread), [id]);
  const [reply, setReply] = useState('');
  const [lift, setLift] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(false);
  const replyAct = useAction();
  const noteAct = useAction();
  const stateAct = useAction();
  useEditing(reply.trim().length > 0 || note.trim().length > 0);
  // Opening a thread marks it read: the list follows once it has loaded.
  useEffect(() => {
    if (p.data) onChanged();
  }, [p.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = p.data;
  const ban = t?.ban ?? null;
  const canLift = Boolean(ban?.live && me?.can && (ban.kind === 'temporary' ? me.can['unban.temporary'] : me.can['unban.permanent']));
  const setThread = (thread) => {
    p.setData(thread);
    onChanged();
  };
  const sendReply = () => replyAct.run(async () => {
    setThread((await api(`/api/admin/feedback/${t.id}/reply`, { method: 'POST', body: { message: reply } })).thread);
    setReply('');
  }, { done: 'Reply sent: they see it in Your feedback', working: 'Sending…' });
  const setState = (s, words) => stateAct.run(async () => setThread((await api(`/api/admin/feedback/${t.id}/state`, { method: 'PUT', body: { state: s } })).thread), { done: words });
  const signedOut = t ? !t.sender.signedIn : false;
  return (
    <Panel panel={p} title={t ? (t.type === 'appeal' ? `Appeal from ${senderName(t.sender)}` : `${TYPE_LABEL[t.type] ?? t.type} from ${senderName(t.sender)}`) : 'Thread'} id="thread" flush className="flat-panel"
      actions={<Link className="btn ghost sm only-ph" to={back}>← All feedback</Link>}>
      {(d) => (
        <div className="stack">
          <div className="tbar">
            <Chip kind={TYPE_KIND[d.type] ?? 'info'}>{TYPE_LABEL[d.type] ?? d.type}</Chip>
            <Chip kind={d.state === 'unread' ? 'info' : d.state === 'archived' ? 'off' : 'ok'}>{d.state[0].toUpperCase() + d.state.slice(1)}</Chip>
            <span className="muted xsmall">Sent {formatDateTime(d.createdAt)}{d.page ? <> · about <span className="mono2">{d.page}</span></> : null}</span>
            <span className="spacer" />
            {d.sender.accountId && <Link className="btn sm ghost" to={`/admin/directory/accounts/${d.sender.accountId}`}><Icon name="user" size="sm" />Open account</Link>}
            {d.state !== 'archived' && <button type="button" className="btn sm" onClick={() => setState('archived', 'Archived')}><Icon name="archive" size="sm" />Archive</button>}
            {d.state !== 'replied' && d.state !== 'unread' && <button type="button" className="btn sm ghost" onClick={() => setState('replied', 'Marked replied')}>Mark replied</button>}
            {d.state !== 'unread' && <button type="button" className="btn sm ghost" onClick={() => setState('unread', 'Marked unread')}>Mark unread</button>}
            <ActionStatus action={stateAct} />
          </div>
          {ban && (
            <div className={`note small mod-note${ban.live ? ' warn' : ''}`}>
              <Icon name="shield-check" />
              <span>
                Linked moderation: <b>{ban.kind === 'permanent' ? 'permanent ban' : 'temp ban'}</b> by {ban.by} on {formatDateTime(ban.startsAt)} · reason “{ban.reason}”.
                {' '}{ban.liftedAt ? `Lifted ${formatDateTime(ban.liftedAt)}${ban.liftedReason ? ` (“${ban.liftedReason}”)` : ''}.` : ban.live ? (ban.endsAt ? `Ends ${formatDateTime(ban.endsAt)}.` : 'Lasts until it’s lifted.') : 'It has ended.'}
                {' '}<Link to={`/admin/directory/accounts/${ban.accountId}#moderation`}>The account’s moderation</Link>
              </span>
            </div>
          )}
          {d.discord && (
            <div className={`note small mod-note${signedOut ? ' warn' : ''}`}><Icon name="provider-chat" /><span>Discord: <b className="mono2">{d.discord}</b>{signedOut ? ' · reply on Discord: a reply here can’t reach a signed-out sender.' : ''}</span></div>
          )}
          {signedOut && !d.discord && <div className="note small mod-note"><Icon name="info" /><span>Sent signed out with no Discord username: there’s no way to reply.</span></div>}
          <div className="msgs">
            {d.messages.map((m) => (
              <div key={m.id} className={`msg${m.author === 'everstats' ? ' me' : ''}`}>
                <div className="meta"><b>{m.author === 'everstats' ? 'Everstats (you)' : senderName(d.sender)}</b><span>{formatDateTime(m.at)}</span></div>
                <p className="mod-body">{m.body}</p>
              </div>
            ))}
            {d.notes.map((n) => (
              <div key={`n${n.id}`} className="msg note-msg">
                <div className="meta"><b>Private note</b><span>{formatDateTime(n.at)}</span><span>only you see this</span></div>
                <p className="mod-body">{n.body}</p>
              </div>
            ))}
          </div>
          {!signedOut && (
            <div className="compose">
              <label className="lbl" htmlFor="fb-reply">Reply to {senderName(d.sender)} (they see it in Your feedback, signed “Everstats”)</label>
              <textarea id="fb-reply" className="inp" maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="row">
                {canLift && <><Toggle checked={lift} onChange={setLift}>Lift the ban with this reply</Toggle></>}
                {ban?.live && !canLift && <span className="muted xsmall">You can’t lift this ban from here.</span>}
                <span className="spacer" />
                <ActionStatus action={replyAct} />
                <button type="button" className={`btn sm gold${replyAct.busy ? ' is-loading' : ''}`} disabled={!reply.trim() || replyAct.busy}
                  onClick={() => (lift && canLift ? setLiftOpen(true) : sendReply())}>
                  <Icon name="reply" size="sm" />{lift && canLift ? 'Lift ban and send…' : 'Send reply'}
                </button>
              </div>
            </div>
          )}
          <div className="compose">
            <label className="lbl" htmlFor="fb-note">Private note (only you see it)</label>
            <textarea id="fb-note" className="inp" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button type="button" className="btn sm ghost" onClick={() => setDeleting(true)}>Delete thread…</button>
              <span className="spacer" />
              <ActionStatus action={noteAct} />
              <button type="button" className="btn sm" disabled={!note.trim() || noteAct.busy}
                onClick={() => noteAct.run(async () => { setThread((await api(`/api/admin/feedback/${d.id}/notes`, { method: 'POST', body: { body: note } })).thread); setNote(''); }, { done: 'Note added' })}>Add note</button>
            </div>
          </div>
          {liftOpen && (
            <ModDialog title={`Lift the ban on ${senderName(d.sender)} and send the reply?`} confirmLabel="Lift ban and send" danger={false} message={false}
              what="The ban is lifted first (everything comes back as it was; they see the reason on their next sign-in), then your reply is sent. If the lift fails, nothing is sent."
              onClose={() => setLiftOpen(false)}
              onConfirm={async ({ reason }) => {
                await api(`/api/admin/moderation/accounts/${ban.accountId}/unban`, { method: 'POST', body: { reason } });
                replyAct.set('working', 'Ban lifted · sending the reply…');
                try {
                  setThread((await api(`/api/admin/feedback/${d.id}/reply`, { method: 'POST', body: { message: reply } })).thread);
                  setReply('');
                  setLift(false);
                  replyAct.set('done', 'Ban lifted and reply sent');
                } catch (err) {
                  replyAct.set('failed', `Ban lifted, but the reply failed: ${err.message}`);
                }
                p.reload();
              }} />
          )}
          {deleting && (
            <ConfirmDialog title="Delete this thread for good?" confirmLabel="Delete for good" playersSee
              what="The thread, its replies and your notes are deleted for good, and disappear from the sender’s Your feedback too."
              onClose={() => setDeleting(false)}
              onConfirm={async (reason) => {
                await api(`/api/admin/feedback/${d.id}`, { method: 'DELETE', body: { reason } });
                onChanged();
                navigate(back);
              }} />
          )}
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------- Reports
const KIND_OPTS = [{ id: '', label: 'All targets' }, { id: 'account', label: 'Profiles' }, { id: 'guild', label: 'Guild descriptions' }, { id: 'link', label: 'Guild links' }];
const KIND_WORD = { account: 'Profile', guild: 'Guild description', link: 'Guild link' };

export function ReportsInboxPage() {
  const { me, error } = useModerationMe();
  const [state, setState] = useState('open');
  const [kind, setKind] = useState('');
  const [resolving, setResolving] = useState(null);
  const [guild, setGuild] = useState(null);
  const [removing, setRemoving] = useState(null);
  const act = useAction();
  const p = usePanel(`reports-${state}`, () => api(`/api/admin/moderation/reports?state=${state}`), [state]);
  const admin = me?.actor?.kind === 'admin';
  const groups = (p.data?.groups ?? []).filter((g) => !kind || g.target.kind === kind);
  return (
    <>
      <InboxHead />
      {error && <div className="perr" role="alert"><Icon name="error" /><span>{error.message}</span></div>}
      <div className="dash-ctrl">
        <Segmented label="Status" options={[{ id: 'open', label: p.data && state === 'open' ? `Open · ${p.data.groups.length} target${p.data.groups.length === 1 ? '' : 's'}` : 'Open' }, { id: 'actioned', label: 'Actioned' }, { id: 'dismissed', label: 'Dismissed' }]} value={state} onChange={setState} scroll={false} />
        <Segmented label="Target type" options={KIND_OPTS} value={kind} onChange={setKind} scroll={false} />
        <span className="spacer" />
        <ActionStatus action={act} idle="Grouped by target · newest first · every action asks for a reason" />
      </div>
      <Panel panel={p} title={state === 'open' ? 'Open reports' : state === 'actioned' ? 'Actioned reports' : 'Dismissed reports'} id="reports" flush
        sub={<span className="muted xsmall">Everstats doesn’t keep who sent a report, only whether they were signed in.</span>}>
        {() => (groups.length === 0 ? (
          <Empty icon={state === 'open' ? 'check-circle' : 'inbox'} title={state === 'open' ? 'No open reports' : `Nothing ${state}`}>
            {state === 'open' ? 'Reports land here as people send them.' : 'Handled reports are listed here.'}
          </Empty>
        ) : (
          <div className="stack">
            {groups.map((g) => {
              const t = g.target;
              const quoted = g.items.map((r) => (r.what === 'bio' ? r.snapshot?.bio : r.what === 'display_name' ? r.snapshot?.displayName : r.what === 'guild_description' ? r.snapshot?.description : null)).filter(Boolean);
              return (
                <section key={`${t.kind}:${t.id}`} className="rgroup" aria-label={`${KIND_WORD[t.kind]}: ${t.label}`}>
                  <div className="gh">
                    <Icon name={t.kind === 'account' ? 'user' : t.kind === 'guild' ? 'guild' : 'link'} />
                    <span className="t">
                      {KIND_WORD[t.kind]} · {t.kind === 'account' && t.exists ? <Link className="tgt" to={`/admin/directory/accounts/${t.id}`}>{t.label}</Link>
                        : t.kind === 'link' && t.guild && admin ? <Link className="tgt" to={`/admin/directory/guilds/${t.guild.id}/links`}>{t.label}</Link> : t.label}
                      {' '}<Chip kind={state === 'open' ? 'warn' : 'off'}>{g.count} {state}</Chip>
                      {t.banned && <> <Chip kind="err" icon="lock">Banned</Chip></>}
                      {t.removed && <> <Chip kind="off">Link removed</Chip></>}
                    </span>
                    <span className="s">{t.kind === 'account' ? (t.displayName ? `Display name “${t.displayName}”` : 'Profile') : t.kind === 'link' ? (t.guild ? `On ${t.guild.name}` : 'A guild Everstats no longer has') : 'The guild page’s own text'} · latest {formatDateTime(g.latest)}</span>
                    <div className="act">
                      {t.kind === 'account' && t.exists && <Link className="btn sm" to={`/admin/directory/accounts/${t.id}#moderation`}>Open account and actions</Link>}
                      {t.kind === 'guild' && <button type="button" className="btn sm" onClick={() => setGuild(t)}>Guild text…</button>}
                      {t.kind === 'link' && admin && !t.removed && state === 'open' && <button type="button" className="btn sm danger" onClick={() => setRemoving(t)}>Remove link…</button>}
                      {state === 'open' && me?.can?.['reports.dismiss'] && (
                        <>
                          <button type="button" className="btn sm ghost" onClick={() => setResolving({ target: t, to: 'actioned' })}>Mark actioned…</button>
                          <button type="button" className="btn sm ghost" onClick={() => setResolving({ target: t, to: 'dismissed' })}>Dismiss…</button>
                        </>
                      )}
                    </div>
                  </div>
                  {t.kind === 'link' && t.url && <blockquote className="quote"><span className="mono2">{t.url}</span></blockquote>}
                  {quoted.length > 0 && <blockquote className="quote mod-body">{[...new Set(quoted)].slice(0, 3).map((x) => `“${x}”`).join(' · ')}</blockquote>}
                  <div className="rlist">{g.items.map((r) => <ReportLine key={`${t.kind}-${r.id}`} r={r} />)}</div>
                </section>
              );
            })}
          </div>
        ))}
      </Panel>
      {resolving && (
        <ConfirmDialog title={resolving.to === 'dismissed' ? `Dismiss the reports about ${resolving.target.label}?` : `Mark the reports about ${resolving.target.label} actioned?`}
          confirmLabel={resolving.to === 'dismissed' ? 'Dismiss reports' : 'Mark actioned'} danger={false} playersSee={false}
          what={resolving.to === 'dismissed' ? 'Every open report about it leaves the queue as dismissed. Nothing changes for the player.' : 'Every open report about it leaves the queue as actioned (use this when you acted elsewhere).'}
          onClose={() => setResolving(null)}
          onConfirm={async (reason) => {
            const r = await api('/api/admin/moderation/reports/resolve', { method: 'POST', body: { target: { kind: resolving.target.kind, id: resolving.target.id }, state: resolving.to, reason } });
            act.set('done', `${r.count} report${r.count === 1 ? '' : 's'} ${resolving.to}`);
            p.reload();
          }} />
      )}
      {removing && (
        <ConfirmDialog title={`Remove the link “${removing.label}”?`} confirmLabel="Remove link" playersSee
          what={`It leaves the guild page at once, its open reports are closed, and it’s logged on the guild with your reason. ${removing.url ?? ''}`}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api(`/api/admin/guild-links/${removing.id}/remove`, { method: 'POST', body: { reason } });
            act.set('done', 'Link removed');
            p.reload();
          }} />
      )}
      {guild && <GuildTextModal target={guild} admin={admin} onClose={() => { setGuild(null); p.reload(); }} />}
    </>
  );
}

/** A reported guild page's text, resettable part by part (moderators too: fields.reset). */
function GuildTextModal({ target, admin, onClose }) {
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [part, setPart] = useState(null);
  const load = () => api(`/api/admin/moderation/guilds/${target.id}`).then(setData, (err) => setProblem(err.message));
  useEffect(() => {
    load();
  }, [target.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={`${target.label}: guild page text`} onClose={onClose}
      actions={<>{admin && <Link className="btn ghost" to={`/admin/directory/guilds/${target.id}/links`}>Open in Directory</Link>}<button type="button" className="btn" onClick={onClose}>Close</button></>}>
      {problem ? <div className="perr" role="alert"><Icon name="error" /><span>{problem}</span></div> : !data ? <span className="muted small" role="status">Loading…</span> : <GuildText data={data} onReset={setPart} />}
      {part && <GuildResetDialog guildId={target.id} part={part} onClose={() => setPart(null)} onDone={load} />}
    </Modal>
  );
}
