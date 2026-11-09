import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { useEditing } from '../chrome/updates.js';
import { Button, Field, Modal, Segmented, Tabs, Toggle } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatDateTime } from '../format.js';
import { PlayerDetail } from './PlayersSection.jsx';

/**
 * Moderation in the admin area (0.8.2; server/moderation/). Linked only from /admin; the API is behind its own gate (the
 * admin, or a moderator while moderators are switched on), a plain 404 for everyone else.
 *
 *   /admin/accounts       every player account (admin only): search, filters, paged. No export. No BattleTags or Discord
 *                         names: those show only on an account's page after "Reveal", which is logged.
 *   /admin/accounts/:id   the username tools (admin) + the Moderation section: status, actions, reports, full history
 *   /admin/reports        reports grouped by what was reported (profiles, guild descriptions, guild links)
 *
 * What the actor may do comes from the server (`can`, moderation/permissions.js); hidden buttons are a convenience, the
 * server checks every call. A moderator sees the Reports queue and a reported account's Moderation section only.
 */
function useModerationMe() {
  const navigate = useNavigate();
  const [me, setMe] = useState(undefined);
  useEffect(() => {
    api('/api/admin/moderation/me').then(setMe, (err) => setMe(err.status === 404 ? null : { error: err.message }));
  }, []);
  useEffect(() => {
    if (me === null) navigate('/admin/sign-in', { replace: true });
  }, [me, navigate]);
  return me;
}

function Head({ title, me, children = null }) {
  return (
    <div className="row gap-12 wrap-row">
      <h1 className="h1 admin-title">{title}</h1>
      <span className="tag gold">{me?.actor?.kind === 'moderator' ? 'Moderator' : 'Owner only'}</span>
      <span className="spacer" />
      {children}
      {me?.can?.['accounts.list'] && <Link className="btn ghost sm" to="/admin/accounts">Accounts</Link>}
      <Link className="btn ghost sm" to="/admin/reports">Reports</Link>
      {me?.actor?.kind === 'admin' && <Link className="btn ghost sm" to="/admin">Back to admin</Link>}
    </div>
  );
}

const Loading = ({ problem }) => (
  <div className="wrap page-pad">{problem ? <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div> : <span className="t2 small" role="status">Loading…</span>}</div>
);

const accountLabel = (a) => (a.claimed ? `@${a.username}` : `${a.username} (placeholder)`);

export function StatusTag({ status }) {
  if (status.id === 'banned') return <span className="tag err">Banned</span>;
  if (status.id === 'temp_banned') return <span className="tag err">Banned until {formatDate(status.until)}</span>;
  if (status.id === 'warned') return <span className="tag warn">Warned</span>;
  return <span className="tag">Active</span>;
}

const yes = (v) => (v ? <span className="yes">Yes</span> : <span className="muted">No</span>);

// ---------------------------------------------------------------------------------------------------- Accounts list
export function AccountsAdminPage() {
  const me = useModerationMe();
  const toast = useToasts();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState(null);
  const [moderatorsOn, setModeratorsOn] = useState(null);

  const load = useCallback(async (cursor = null) => {
    try {
      const r = await api(`/api/admin/moderation/accounts?filter=${filter}&q=${encodeURIComponent(query)}${cursor ? `&cursor=${cursor}` : ''}`);
      setData((d) => (cursor && d ? { ...r, accounts: [...d.accounts, ...r.accounts] } : r));
    } catch (err) {
      setProblem(err.message);
    }
    setMore(false);
  }, [filter, query]);
  useEffect(() => {
    if (me?.can?.['accounts.list']) load();
  }, [me, load]);
  useEffect(() => {
    if (me) setModeratorsOn(me.moderatorsOn);
  }, [me]);

  if (me === null) return null;
  if (!me || me.error) return <Loading problem={me?.error} />;
  if (!me.can['accounts.list']) {
    return <div className="wrap page-pad stack gap-24"><Head title="Accounts" me={me} /><EmptyState kind="nocoverage" title="Moderators don’t see the accounts list"><span>Open an account from a report instead.</span></EmptyState></div>;
  }
  const toggleModerators = async (on) => {
    try {
      await api('/api/admin/settings/moderation.moderators', { method: 'PUT', body: { value: on } });
      setModeratorsOn(on);
      toast.ok(on ? 'Moderators switched on' : 'Moderators switched off', on ? 'You can now give the moderator role to accounts with 2FA or a passkey.' : 'Accounts with the role are ordinary players again until you switch this back on.');
    } catch (err) {
      toast.err('Couldn’t change it', err.message);
    }
  };

  return (
    <div className="wrap page-pad stack gap-24">
      <Head title="Accounts" me={me} />
      <form className="row gap-8 align-end wrap-row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <Field label="Username, former username, display name or account number" className="flex-fill" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" className="gold">Search</Button>
        {query && <button type="button" className="btn ghost" onClick={() => { setQ(''); setQuery(''); }}>Clear</button>}
      </form>
      <Segmented label="Show" options={Object.entries(data?.filters ?? { all: 'Everyone' }).map(([id, label]) => ({ id, label }))} value={filter} onChange={setFilter} />
      {filter === 'new' && <span className="muted small">{data?.checkedAt ? `Accounts created since you last pressed “Mark as checked” on Admin → Activity (${formatDateTime(data.checkedAt)}).` : 'You haven’t pressed “Mark as checked” on Admin → Activity yet, so nothing counts as new.'}</span>}
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      {!data ? <span className="t2 small" role="status">Loading…</span> : (
        <section className="panel clip" aria-label="Accounts">
          <div className="row gap-8 panel-head-row"><span className="t2 small">{query ? `${data.accounts.length}${data.next ? '+' : ''} matching “${query}”` : `${data.total.toLocaleString('en-US')} account${data.total === 1 ? '' : 's'}`} · newest first · BattleTags and Discord names stay hidden until you reveal them on an account (logged)</span></div>
          {data.accounts.length === 0 ? <div className="pad-20"><EmptyState kind="nodata" compact title="No accounts here"><span>Nobody matches this search and filter.</span></EmptyState></div> : (
            <div className="tblbox">
              <table className="tbl accounts-tbl">
                <thead>
                  <tr>
                    <th scope="col">Account</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Last sign-in</th><th scope="col">Beta</th>
                    <th scope="col" className="r">Chars</th><th scope="col" className="r">Badges</th>
                    <th scope="col">Sign-in</th>
                    <th scope="col" className="r">Feedback</th><th scope="col" className="r">Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link className="mono" to={`/admin/accounts/${a.id}`}>{accountLabel(a)}</Link>
                        <span className="muted xsmall block-line">#{a.id}{a.displayName ? ` · ${a.displayName}` : ''}{a.role === 'moderator' ? ' · moderator' : ''}</span>
                      </td>
                      <td><StatusTag status={a.status} /></td>
                      <td className="nowrap">{formatDate(a.createdAt)}</td>
                      <td className="nowrap">{a.lastSignIn ? formatDate(a.lastSignIn) : <span className="muted">Not recorded</span>}</td>
                      <td>{yes(a.beta)}</td>
                      <td className="r num">{a.characters}</td>
                      <td className="r num">{a.badges}</td>
                      <td>
                        <dl className="signin-yn xsmall">
                          <dt>Battle.net</dt><dd>{yes(a.signIn.battlenet)}</dd>
                          <dt>Discord</dt><dd>{yes(a.signIn.discord)}</dd>
                          <dt>Passkey</dt><dd>{yes(a.signIn.passkey)}</dd>
                          <dt>2FA</dt><dd>{a.twoFactor ? <span className="yes">On</span> : <span className="muted">Off</span>}</dd>
                        </dl>
                      </td>
                      <td className="r num">{a.feedback.threads}{a.feedback.unread > 0 && <span className="tag gold tag-tight">{a.feedback.unread} unread</span>}</td>
                      <td className="r num">{a.openReports > 0 ? <span className="tag warn tag-tight">{a.openReports}</span> : <span className="muted">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.next && <div className="pad-16"><Button className="sm" loading={more} onClick={() => { setMore(true); load(data.next); }}>Show more</Button></div>}
        </section>
      )}
      <section className="panel pad-20 stack gap-12" aria-labelledby="mods-h">
        <h2 className="h2 h2-panel" id="mods-h">Moderators</h2>
        <p className="t2 small">A moderator is a player account with the moderator role. They could see the Reports queue, warn, force a username change, reset a field, ban for up to {me.moderatorMaxBanDays} days, lift a temporary ban, and dismiss reports. They could not ban permanently, lift a permanent ban, see BattleTags or Discord names, give roles or badges, see this list, or reach anything else in admin. The role needs 2FA or a passkey on the account. The Everstats Moderator badge is only cosmetic.</p>
        <Toggle checked={Boolean(moderatorsOn)} onChange={toggleModerators}>Moderators {moderatorsOn ? 'on' : 'off'}</Toggle>
        <span className="muted xsmall">Off: nobody can be given the role, and accounts that have it can’t use it. Changes are logged.</span>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- One account
export function AccountAdminPage() {
  const { id } = useParams();
  const me = useModerationMe();
  const [account, setAccount] = useState(null);
  const [player, setPlayer] = useState(null);
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setAccount((await api(`/api/admin/moderation/accounts/${id}`)).account);
    } catch (err) {
      setProblem(err.message);
    }
    // The username tools are admin only (their API 404s for anyone else).
    api(`/api/admin/players/${id}`).then((r) => setPlayer(r.player), () => setPlayer(null));
  }, [id]);
  useEffect(() => {
    if (me && !me.error) load();
  }, [me, load]);
  if (me === null) return null;
  if (!me || me.error || (!account && !problem)) return <Loading problem={me?.error} />;
  if (!account) return <div className="wrap page-pad stack gap-24"><Head title="Account" me={me} /><div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div></div>;
  return (
    <div className="wrap page-pad stack gap-24">
      <Head title={accountLabel(account)} me={me} />
      <AccountSummary a={account} me={me} />
      <ModerationSection a={account} me={me} onChange={(a) => { setAccount(a); load(); }} />
      {player && <PlayerDetail player={player} onChange={(p) => { setPlayer(p); load(); }} />}
      <HistorySection a={account} />
    </div>
  );
}

function AccountSummary({ a, me }) {
  const toast = useToasts();
  const [revealed, setRevealed] = useState(null);
  const reveal = async () => {
    try {
      setRevealed((await api(`/api/admin/moderation/accounts/${a.id}/reveal`, { method: 'POST', body: {} })).identities);
    } catch (err) {
      toast.err('Couldn’t reveal them', err.message);
    }
  };
  return (
    <section className="panel pad-20 stack gap-12" aria-label="Account">
      <div className="row gap-10 wrap-row">
        <StatusTag status={a.status} />
        {a.role === 'moderator' && <span className="tag gold">Moderator since {formatDate(a.roleSince)}</span>}
        {a.beta && <span className="tag">Beta member</span>}
        <span className="muted xsmall">Account #{a.id} · created {formatDateTime(a.createdAt)} · last sign-in {a.lastSignIn ? formatDateTime(a.lastSignIn) : 'not recorded'}</span>
      </div>
      <dl className="kv-grid small">
        <dt>Display name</dt><dd>{a.displayName ?? <span className="muted">None</span>}</dd>
        <dt>Characters</dt><dd>{a.characters}</dd>
        <dt>Badges</dt><dd>{a.badges}</dd>
        <dt>Sign-in</dt><dd>{[a.signIn.battlenet && 'Battle.net', a.signIn.discord && 'Discord', a.signIn.passkey && 'Passkey'].filter(Boolean).join(' · ') || 'None'}</dd>
        <dt>2FA</dt><dd>{a.twoFactor ? 'On' : 'Off'}</dd>
        <dt>Feedback</dt><dd>{a.feedback.threads} thread{a.feedback.threads === 1 ? '' : 's'}{a.feedback.unread ? `, ${a.feedback.unread} unread` : ''}{a.appeals.length ? ` · ${a.appeals.length} appeal${a.appeals.length === 1 ? '' : 's'}` : ''}{me.actor.kind === 'admin' && a.feedback.threads > 0 && <> · <Link to="/admin/feedback">Open Feedback</Link></>}</dd>
        {a.claimed && !a.status.id.includes('banned') && <><dt>Profile</dt><dd><Link to={`/u/${a.username}`}>/u/{a.username}</Link></dd></>}
      </dl>
      {me.can['identities.reveal'] && (
        <div className="stack gap-6">
          {!revealed ? (
            <div className="row gap-8 wrap-row"><span className="muted small">BattleTags and Discord names are hidden.</span><button type="button" className="btn sm ghost" onClick={reveal}>Reveal</button><span className="muted xsmall">Each reveal is logged in this account’s history.</span></div>
          ) : (
            <ul className="plain stack gap-4 small">
              {revealed.length === 0 && <li className="muted">No Battle.net or Discord linked.</li>}
              {revealed.map((i) => <li key={i.provider}><b>{i.provider === 'battlenet' ? 'Battle.net' : i.provider === 'discord' ? 'Discord' : i.provider}</b> <span className="mono">{i.displayName ?? '(no name given)'}</span> <span className="muted xsmall">· linked {formatDate(i.linkedAt)}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const ACTIONS = [
  { id: 'warn', label: 'Warn', can: 'warn' },
  { id: 'rename', label: 'Force username change', can: 'username.reset' },
  { id: 'reset', label: 'Reset a field', can: 'fields.reset' },
  { id: 'ban', label: 'Ban', can: 'ban.temporary' },
  { id: 'unban', label: 'Lift ban', can: 'unban.temporary' },
];

function ModerationSection({ a, me, onChange }) {
  const toast = useToasts();
  const banned = a.status.id.includes('banned');
  const options = ACTIONS.filter((x) => me.can[x.can] && (x.id === 'unban' ? banned : x.id !== 'ban' || !banned || a.status.id === 'temp_banned') && (x.id !== 'rename' || a.claimed) && (x.id !== 'reset' || a.fields.length > 0));
  const [action, setAction] = useState(options[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [closeReports, setCloseReports] = useState(true);
  const [hold, setHold] = useState(true);
  const [field, setField] = useState(null);
  const [kind, setKind] = useState('temporary');
  const [days, setDays] = useState(me.banPresets[0]);
  const [until, setUntil] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  useEditing(reason.trim().length > 0 || message.trim().length > 0);
  useEffect(() => {
    if (!options.some((o) => o.id === action)) setAction(options[0]?.id ?? null);
  }, [options.map((o) => o.id).join(), action]); // eslint-disable-line react-hooks/exhaustive-deps

  const presets = me.banPresets.filter((d) => me.actor.kind === 'admin' || d <= me.moderatorMaxBanDays);
  const liveBan = a.bans.find((b) => b.live);
  const body = () => {
    const base = { reason, message, closeReports };
    if (action === 'rename') return { ...base, hold };
    if (action === 'reset') return { ...base, field };
    if (action === 'ban') return kind === 'permanent' ? { ...base, kind } : { ...base, kind, ...(days === 'custom' ? { until: new Date(until).toISOString() } : { days }) };
    return base;
  };
  const ready = reason.trim().length >= 3 && (action !== 'reset' || field) && (action !== 'ban' || kind === 'permanent' || days !== 'custom' || (until && Number.isFinite(Date.parse(until))));
  const run = async () => {
    setConfirm(false);
    setBusy(true);
    setProblem(null);
    try {
      const r = await api(`/api/admin/moderation/accounts/${a.id}/${action}`, { method: 'POST', body: body() });
      setReason('');
      setMessage('');
      setField(null);
      onChange(r.account);
      const what = { warn: 'Warning sent', rename: 'Username reset', reset: 'Field reset', ban: 'Account banned', unban: 'Ban lifted' }[action];
      toast.ok(what, action === 'ban' && r.result ? `${r.result.sessionsEnded} session${r.result.sessionsEnded === 1 ? '' : 's'} ended. Refused while it lasts: ${[...r.result.identities.providers, r.result.identities.passkeys ? `${r.result.identities.passkeys} passkey${r.result.identities.passkeys === 1 ? '' : 's'}` : null].filter(Boolean).join(', ') || 'no sign-in links on record'}.` : 'Logged in the history below.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  const summary = {
    warn: 'They see this warning once, the next time they load Everstats signed in, and acknowledge it.',
    rename: `@${a.username} becomes a placeholder, their display name is cleared, and they’re asked to choose again. It doesn’t use up a rename.`,
    reset: 'The field goes back to empty. They’re told which one and why.',
    ban: `They’re signed out everywhere. Their profile, bio, socials, badges, “Claimed by”, share-card defaults and guild editing are hidden while it lasts; their characters stay as Blizzard data. Their Battle.net, Discord and passkeys can’t sign in (except to the ban notice and appeal), create an account, link or merge. ${kind === 'permanent' ? 'It lasts until you lift it.' : 'It lifts by itself at the end you choose.'}`,
    unban: 'Everything comes back as it was. They see why on their next sign-in.',
  }[action];

  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="mod-h">
      <h2 className="h2 h2-panel" id="mod-h">Moderation</h2>
      {liveBan && (
        <div className="note err small" role="status"><Icon name="lock" /><span>{liveBan.kind === 'permanent' ? 'Banned permanently' : `Banned until ${formatDateTime(liveBan.endsAt)}`} since {formatDateTime(liveBan.startsAt)} by {liveBan.by}. Reason: {liveBan.reason}</span></div>
      )}
      {a.openReports > 0 && <div className="note warn small"><Icon name="warning" /><span>{a.openReports} open report{a.openReports === 1 ? '' : 's'} about this account (below).</span></div>}
      {!options.length ? <span className="muted small">There’s nothing you can do to this account.</span> : (
        <>
          <Segmented label="Action" options={options.map((o) => ({ id: o.id, label: o.label }))} value={action} onChange={(v) => { setAction(v); setProblem(null); }} />
          <p className="t2 small">{summary}</p>
          {action === 'rename' && <Toggle checked={hold} onChange={setHold}>Hold @{a.username} so nobody can claim it (release it later from Reserved names on /admin)</Toggle>}
          {action === 'reset' && (
            <fieldset className="plain-fieldset stack gap-8">
              <legend className="lbl">Which field?</legend>
              <div className="stack gap-6" role="radiogroup" aria-label="Which field?">
                {a.fields.map((f) => (
                  <button key={f.id} type="button" role="radio" aria-checked={field === f.id} className={`btn sm left field-choice ${field === f.id ? 'gold' : 'ghost'}`} onClick={() => setField(f.id)}>
                    <b>{f.label}</b><span className="t2 small field-value">{f.value}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {action === 'ban' && (
            <div className="stack gap-10">
              {me.can['ban.permanent'] && <Segmented label="Kind" options={[{ id: 'temporary', label: 'Temporary' }, { id: 'permanent', label: 'Permanent' }]} value={kind} onChange={setKind} />}
              {kind === 'temporary' && (
                <>
                  <Segmented label="How long" options={[...presets.map((d) => ({ id: d, label: `${d} day${d === 1 ? '' : 's'}` })), { id: 'custom', label: 'Custom end' }]} value={days} onChange={setDays} />
                  {days === 'custom' && <Field label={`Ends (your local time)${me.actor.kind === 'moderator' ? `, at most ${me.moderatorMaxBanDays} days from now` : ''}`} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
                </>
              )}
            </div>
          )}
          <Field label="Reason (required: logged, and the player sees it)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <div className="stack gap-6">
              <label className="lbl" htmlFor="mod-msg">Message to the player (optional)</label>
              <textarea id="mod-msg" className="inp" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
              <span className="muted xsmall">Plain text. Shown with the notice, signed “Everstats”: never your name.</span>
            </div>
          {a.openReports > 0 && action !== 'unban' && <Toggle checked={closeReports} onChange={setCloseReports}>Mark the {a.openReports} open report{a.openReports === 1 ? '' : 's'} as actioned</Toggle>}
          {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
          <Button className={`self-start ${['ban', 'rename', 'reset'].includes(action) ? 'danger' : 'gold'}`} loading={busy} disabled={!ready} onClick={() => (['ban', 'rename', 'reset'].includes(action) ? setConfirm(true) : run())}>
            {options.find((o) => o.id === action)?.label}
          </Button>
        </>
      )}
      {confirm && (
        <Modal title={`${options.find((o) => o.id === action)?.label}: ${accountLabel(a)}?`} onClose={() => setConfirm(false)} actions={<><button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button><Button className="danger" onClick={run}>Confirm</Button></>}>
          <p className="t2 small">{summary}</p>
          <p className="small"><b>Reason:</b> {reason}</p>
        </Modal>
      )}
      <RoleControl a={a} me={me} onChange={onChange} />
      <ReportsOfAccount reports={a.reports} />
    </section>
  );
}

function RoleControl({ a, me, onChange }) {
  const toast = useToasts();
  const [reason, setReason] = useState('');
  const [badge, setBadge] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!me.can['roles.grant']) return null;
  if (!me.moderatorsOn) return <span className="muted xsmall">Moderator role: switched off for everyone (Accounts → Moderators).</span>;
  const give = a.role !== 'moderator';
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/admin/moderation/accounts/${a.id}/role`, { method: 'PUT', body: { role: give ? 'moderator' : 'player', reason, badge } });
      setReason('');
      onChange(r.account);
      toast.ok(give ? 'Moderator role given' : 'Moderator role removed');
    } catch (err) {
      toast.err('Couldn’t change the role', err.message);
    }
    setBusy(false);
  };
  return (
    <div className="raised pad-16 stack gap-10">
      <span className="eyebrow">Moderator role</span>
      {give && !a.strongSignIn && <span className="t2 small">This account needs 2FA or a passkey before it can be a moderator.</span>}
      <Field label="Reason (logged)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <Toggle checked={badge} onChange={setBadge}>{give ? 'Also grant the Everstats Moderator badge (cosmetic)' : 'Also revoke the Everstats Moderator badge'}</Toggle>
      <Button className="sm self-start" loading={busy} disabled={reason.trim().length < 3 || (give && !a.strongSignIn)} onClick={save}>{give ? 'Give the moderator role' : 'Remove the moderator role'}</Button>
    </div>
  );
}

function ReportItem({ r }) {
  const s = r.snapshot ?? {};
  const reported = r.what === 'bio' ? s.bio : r.what === 'social' ? `${r.platform}: ${s.handle}` : r.what === 'display_name' ? s.displayName : r.what === 'username' ? (s.username ? `@${s.username}` : null) : r.what === 'badges' ? (s.badges ?? []).join(', ') : r.what === 'guild_description' ? s.description : null;
  return (
    <li className="well pad-12 stack gap-4">
      <span className="row gap-8 wrap-row"><b className="small">{r.whatLabel}</b><span className="muted xsmall">{formatDateTime(r.at)}{r.signedIn === null ? '' : r.signedIn ? ' · sent signed in' : ' · sent signed out'}{r.state !== 'open' ? ` · ${r.state}` : ''}</span></span>
      {reported && <span className="small"><span className="muted">As reported: </span><span className="fb-body inline-pre">{reported}</span></span>}
      {r.note && <p className="fb-body small">{r.note}</p>}
    </li>
  );
}

function ReportsOfAccount({ reports }) {
  if (!reports.length) return null;
  return (
    <div className="stack gap-8">
      <span className="eyebrow">Reports about this account</span>
      <ul className="plain stack gap-6">{reports.slice(0, 30).map((r) => <ReportItem key={r.id} r={r} />)}</ul>
    </div>
  );
}

function HistorySection({ a }) {
  return (
    <section className="panel pad-20 stack gap-12" aria-labelledby="hist-h">
      <h2 className="h2 h2-panel" id="hist-h">Moderation history</h2>
      {a.history.length === 0 ? <span className="muted small">Nothing yet.</span> : (
        <ol className="plain stack gap-8 mod-history">
          {a.history.map((h) => (
            <li key={h.id} className="stack gap-2">
              <span className="row gap-8 wrap-row"><b className="small">{h.changed}</b><span className="muted xsmall">{formatDateTime(h.at)} · by {h.by}</span>{h.notice && <span className={`tag tag-tight ${h.acknowledgedAt ? '' : 'warn'}`}>{h.acknowledgedAt ? `Seen ${formatDate(h.acknowledgedAt)}` : 'Not seen yet'}</span>}</span>
              {h.reason && <span className="small t2">Why: {h.reason}</span>}
              {h.message && <span className="small t2 fb-body">Message: {h.message}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------- Reports
export function ReportsAdminPage() {
  const me = useModerationMe();
  const toast = useToasts();
  const [state, setState] = useState('open');
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [guild, setGuild] = useState(null);
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/moderation/reports?state=${state}`));
    } catch (err) {
      setProblem(err.message);
    }
  }, [state]);
  useEffect(() => {
    if (me && !me.error) load();
  }, [me, load]);
  if (me === null) return null;
  if (!me || me.error) return <Loading problem={me?.error} />;
  const resolve = async (target, to) => {
    try {
      await api('/api/admin/moderation/reports/resolve', { method: 'POST', body: { target: { kind: target.kind, id: target.id }, state: to } });
      toast.ok(to === 'dismissed' ? 'Dismissed' : 'Marked actioned', 'Logged.');
      load();
    } catch (err) {
      toast.err('Couldn’t do that', err.message);
    }
  };
  return (
    <div className="wrap page-pad stack gap-24">
      <Head title="Reports" me={me} />
      <p className="t2 small">Reports from profiles (“Report this profile”), guild descriptions and guild links, grouped by what was reported. Everstats doesn’t keep who sent a report, only whether they were signed in.</p>
      <Tabs label="Reports" idPrefix="rep" value={state} onChange={(s) => { setState(s); setData(null); }}
        tabs={[{ id: 'open', label: 'Open', count: data?.open }, { id: 'actioned', label: 'Actioned' }, { id: 'dismissed', label: 'Dismissed' }]} />
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div role="tabpanel" id={`rep-panel-${state}`} aria-labelledby={`rep-tab-${state}`} className="stack gap-12">
        {!data ? <span className="t2 small" role="status">Loading…</span> : data.groups.length === 0 ? (
          <EmptyState kind="nodata" title={state === 'open' ? 'No open reports' : `Nothing ${state}`}><span>{state === 'open' ? 'Reports land here as people send them.' : 'Handled reports are listed here.'}</span></EmptyState>
        ) : data.groups.map((g) => (
          <section key={`${g.target.kind}:${g.target.id}`} className="panel pad-20 stack gap-10" aria-label={g.target.label}>
            <div className="row gap-10 wrap-row">
              <span className="tag">{g.target.kind === 'account' ? 'Profile' : g.target.kind === 'guild' ? 'Guild description' : 'Guild link'}</span>
              <b className="mono">{g.target.label}</b>
              {g.target.displayName && <span className="t2 small">{g.target.displayName}</span>}
              {g.target.banned && <span className="tag err">Banned</span>}
              {g.target.removed && <span className="tag">Link removed</span>}
              <span className="tag gold tag-tight">{g.count} report{g.count === 1 ? '' : 's'}</span>
              <span className="spacer" />
              <span className="muted xsmall">Latest {formatDateTime(g.latest)}</span>
            </div>
            <ul className="plain stack gap-6">{g.items.map((r) => <ReportItem key={`${g.target.kind}-${r.id}`} r={r} />)}</ul>
            <div className="row gap-8 wrap-row">
              {g.target.kind === 'account' && g.target.exists && <Link className="btn sm gold" to={`/admin/accounts/${g.target.id}`}>Open account and actions</Link>}
              {g.target.kind === 'guild' && <button type="button" className="btn sm gold" onClick={() => setGuild(g.target)}>Guild text and actions</button>}
              {g.target.kind === 'guild' && g.target.slug && <Link className="btn sm ghost" to={`/g/${encodeURIComponent(g.target.slug)}`}>Guild page</Link>}
              {g.target.kind === 'link' && me.actor.kind === 'admin' && <Link className="btn sm gold" to="/admin/guild-links">Remove on Guild links</Link>}
              {g.target.kind === 'link' && g.target.guild && <Link className="btn sm ghost" to={`/g/${encodeURIComponent(g.target.guild.slug)}`}>{g.target.guild.name}</Link>}
              {state === 'open' && me.can['reports.dismiss'] && (
                <>
                  <span className="spacer" />
                  <button type="button" className="btn sm ghost" onClick={() => resolve(g.target, 'actioned')}>Mark actioned</button>
                  <button type="button" className="btn sm ghost" onClick={() => resolve(g.target, 'dismissed')}>Dismiss</button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {guild && <GuildModeration target={guild} me={me} onClose={() => { setGuild(null); load(); }} />}
    </div>
  );
}

function GuildModeration({ target, me, onClose }) {
  const toast = useToasts();
  const [data, setData] = useState(null);
  const [part, setPart] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const load = useCallback(() => api(`/api/admin/moderation/guilds/${target.id}`).then(setData, (err) => setProblem(err.message)), [target.id]);
  useEffect(() => {
    load();
  }, [load]);
  const g = data?.guild;
  const parts = g ? [g.description && { id: 'description', label: 'Description', value: g.description }, g.links.length > 0 && { id: 'links', label: 'Links', value: g.links.map((l) => `${l.label} — ${l.host}`).join(' · ') }, g.discord && { id: 'discord', label: 'Discord invite', value: g.discord }].filter(Boolean) : [];
  const reset = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/admin/moderation/guilds/${target.id}/reset`, { method: 'POST', body: { part, reason } });
      toast.ok('Reset', 'Logged on the guild’s history.');
      setPart(null);
      setReason('');
      load();
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <Modal title={`${target.label}: guild page text`} busy={busy} onClose={onClose} actions={<><button type="button" className="btn ghost" onClick={onClose}>Close</button>{me.can['fields.reset'] && <Button className="danger" loading={busy} disabled={!part || reason.trim().length < 3} onClick={reset}>Reset</Button>}</>}>
      {!data ? <span className="t2 small" role="status">Loading…</span> : (
        <div className="stack gap-12">
          {parts.length === 0 ? <span className="muted small">This guild page has no description, links or invite now.</span> : (
            <div className="stack gap-6" role="radiogroup" aria-label="What to reset">
              {parts.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={part === p.id} className={`btn sm left field-choice ${part === p.id ? 'gold' : 'ghost'}`} onClick={() => setPart(p.id)}>
                  <b>{p.label}</b><span className="t2 small field-value">{p.value}</span>
                </button>
              ))}
            </div>
          )}
          {me.can['fields.reset'] && parts.length > 0 && <Field label="Reason (required, logged)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
          {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
          {data.history.length > 0 && (
            <ul className="plain stack gap-4 small">{data.history.map((h) => <li key={h.id}>{h.changed} <span className="muted xsmall">· {formatDateTime(h.at)} · by {h.by}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}</ul>
          )}
        </div>
      )}
    </Modal>
  );
}
