import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { useEditing } from '../../chrome/updates.js';
import { BadgeIcon } from '../../badges/Badges.jsx';
import { Field, Modal, Segmented, Toggle } from '../../components/Controls.jsx';
import { Fresh } from '../../components/EmptyState.jsx';
import { TierBadge } from '../../components/Tier.jsx';
import { formatDate, formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { ActionButton, ActionStatus, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, useAction } from '../shell/parts.jsx';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { useScope, useShellInfo } from '../shell/scope.jsx';
import './moderation.css';

/**
 * Directory (0.10.3, design/v5-admin pages directory-accounts, account-detail, reserved-usernames, directory-characters,
 * directory-guilds, guild-links; states directory-empty, directory-error, confirm-ban). Moved here from the 0.8.2
 * ModerationPages (accounts, account detail), PlayersSection (username tools, reserved names) and GuildLinksAdminPage.
 *
 *   /admin/directory/accounts               every player account (admin only): search, filters, cursor pages
 *   /admin/directory/accounts/:id           moderation bar + identity (Reveal asks a reason) + characters + badges + history
 *   /admin/directory/accounts/reserved      the reserved-names list (admin only; never sent anywhere else)
 *   /admin/directory/characters             every tracked character of the switcher's version (admin only, read only)
 *   /admin/directory/guilds                 every guild of the switcher's version
 *   /admin/directory/guilds/:id/links       one guild's links (live and removed), their reports, its page text
 *   /admin/directory/guilds/links           every reported and recent link + the domain blocklist
 *
 * Moderators (only while the Moderator role feature is on) reach the account pages through /api/admin/moderation: what
 * they may do comes from `can` (server/moderation/permissions.js). Hidden buttons are a convenience: the server checks.
 *
 * Different from the design, on purpose (CLAUDE.md wins):
 *   - No native <select>: filters are segmented buttons.
 *   - Characters: no Refresh button. There are no admin character actions (the public page's Refresh is the only one);
 *     "Open" goes to the public page, which only the primary version has before 0.11.0.
 *   - Guilds: only the Links subpage is built (Overview / Badges / Roster tabs aren't: the public guild page has them).
 *     A removed link can't be restored: no such action exists (the editors add it again).
 *   - Reserved usernames: the kinds are the ones the server stores; held names can be released by name, but there is no
 *     list of every hold, and the blocked stems / profanity list are applied, not listed or searchable here.
 */

// ------------------------------------------------------------------------------------------------- shared pieces
export function useModerationMe() {
  const [state, setState] = useState({ me: undefined, error: null });
  useEffect(() => {
    let live = true;
    api('/api/admin/moderation/me').then((me) => live && setState({ me, error: null }), (error) => live && setState({ me: null, error }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export const accountLabel = (a) => (a.claimed ? `@${a.username}` : `${a.username} (placeholder)`);
const initials = (a) => String(a.username ?? '?').replace(/^user[-_]/, '').slice(0, 2).toUpperCase();

export function StatusChip({ status }) {
  if (status.id === 'banned') return <Chip kind="err" icon="lock">Banned</Chip>;
  if (status.id === 'temp_banned') return <Chip kind="warn" icon="lock">Temp-banned · until {formatDate(status.until)}</Chip>;
  if (status.id === 'warned') return <Chip kind="warn">Warned</Chip>;
  return <Chip kind="ok">Active</Chip>;
}

const signInWords = (s) => [s.battlenet && 'Battle.net', s.discord && 'Discord', s.passkey && 'Passkey'].filter(Boolean).join(' · ') || 'None';

/** Pages through a keyset-paged list; the stack resets whenever `key` (the filters) changes. */
function usePager(key) {
  const [st, setSt] = useState({ key, stack: [null] });
  const stack = st.key === key ? st.stack : [null];
  return {
    cursor: stack[stack.length - 1],
    page: stack.length,
    next: (c) => setSt({ key, stack: [...stack, c] }),
    prev: () => setSt({ key, stack: stack.length > 1 ? stack.slice(0, -1) : stack }),
  };
}

function Pager({ pager, shown, total, next, size = 50, noun }) {
  const from = (pager.page - 1) * size + 1;
  return (
    <div className="pager">
      {shown === 0 ? `0 ${noun}` : `${formatNumber(from)}–${formatNumber(from + shown - 1)}${total !== null && total !== undefined ? ` of ${formatNumber(total)}` : ''}`}
      <span className="spacer" />
      <button type="button" className="btn sm" disabled={pager.page === 1} onClick={pager.prev}>Previous</button>
      <button type="button" className="btn sm" disabled={!next} onClick={() => pager.next(next)}>Next</button>
    </div>
  );
}

function SearchBox({ label, value, onSubmit, placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form className="search-form" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()); }}>
      <label className="search">
        <Icon name="search" size="sm" />
        <input placeholder={placeholder} aria-label={label} value={v} onChange={(e) => setV(e.target.value)} data-edit-guard="off" />
      </label>
      <button type="submit" className="btn sm">Search</button>
      {value && <button type="button" className="btn sm ghost" onClick={() => onSubmit('')}>Clear</button>}
    </form>
  );
}

function Filter({ label, options, value, onChange }) {
  return (
    <span className="fgroup">
      <span className="flab">{label}</span>
      <Segmented label={label} options={options} value={value} onChange={onChange} scroll={false} />
    </span>
  );
}

/**
 * A moderation dialog: the confirm-dialog.md shape (a question, what happens, whether players see it, the extra choices,
 * a REQUIRED reason, an optional message to the player, a danger button naming the action). ConfirmDialog has no slot
 * for the extra choices (ban length, which field), so this mirrors it with one.
 */
export function ModDialog({ title, what, playersSee = true, confirmLabel, danger = true, ready = true, message = true, reasonLabel, children = null, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  useEditing(reason.trim().length > 0 || note.trim().length > 0);
  const ok = reason.trim().length >= 3 && ready;
  const go = async () => {
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm({ reason: reason.trim(), message: note.trim() });
      onClose();
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} busy={busy}
      actions={(
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'gold'}${busy ? ' is-loading' : ''}`} onClick={go} disabled={!ok || busy} aria-busy={busy || undefined}>{confirmLabel}</button>
        </>
      )}>
      <div className="stack gap-14 adlg-body">
        <p className="t2 small">{what}</p>
        <Chip kind={playersSee ? 'vis' : 'off'}>{playersSee ? 'The player sees this' : 'Admin and background only'}</Chip>
        {children}
        <label className="field">
          <span className="lab">{reasonLabel ?? (playersSee ? 'Reason (required: saved to the audit log, and the player sees it)' : 'Reason (required: saved to the audit log)')}</span>
          <textarea className="inp" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        {message && (
          <label className="field">
            <span className="lab">Message to the player (optional)</span>
            <textarea className="inp" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <span className="help">Plain text, shown with the notice and signed “Everstats”: never your name.</span>
          </label>
        )}
        {problem && <div className="perr" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      </div>
    </Modal>
  );
}

function DirectoryHead({ active }) {
  const info = useShellInfo();
  const { apiQuery } = useScope();
  const moderator = info.role === 'moderator';
  const counts = usePanel(`dir-counts-${apiQuery}`, () => (moderator ? Promise.resolve(null) : api(`/api/admin/directory/counts?${apiQuery}`)), [apiQuery, moderator]);
  const c = counts.data;
  const tabs = moderator ? [{ to: '/admin/directory/accounts', label: 'Accounts', prefix: true }] : [
    { to: '/admin/directory/accounts', label: 'Accounts', count: c ? formatNumber(c.accounts) : null, active: active === 'accounts' },
    { to: '/admin/directory/characters', label: 'Characters', count: c ? formatNumber(c.characters) : null, active: active === 'characters' },
    { to: '/admin/directory/guilds', label: 'Guilds', count: c ? formatNumber(c.guilds) : null, active: active === 'guilds' },
  ];
  const desc = {
    accounts: 'Everything on the site in one place. Accounts are global; characters and guilds follow the version switcher.',
    characters: 'Characters follow the version switcher. Read only: there are no admin character actions.',
    guilds: 'Guilds follow the version switcher. The Guild links view lists every reported and recent link in one place.',
  }[active];
  return <PageHead title="Directory" desc={desc} tabs={tabs} chips={active === 'accounts' ? <ScopeChip global /> : <ScopeChip />} />;
}

// ------------------------------------------------------------------------------------------------- Accounts list
const STATUS_OPTS = [{ id: '', label: 'Any' }, { id: 'active', label: 'Active' }, { id: 'warned', label: 'Warned' }, { id: 'temp_banned', label: 'Temp-banned' }, { id: 'banned', label: 'Banned' }];
const SIGNIN_OPTS = [{ id: '', label: 'Any' }, { id: 'battlenet', label: 'Battle.net' }, { id: 'discord', label: 'Discord' }, { id: 'passkey', label: 'Passkey' }];
const TWOFA_OPTS = [{ id: '', label: 'Any' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }];
const CREATED_OPTS = [{ id: '', label: 'Any time' }, { id: '7d', label: 'Last 7 days' }, { id: '30d', label: 'Last 30 days' }];

export function AccountsDirectoryPage() {
  const { me, error } = useModerationMe();
  const info = useShellInfo();
  const [f, setF] = useState({ q: '', filter: 'all', status: '', signin: '', twofa: '', created: '' });
  const key = JSON.stringify(f);
  const pager = usePager(key);
  const allowed = me?.can?.['accounts.list'];
  const p = usePanel(`dir-accounts-${key}-${pager.cursor}`, () => {
    if (!allowed) return Promise.resolve(null);
    const qs = new URLSearchParams({ filter: f.filter, q: f.q });
    for (const k of ['status', 'signin', 'twofa', 'created']) if (f[k]) qs.set(k, f[k]);
    if (pager.cursor) qs.set('cursor', pager.cursor);
    return api(`/api/admin/moderation/accounts?${qs}`);
  }, [key, pager.cursor, allowed]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const clear = () => setF({ q: '', filter: 'all', status: '', signin: '', twofa: '', created: '' });
  const filtered = key !== JSON.stringify({ q: '', filter: 'all', status: '', signin: '', twofa: '', created: '' });

  if (me === undefined && !error) return <><DirectoryHead active="accounts" /><span className="muted small" role="status">Loading…</span></>;
  if (error) return <><DirectoryHead active="accounts" /><div className="perr" role="alert"><Icon name="error" /><span>{error.message}</span></div></>;
  if (!allowed) {
    return (
      <>
        <DirectoryHead active="accounts" />
        <section className="ap"><Empty icon="no-coverage" title="Moderators don’t see the accounts list" action={<Link className="btn sm" to="/admin/inbox/reports">Open Inbox › Reports</Link>}>Open an account from a report instead.</Empty></section>
      </>
    );
  }
  const d = p.data;
  return (
    <>
      <DirectoryHead active="accounts" />
      <Panel panel={p} title="Accounts" id="accounts" flush
        sub={d ? <span className="cnt muted xsmall">{d.q ? `${d.accounts.length}${d.next ? '+' : ''} matching “${d.q}”` : `${formatNumber(d.total)} account${d.total === 1 ? '' : 's'}`}</span> : null}
        actions={<Link className="btn ghost sm" to="/admin/directory/accounts/reserved">Reserved usernames</Link>}>
        {(data) => (!data ? <span className="muted small" role="status">Loading…</span> : (
          <>
            <div className="tbar">
              <SearchBox label="Username, former username, display name or account number" placeholder="Handle, former handle, display name or #id" value={f.q} onSubmit={set('q')} />
              <span className="spacer" />
              {filtered && <button type="button" className="btn sm ghost" onClick={clear}>Clear filters</button>}
            </div>
            <div className="mod-filters">
              <Filter label="Status" options={STATUS_OPTS} value={f.status} onChange={set('status')} />
              <Filter label="Sign-in" options={SIGNIN_OPTS} value={f.signin} onChange={set('signin')} />
              <Filter label="2FA" options={TWOFA_OPTS} value={f.twofa} onChange={set('twofa')} />
              <Filter label="Created" options={CREATED_OPTS} value={f.created} onChange={set('created')} />
              <Filter label="Show" options={Object.entries(data?.filters ?? { all: 'Everyone' }).map(([id, label]) => ({ id, label }))} value={f.filter} onChange={set('filter')} />
            </div>
            {f.filter === 'new' && <div className="note small mod-note"><Icon name="info" /><span>{data.checkedAt ? `Accounts created since you last pressed “Mark as checked” on the Dashboard (${formatDateTime(data.checkedAt)}).` : 'You haven’t pressed “Mark as checked” on the Dashboard yet, so nothing counts as new.'}</span></div>}
            {data.accounts.length === 0 ? (
              <Empty icon="search" title="No accounts match" action={filtered ? <button type="button" className="btn sm" onClick={clear}>Clear filters</button> : null}>
                {filtered ? 'Nobody matches this search and these filters.' : 'No player accounts yet.'}
              </Empty>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead>
                    <tr><th>Account</th><th>Status</th><th>Sign-in methods</th><th>2FA</th><th className="r num">Characters</th><th className="r num">Badges</th><th>Feedback</th><th>Reports</th><th>Created</th><th>Last sign-in</th><th className="r"><span className="sr-only">Open</span></th></tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td className="dtl" data-label="">
                          <span className="who2"><span className="av" aria-hidden="true">{initials(a)}</span><Link className="tgt" to={`/admin/directory/accounts/${a.id}`}>{accountLabel(a)}</Link></span>
                          <span className="sub">#{a.id}{a.displayName ? ` · ${a.displayName}` : ''}{a.role === 'moderator' ? ' · moderator' : ''}{a.beta ? ' · beta member' : ''}</span>
                        </td>
                        <td data-label="Status"><StatusChip status={a.status} /></td>
                        <td className="t2" data-label="Sign-in methods">{signInWords(a.signIn)}</td>
                        <td data-label="2FA">{a.twoFactor ? <Chip kind="ok">On</Chip> : <Chip kind="off">Off</Chip>}</td>
                        <td className="r num" data-label="Characters">{formatNumber(a.characters)}</td>
                        <td className="r num" data-label="Badges">{formatNumber(a.badges)}</td>
                        <td data-label="Feedback">{a.feedback.unread > 0 ? <Chip kind="info">{a.feedback.unread} unread</Chip> : <span className="muted">{a.feedback.threads}</span>}</td>
                        <td data-label="Reports">{a.openReports > 0 ? <Chip kind="warn">{a.openReports} open</Chip> : <span className="muted">0</span>}</td>
                        <td data-label="Created"><span className="t2 nw">{formatDate(a.createdAt)}</span></td>
                        <td data-label="Last sign-in"><span className="t2 nw">{a.lastSignIn ? timeAgo(a.lastSignIn) : 'Not recorded'}</span></td>
                        <td className="r" data-label=""><div className="act"><Link className="btn ghost sm" to={`/admin/directory/accounts/${a.id}`}>Open</Link></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager pager={pager} shown={data.accounts.length} total={data.q ? null : data.total} next={data.next} noun="accounts" />
          </>
        ))}
      </Panel>
      {info.role !== 'moderator' && (
        <div className="note small"><Icon name="shield-check" /><span>BattleTags and Discord names stay hidden until you reveal them on an account (a reason is asked for and logged). The moderator role is {me.moderatorsOn ? <b>on</b> : <b>off</b>}: it’s switched in <Link to="/admin/features#feat-moderators">Features</Link>.</span></div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------- One account
const ACTION_WORDS = {
  warn: { label: 'Warn', done: 'Warning sent' },
  rename: { label: 'Force rename', done: 'Username reset' },
  reset: { label: 'Reset fields', done: 'Field reset' },
  ban: { label: 'Temp ban', done: 'Account banned' },
  permaban: { label: 'Ban', done: 'Account banned permanently' },
  unban: { label: 'Lift ban', done: 'Ban lifted' },
};

export function AccountDetailPage() {
  const { id } = useParams();
  const { me, error } = useModerationMe();
  const info = useShellInfo();
  const admin = info.role !== 'moderator';
  const p = usePanel(`acct-${id}`, () => api(`/api/admin/moderation/accounts/${id}`), [id]);
  const player = usePanel(`acct-player-${id}`, () => (admin ? api(`/api/admin/players/${id}`) : Promise.resolve(null)), [id, admin]);
  const chars = usePanel(`acct-chars-${id}`, () => (admin ? api(`/api/admin/directory/accounts/${id}/characters`) : Promise.resolve(null)), [id, admin]);
  const badges = usePanel(`acct-badges-${id}`, () => (admin ? api(`/api/admin/badges/accounts/${id}`) : Promise.resolve(null)), [id, admin]);
  const a = p.data?.account;
  const reloadAll = () => {
    p.reload();
    player.reload();
    badges.reload();
  };
  const title = a ? accountLabel(a) : `Account #${id}`;
  return (
    <>
      <PageHead title={title} chips={<ScopeChip global />}
        crumbs={[{ label: 'Directory', to: '/admin/directory/accounts' }, { label: 'Accounts', to: '/admin/directory/accounts' }, { label: title }]} />
      {error && <div className="perr" role="alert"><Icon name="error" /><span>{error.message}</span></div>}
      <Panel panel={p} title="Moderation" id="moderation">
        {(d) => (me ? <ModerationBlock a={d.account} me={me} onAccount={(acc) => { p.setData({ ...d, account: acc }); reloadAll(); }} /> : <span className="muted small">Loading…</span>)}
      </Panel>
      <div className="dsplit">
        <div className="stack gap-16">
          <Panel panel={p} title="Identity" id="identity">
            {(d) => <Identity a={d.account} me={me} player={player.data?.player ?? null} gold={chars.data?.gold ?? null} admin={admin} />}
          </Panel>
          {admin && (
            <Panel panel={chars} title={chars.data ? `Claimed characters · ${chars.data.characters.length}` : 'Claimed characters'} id="characters" flush>
              {(d) => <ClaimedCharacters list={d.characters} />}
            </Panel>
          )}
          {admin && (
            <Panel panel={badges} title="Badges" id="badges" actions={<Link className="btn ghost sm" to={`/admin/badges/player?account=${id}`}>Grant or revoke</Link>}>
              {(d) => {
                const held = d.account.badges.filter((b) => b.state === 'held');
                return held.length === 0 ? <span className="muted small">No badges.</span> : (
                  <div className="mod-pills">{held.map((b) => <span key={b.id} className="row gap-6 small"><BadgeIcon badge={b} size="inline" /><span>{b.name}</span></span>)}</div>
                );
              }}
            </Panel>
          )}
          {admin && (
            <Panel panel={player} title="Username tools" id="username">
              {(d) => <UsernameTools p={d.player} onChange={(pl) => { player.setData({ player: pl }); p.reload(); }} />}
            </Panel>
          )}
          {admin && me && a && <RolePanel a={a} me={me} onAccount={(acc) => p.setData({ ...p.data, account: acc })} />}
        </div>
        <Panel panel={p} title="History" id="history" footer={admin ? <Link to="/admin/audit">All actions in the Audit log →</Link> : <Link to="/admin/audit">Your actions in the Audit log →</Link>}>
          {(d) => <History list={d.account.history} reports={d.account.reports} />}
        </Panel>
      </div>
    </>
  );
}

function ModerationBlock({ a, me, onAccount }) {
  const [open, setOpen] = useState(null);
  const act = useAction();
  const banned = a.status.id === 'banned' || a.status.id === 'temp_banned';
  const can = me.can ?? {};
  const liveBan = a.bans.find((b) => b.live);
  const show = {
    warn: can.warn,
    rename: can['username.reset'] && a.claimed,
    reset: can['fields.reset'] && a.fields.length > 0,
    ban: can['ban.temporary'] && (!banned || a.status.id === 'temp_banned'),
    permaban: can['ban.permanent'] && a.status.id !== 'banned',
    unban: banned && (a.status.id === 'temp_banned' ? can['unban.temporary'] : can['unban.permanent']),
  };
  const run = async (action, body) => {
    const path = action === 'permaban' ? 'ban' : action;
    const r = await api(`/api/admin/moderation/accounts/${a.id}/${path}`, { method: 'POST', body });
    const extra = (action === 'ban' || action === 'permaban') && r.result
      ? ` · ${r.result.sessionsEnded} session${r.result.sessionsEnded === 1 ? '' : 's'} ended`
      : '';
    act.set('done', `${ACTION_WORDS[action].done}${extra}`);
    onAccount(r.account);
  };
  return (
    <div className="stack gap-12">
      <div className="idhead">
        <span className="av" aria-hidden="true">{initials(a)}</span>
        <div className="stack gap-4">
          <span className="nm">{accountLabel(a)}</span>
          <div className="row gap-6 wrap-row">
            <StatusChip status={a.status} />
            {a.beta && <Chip kind="info">Beta member</Chip>}
            {a.twoFactor ? <Chip kind="ok">2FA on</Chip> : <Chip kind="off">2FA off</Chip>}
            {a.signIn.passkey && <Chip kind="ok" icon="passkey">Passkey</Chip>}
            {a.role === 'moderator' && <Chip kind="info" icon="shield-check">Moderator since {formatDate(a.roleSince)}</Chip>}
          </div>
        </div>
        <span className="spacer" />
        <div className="modbar">
          {show.warn && <button type="button" className="btn sm" onClick={() => setOpen('warn')}>Warn…</button>}
          {show.rename && <button type="button" className="btn sm" onClick={() => setOpen('rename')}>Force rename…</button>}
          {show.reset && <button type="button" className="btn sm" onClick={() => setOpen('reset')}>Reset fields…</button>}
          {show.unban && <button type="button" className="btn sm" onClick={() => setOpen('unban')}>{a.status.id === 'temp_banned' ? 'Lift temp ban…' : 'Lift ban…'}</button>}
          {show.ban && <button type="button" className="btn sm danger" onClick={() => setOpen('ban')}>{a.status.id === 'temp_banned' ? 'Change temp ban…' : 'Temp ban…'}</button>}
          {show.permaban && <button type="button" className="btn sm danger" onClick={() => setOpen('permaban')}>Ban…</button>}
        </div>
      </div>
      <ActionStatus action={act} />
      {!Object.values(show).some(Boolean) && <span className="muted small">There’s nothing you can do to this account.</span>}
      {liveBan && <div className="note err small" role="status"><Icon name="lock" /><span>{liveBan.kind === 'permanent' ? 'Banned permanently' : `Banned until ${formatDateTime(liveBan.endsAt)}`} since {formatDateTime(liveBan.startsAt)} by {liveBan.by}. Reason: “{liveBan.reason}”</span></div>}
      {a.openReports > 0 && <div className="note warn small"><Icon name="flags" /><span>{a.openReports} open report{a.openReports === 1 ? '' : 's'} about this account (in its history). <Link to="/admin/inbox/reports">Inbox › Reports</Link></span></div>}
      {a.appeals.length > 0 && me.actor?.kind === 'admin' && (
        <div className="note small"><Icon name="reply" /><span>Appeal{a.appeals.length === 1 ? '' : 's'}: {a.appeals.map((t, i) => <span key={t.id}>{i > 0 ? ' · ' : ''}<Link to={`/admin/inbox/feedback/${t.id}`}>#{t.id} ({t.state})</Link></span>)}</span></div>
      )}
      {open && <ActionDialog action={open} a={a} me={me} onClose={() => setOpen(null)} onRun={(body) => run(open, body)} />}
    </div>
  );
}

function ActionDialog({ action, a, me, onClose, onRun }) {
  const [hold, setHold] = useState(true);
  const [field, setField] = useState(null);
  const presets = me.banPresets.filter((d) => me.actor.kind === 'admin' || d <= me.moderatorMaxBanDays);
  const [days, setDays] = useState(presets.includes(7) ? 7 : presets[0]);
  const [until, setUntil] = useState('');
  const [closeReports, setCloseReports] = useState(true);
  const name = accountLabel(a);
  const reportsToggle = a.openReports > 0 && action !== 'unban'
    ? <Toggle checked={closeReports} onChange={setCloseReports}>Mark the {a.openReports} open report{a.openReports === 1 ? '' : 's'} as actioned</Toggle>
    : null;
  const banWhat = 'They’re signed out everywhere. Their profile, bio, socials, badges, “Claimed by”, share-card defaults and guild editing are hidden while it lasts; their characters stay as Blizzard data. Their Battle.net, Discord and passkeys can’t sign in (except to the ban notice and appeal), create an account, link or merge.';
  const customOk = days !== 'custom' || (until && Number.isFinite(Date.parse(until)));
  const daysLabel = days === 'custom' ? 'until the end you chose' : `for ${days} day${days === 1 ? '' : 's'}`;
  const cfg = {
    warn: { title: `Warn ${name}?`, what: 'They see this warning once, the next time they load Everstats signed in, and acknowledge it.', confirm: 'Send warning', danger: false, body: () => ({}) },
    rename: {
      title: `Force a new username for ${name}?`,
      what: `@${a.username} becomes a placeholder, their display name is cleared, and they’re asked to choose again. It doesn’t use up a rename.`,
      confirm: 'Force rename', body: () => ({ hold }),
      extra: <Toggle checked={hold} onChange={setHold}>Hold @{a.username} so nobody can claim it (release it later from Reserved usernames)</Toggle>,
    },
    reset: {
      title: `Reset a field on ${name}?`, what: 'The field goes back to empty. They’re told which one and why.', confirm: 'Reset field', ready: Boolean(field), body: () => ({ field }),
      extra: (
        <fieldset className="plain-fieldset stack gap-6">
          <legend className="lbl">Which field?</legend>
          <div className="mod-choice" role="radiogroup" aria-label="Which field?">
            {a.fields.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={field === x.id} className={`btn sm ${field === x.id ? 'gold' : 'ghost'}`} onClick={() => setField(x.id)}>
                <b>{x.label}</b><span className="v">{x.value}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ),
    },
    ban: {
      title: `Temp ban ${name}?`, what: `${banWhat} It lifts by itself at the end.`, confirm: `Temp ban ${daysLabel}`, ready: customOk,
      body: () => ({ kind: 'temporary', ...(days === 'custom' ? { until: new Date(until).toISOString() } : { days }) }),
      extra: (
        <div className="stack gap-8">
          <Segmented label="How long" options={[...presets.map((d) => ({ id: d, label: `${d} day${d === 1 ? '' : 's'}` })), { id: 'custom', label: 'Custom end' }]} value={days} onChange={setDays} />
          {days === 'custom' && <Field label={`Ends (your local time)${me.actor.kind === 'moderator' ? `, at most ${me.moderatorMaxBanDays} days from now` : ''}`} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
          {a.status.id === 'temp_banned' && <span className="muted xsmall">They’re temp-banned now: this starts a new ban with the end you choose.</span>}
        </div>
      ),
    },
    permaban: { title: `Ban ${name} permanently?`, what: `${banWhat} It lasts until you lift it.`, confirm: 'Ban permanently', body: () => ({ kind: 'permanent' }) },
    unban: { title: `Lift the ban on ${name}?`, what: 'Everything comes back as it was. They see why on their next sign-in.', confirm: 'Lift ban', danger: false, body: () => ({}) },
  }[action];
  return (
    <ModDialog title={cfg.title} what={cfg.what} confirmLabel={cfg.confirm} danger={cfg.danger !== false} ready={cfg.ready !== false} onClose={onClose}
      onConfirm={({ reason, message }) => onRun({ ...cfg.body(), reason, message, closeReports })}>
      {cfg.extra}
      {reportsToggle}
    </ModDialog>
  );
}

function Identity({ a, me, player, gold, admin }) {
  const [revealed, setRevealed] = useState(null);
  const [asking, setAsking] = useState(false);
  const canReveal = me?.can?.['identities.reveal'];
  const formerNames = (player?.history ?? []).filter((h) => h.from && h.from !== h.to).slice(0, 3);
  const providers = a.identities.filter((i) => i.provider === 'battlenet' || i.provider === 'discord');
  const shown = (provider) => revealed?.find((i) => i.provider === provider);
  return (
    <div className="stack gap-10">
      <dl className="kvs">
        <dt>Handle</dt>
        <dd>{accountLabel(a)} {formerNames.length > 0 && <span className="muted xsmall">(was {formerNames.map((h) => `“${h.from}” until ${formatDate(h.at)}`).join(', ')})</span>}</dd>
        <dt>Account</dt><dd className="mono2">#{a.id}</dd>
        <dt>Display name</dt><dd>{a.displayName ?? <span className="muted">None</span>}</dd>
        <dt>Bio</dt><dd className="mod-body">{a.bio ?? <span className="muted">None</span>}</dd>
        <dt>Created</dt><dd>{formatDateTime(a.createdAt)}</dd>
        <dt>Last sign-in</dt><dd>{a.lastSignIn ? formatDateTime(a.lastSignIn) : <span className="muted">Not recorded</span>}</dd>
        <dt>Sign-in methods</dt><dd>{signInWords(a.signIn)}{a.twoFactor ? ' · 2FA' : ''}</dd>
        {providers.length === 0 && <><dt>BattleTag / Discord</dt><dd className="muted">None linked</dd></>}
        {providers.map((i) => (
          <div key={i.provider} className="contents">
            <dt>{i.provider === 'battlenet' ? 'BattleTag' : 'Discord'}</dt>
            <dd>
              {shown(i.provider) ? <span className="mono2">{shown(i.provider).displayName ?? '(no name given)'}</span> : <span className="redact"><span className="dots">{i.provider === 'battlenet' ? '••••••#••••' : '•••••••••'}</span></span>}
              {' '}<span className="muted xsmall">linked {formatDate(i.linkedAt)}</span>
              {canReveal && !revealed && <> <button type="button" className="btn sm ghost" onClick={() => setAsking(true)}><Icon name="eye" size="sm" />Reveal…</button></>}
            </dd>
          </div>
        ))}
        <dt>Gold opt-in</dt>
        <dd className="t2">Private · admin sees counts only{admin && gold ? ` (${gold.charactersWithGold} character${gold.charactersWithGold === 1 ? '' : 's'} with gold data, ${gold.shownPublicly} shown publicly)` : ''}</dd>
        <dt>Feedback</dt>
        <dd>{a.feedback.threads} thread{a.feedback.threads === 1 ? '' : 's'}{a.feedback.unread ? `, ${a.feedback.unread} unread` : ''}{admin && a.claimed && a.feedback.threads > 0 && <> · <Link to={`/admin/inbox/feedback?q=${encodeURIComponent(a.username)}`}>Open in Inbox</Link></>}</dd>
        {a.claimed && a.status.id === 'active' && <><dt>Profile</dt><dd><Link to={`/u/${a.username}`}>/u/{a.username}</Link></dd></>}
      </dl>
      <span className="muted xsmall">Reveals ask for a reason and are written to the Audit log; the names themselves never are. Character positions and Blizzard account ids are never stored.</span>
      {asking && (
        <ConfirmDialog title={`Reveal the BattleTag and Discord name of ${accountLabel(a)}?`} danger={false} playersSee={false}
          what="They’re shown here until you leave this page. The reveal and your reason go to this account’s history and the Audit log; the names don’t."
          reasonLabel="Why do you need to see them? (saved to the audit log)" confirmLabel="Reveal"
          onClose={() => setAsking(false)}
          onConfirm={async (reason) => setRevealed((await api(`/api/admin/moderation/accounts/${a.id}/reveal`, { method: 'POST', body: { reason } })).identities)} />
      )}
    </div>
  );
}

function ClaimedCharacters({ list }) {
  if (list.length === 0) return <Empty icon="user" title="No claimed characters">A Battle.net sign-in claims an account’s characters.</Empty>;
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>Character</th><th>Realm · ruleset</th><th className="r num">Level</th><th>Tier</th><th>Visibility</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td className="dtl" data-label="">
                {c.publicPath ? <Link className="tgt" to={c.publicPath}>{c.name ?? '—'} {c.surname}</Link> : <b>{c.name ?? '—'} {c.surname}</b>}
                <span className="sub">{c.version} · {String(c.region).toUpperCase()}{c.state === 'missing' ? ' · Blizzard hasn’t returned it lately' : ''}</span>
              </td>
              <td className="t2" data-label="Realm · ruleset">{[c.realm, c.ruleset].filter(Boolean).join(' · ') || '—'}</td>
              <td className="r num" data-label="Level">{c.level ?? '—'}</td>
              <td data-label="Tier"><TierBadge letter={c.tier?.letter ?? null} size="sm" /></td>
              <td data-label="Visibility">{c.hidden ? <Chip kind="off" icon="eye-off">Hidden</Chip> : <Chip kind="ok" icon="eye">Public</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DOT = { ban: 'err', warning: 'warn', username_reset: 'warn', field_reset: 'warn', guild_reset: 'warn', unban: 'ok', role_granted: 'ok' };

function History({ list, reports }) {
  if (list.length === 0 && reports.length === 0) return <span className="muted small">Nothing yet.</span>;
  return (
    <div className="stack gap-14">
      {list.length > 0 && (
        <ul className="hist">
          {list.map((h) => (
            <li key={h.id}>
              <span className={`dot ${DOT[h.type] ?? ''}`} aria-hidden="true" />
              <b>{h.changed}</b>
              <span className="w">{formatDateTime(h.at)} · {h.by}</span>
              <span className="why">
                {h.reason ? `Reason: “${h.reason}”` : ''}{h.message ? ` · Message: “${h.message}”` : ''}
                {h.notice ? ` · ${h.acknowledgedAt ? `seen ${formatDate(h.acknowledgedAt)}` : 'not seen yet'}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {reports.length > 0 && (
        <div className="stack gap-6">
          <span className="eyebrow">Reports about this account</span>
          <div className="rlist flush-rlist">
            {reports.slice(0, 30).map((r) => <ReportLine key={r.id} r={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** One report: what was reported (as it was), the reporter's note, when, and whether they were signed in. */
export function ReportLine({ r }) {
  const s = r.snapshot ?? {};
  const reported = r.what === 'bio' ? s.bio : r.what === 'social' ? `${r.platform}: ${s.handle}` : r.what === 'display_name' ? s.displayName : r.what === 'username' ? (s.username ? `@${s.username}` : null) : r.what === 'badges' ? (s.badges ?? []).join(', ') : r.what === 'guild_description' ? s.description : null;
  return (
    <div>
      <Icon name="flags" size="sm" />
      <span className="stack gap-2">
        <span><b>{r.whatLabel}</b>{r.note ? <> — <span className="mod-body">“{r.note}”</span></> : null}</span>
        {reported && <span className="muted xsmall mod-body">As reported: “{reported}”</span>}
      </span>
      <span className="muted xsmall nw">{timeAgo(r.at)}{r.signedIn === null || r.signedIn === undefined ? '' : r.signedIn ? ' · signed in' : ' · signed out'}{r.state && r.state !== 'open' ? ` · ${r.state}` : ''}</span>
    </div>
  );
}

function UsernameTools({ p, onChange }) {
  const allowanceAct = useAction();
  const grantAct = useAction();
  const [allowance, setAllowance] = useState(String(p.renamesLeft));
  const [grant, setGrant] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setAllowance(String(p.renamesLeft)), [p.renamesLeft]);
  return (
    <div className="mod-stack">
      <div className="mod-row">
        <Field label="Renames left" inputClassName="num" inputMode="numeric" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        <ActionButton action={allowanceAct} done="Rename allowance set" disabled={!/^\d+$/.test(allowance)}
          onRun={async () => onChange((await api(`/api/admin/players/${p.id}/allowance`, { method: 'PUT', body: { value: Number(allowance) } })).player)}>Set</ActionButton>
        <ActionStatus action={allowanceAct} />
      </div>
      <div className="mod-row">
        <Field label="Grant a name (past the reserved list)" inputClassName="mono" value={grant} onChange={(e) => setGrant(e.target.value.toLowerCase())} />
        <Field label="Note for the log (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <ActionButton action={grantAct} done={() => `Granted @${grant}`} disabled={!grant}
          onRun={async () => onChange((await api(`/api/admin/players/${p.id}/grant`, { method: 'POST', body: { username: grant, note } })).player)}>Grant</ActionButton>
        <ActionStatus action={grantAct} />
      </div>
      {p.claimed && <button type="button" className="btn danger sm self-start" onClick={() => setConfirm(true)}>Reclaim @{p.username}…</button>}
      {confirm && (
        <ConfirmDialog title={`Reclaim @${p.username}?`} confirmLabel="Reclaim" playersSee
          what={`The account drops to a placeholder, its display name is cleared, and it’s asked to choose again at its next page load. Its renames aren’t used up. @${p.username} is held until you release it (Reserved usernames).`}
          onClose={() => setConfirm(false)}
          onConfirm={async (reason) => onChange((await api(`/api/admin/players/${p.id}/reclaim`, { method: 'POST', body: { note: reason } })).player)} />
      )}
      <span className="eyebrow">Username history</span>
      {p.history.length === 0 ? <span className="muted xsmall">None.</span> : (
        <ul className="plain stack gap-4 small">
          {p.history.map((h) => <li key={`${h.at}-${h.to}`}><span className="mono2">{h.from} → {h.to}</span> <span className="muted">· {h.kind}{h.byAdmin ? ' by admin' : ''} · {formatDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}
        </ul>
      )}
      {p.holds.length > 0 && (
        <>
          <span className="eyebrow">Names held for this account</span>
          <ul className="plain stack gap-4 small">{p.holds.map((h) => <li key={h.name}><span className="mono2">{h.name}</span> <span className="muted">· {h.reason} · until {h.until ? formatDateTime(h.until) : 'released'}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

function RolePanel({ a, me, onAccount }) {
  const [open, setOpen] = useState(false);
  const [badge, setBadge] = useState(true);
  const act = useAction();
  if (!me.can?.['roles.grant']) return null;
  const give = a.role !== 'moderator';
  return (
    <section className="ap" aria-labelledby="role-h">
      <div className="hd"><h2 id="role-h">Moderator role</h2><span className="spacer" /><Chip kind={me.moderatorsOn ? 'ok' : 'off'}>{me.moderatorsOn ? 'Feature on' : 'Feature off'}</Chip></div>
      <div className="bd stack gap-10">
        {!me.moderatorsOn ? (
          <span className="muted small">The moderator role is switched off for everyone. It’s switched in <Link to="/admin/features#feat-moderators">Features</Link>.</span>
        ) : (
          <>
            {give && !a.strongSignIn && <span className="t2 small">This account needs 2FA or a passkey before it can be a moderator.</span>}
            <div className="row gap-8 wrap-row">
              <button type="button" className={`btn sm${give ? '' : ' danger'}`} disabled={give && !a.strongSignIn} onClick={() => setOpen(true)}>{give ? 'Give the moderator role…' : 'Remove the moderator role…'}</button>
              <ActionStatus action={act} />
            </div>
          </>
        )}
      </div>
      {open && (
        <ModDialog title={give ? `Make ${accountLabel(a)} a moderator?` : `Remove the moderator role from ${accountLabel(a)}?`} playersSee={false} message={false}
          what={give ? `They could see Inbox › Reports, warn, force a username change, reset a field, ban for up to ${me.moderatorMaxBanDays} days, lift a temporary ban and dismiss reports. Never a permanent ban, a reveal, roles, badges or the accounts list.` : 'They become an ordinary player again.'}
          confirmLabel={give ? 'Give the role' : 'Remove the role'} danger={!give} onClose={() => setOpen(false)}
          onConfirm={async ({ reason }) => {
            const r = await api(`/api/admin/moderation/accounts/${a.id}/role`, { method: 'PUT', body: { role: give ? 'moderator' : 'player', reason, badge } });
            act.set('done', give ? 'Moderator role given' : 'Moderator role removed');
            onAccount(r.account);
          }}>
          <Toggle checked={badge} onChange={setBadge}>{give ? 'Also grant the Everstats Moderator badge (cosmetic)' : 'Also revoke the Everstats Moderator badge'}</Toggle>
        </ModDialog>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- Reserved usernames
const RESERVED_KINDS = [
  { id: 'admin', label: 'Added by you', note: 'Never available' },
  { id: 'everstats', label: 'Everstats', note: 'Site and brand' },
  { id: 'path', label: 'Path', note: 'The developer' },
  { id: 'company', label: 'Companies', note: 'Brands and companies' },
  { id: 'community', label: 'Community', note: 'Community names' },
];

export function ReservedUsernamesPage() {
  const p = usePanel('reserved', () => api('/api/admin/reserved'), []);
  const addAct = useAction();
  const releaseAct = useAction();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('admin');
  const [hold, setHold] = useState('');
  const [removing, setRemoving] = useState(null);
  const groups = useMemo(() => {
    const out = new Map();
    for (const r of p.data?.reserved ?? []) {
      if (!out.has(r.kind)) out.set(r.kind, []);
      out.get(r.kind).push(r);
    }
    return out;
  }, [p.data]);
  const kinds = [...RESERVED_KINDS, ...[...groups.keys()].filter((k) => !RESERVED_KINDS.some((x) => x.id === k)).map((k) => ({ id: k, label: k, note: '' }))];
  return (
    <>
      <PageHead title="Reserved usernames" desc="Names nobody can sign up with or rename to." chips={<ScopeChip global />}
        crumbs={[{ label: 'Directory', to: '/admin/directory/accounts' }, { label: 'Accounts', to: '/admin/directory/accounts' }, { label: 'Reserved usernames' }]} />
      <section className="ap" aria-label="Reserve a name">
        <div className="bd mod-stack">
          <form className="mod-row" onSubmit={(e) => { e.preventDefault(); addAct.run(async () => { await api('/api/admin/reserved', { method: 'POST', body: { name, kind } }); setName(''); p.reload(); }, { done: `Reserved ${name}` }); }}>
            <Field label="Username" inputClassName="mono" value={name} placeholder="a-name" onChange={(e) => setName(e.target.value.toLowerCase())} maxLength={40} />
            <button type="submit" className={`btn gold${addAct.busy ? ' is-loading' : ''}`} disabled={!name || addAct.busy}><Icon name="plus" size="sm" />Reserve</button>
          </form>
          <Filter label="Kind" options={RESERVED_KINDS.map((k) => ({ id: k.id, label: k.label }))} value={kind} onChange={setKind} />
          <ActionStatus action={addAct} />
          <span className="t2 small">Compared after lookalike normalization (0→o, 1→i/l, 3→e…, separators ignored). On top of this list, any username containing admin, staff, official, moderator, support or blizzard is refused, and the profanity list. Players only ever see “That name is reserved”.</span>
        </div>
      </section>
      <Panel panel={p} title="Reserved names" id="reserved" flush sub={p.data ? <span className="muted xsmall">{formatNumber(p.data.reserved.length)} names</span> : null}>
        {() => (p.data.reserved.length === 0 ? <Empty icon="lock" title="Nothing reserved">Add a name above.</Empty> : (
          <div className="stack">
            {kinds.filter((k) => groups.has(k.id)).map((k) => (
              <div key={k.id}>
                <div className="tbar"><b>{k.label} · {groups.get(k.id).length}</b>{k.note && <span className="muted xsmall">{k.note}</span>}</div>
                <div className="dt-wrap">
                  <table className="dt">
                    <thead><tr><th>Name</th><th>Added</th><th className="r"><span className="sr-only">Remove</span></th></tr></thead>
                    <tbody>
                      {groups.get(k.id).map((r) => (
                        <tr key={r.name}>
                          <td className="dtl" data-label=""><span className="mono2">{r.name}</span></td>
                          <td data-label="Added"><span className="t2 nw">{r.addedAt ? formatDate(r.addedAt) : '—'}</span></td>
                          <td className="r" data-label=""><div className="act"><button type="button" className="btn sm ghost" onClick={() => setRemoving(r.name)}>Remove…</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
      </Panel>
      <section className="ap" aria-labelledby="holds-h">
        <div className="hd"><h2 id="holds-h">Held after a rename</h2><span className="muted xsmall">Released automatically after 30 days</span></div>
        <div className="bd mod-stack">
          <span className="t2 small">A reclaimed name stays held until you release it; a renamed one is held 30 days. Release one by name (an account’s held names are listed on its page).</span>
          <form className="mod-row" onSubmit={(e) => { e.preventDefault(); releaseAct.run(async () => { await api(`/api/admin/holds/${encodeURIComponent(hold)}`, { method: 'DELETE' }); setHold(''); }, { done: `${hold} released: anyone can claim it now (unless it’s reserved)` }); }}>
            <Field label="Held name" inputClassName="mono" value={hold} onChange={(e) => setHold(e.target.value.toLowerCase())} />
            <button type="submit" className={`btn${releaseAct.busy ? ' is-loading' : ''}`} disabled={!hold || releaseAct.busy}>Release</button>
          </form>
          <ActionStatus action={releaseAct} />
        </div>
      </section>
      <section className="ap" aria-labelledby="blocked-h">
        <div className="hd"><h2 id="blocked-h">Blocked words</h2></div>
        <div className="bd"><span className="t2 small">The blocked stems and the profanity list are checked inside every handle. They aren’t listed here.</span></div>
      </section>
      {removing && (
        <ConfirmDialog title={`Remove ${removing} from the reserved list?`} confirmLabel="Remove" playersSee={false}
          what="Anyone can claim it afterwards, unless a blocked word or a hold still refuses it."
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await api(`/api/admin/reserved/${encodeURIComponent(removing)}`, { method: 'DELETE' }); p.reload(); }} />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------- Characters
const TIER_OPTS = [{ id: '', label: 'Any' }, ...['S', 'A', 'B', 'C', 'D'].map((l) => ({ id: l, label: l })), { id: 'unranked', label: 'Unranked' }];
const VIS_OPTS = [{ id: '', label: 'Public and hidden' }, { id: 'public', label: 'Public' }, { id: 'hidden', label: 'Hidden' }];
const CLAIMED_OPTS = [{ id: '', label: 'Claimed or not' }, { id: 'claimed', label: 'Claimed' }, { id: 'unclaimed', label: 'Unclaimed' }];
const FETCHED_OPTS = [{ id: '', label: 'Any time' }, { id: 'day', label: 'Last 24 h' }, { id: 'week', label: 'Last 7 days' }, { id: 'older', label: 'Older' }, { id: 'never', label: 'Never' }];
const EMPTY_CHAR_FILTERS = { q: '', realm: '', ruleset: '', levelMin: '', levelMax: '', tier: '', visibility: '', claimed: '', fetched: '' };

export function CharactersDirectoryPage() {
  const { apiQuery, versionName, region } = useScope();
  const [f, setF] = useState(EMPTY_CHAR_FILTERS);
  const [levels, setLevels] = useState({ min: '', max: '' });
  const [realmText, setRealmText] = useState('');
  const key = `${apiQuery}|${JSON.stringify(f)}`;
  const pager = usePager(key);
  const facets = usePanel(`dir-char-facets-${apiQuery}`, () => api(`/api/admin/directory/characters?${apiQuery}&limit=1`).then((r) => r.facets), [apiQuery]);
  const p = usePanel(`dir-chars-${key}-${pager.cursor}`, () => {
    const qs = new URLSearchParams(apiQuery);
    for (const [k, v] of Object.entries(f)) if (v !== '') qs.set(k, v);
    if (pager.cursor) qs.set('cursor', pager.cursor);
    return api(`/api/admin/directory/characters?${qs}`);
  }, [key, pager.cursor]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_CHAR_FILTERS);
  const clear = () => {
    setF(EMPTY_CHAR_FILTERS);
    setLevels({ min: '', max: '' });
    setRealmText('');
  };
  const fx = facets.data;
  const word = p.data?.categoryWord ?? 'ruleset';
  return (
    <>
      <DirectoryHead active="characters" />
      <Panel panel={p} title="Characters" id="characters" flush
        sub={p.data ? <span className="cnt muted xsmall">{formatNumber(p.data.total)} character{p.data.total === 1 ? '' : 's'} · {versionName} · {region.toUpperCase()}</span> : null}>
        {(data) => (
          <>
            <div className="tbar">
              <SearchBox label="Character name, surname, slug, realm or owner" placeholder="Character, realm or @owner" value={f.q} onSubmit={set('q')} />
              <span className="spacer" />
              {filtered && <button type="button" className="btn sm ghost" onClick={clear}>Clear filters</button>}
            </div>
            <div className="mod-filters">
              {fx?.rulesets?.length > 0 && <Filter label={word[0].toUpperCase() + word.slice(1)} options={[{ id: '', label: 'Any' }, ...fx.rulesets.map((r) => ({ id: String(r.id), label: r.name }))]} value={f.ruleset} onChange={set('ruleset')} />}
              {fx?.realms?.length > 0 && (
                <form className="fgroup" onSubmit={(e) => { e.preventDefault(); set('realm')(realmText.trim().toLowerCase()); }}>
                  <label className="flab" htmlFor="realm-slug">Realm slug</label>
                  <input id="realm-slug" className="inp mid" value={realmText} placeholder={fx.realms[0]?.slug ?? ''} onChange={(e) => setRealmText(e.target.value)} />
                  <button type="submit" className="btn sm">Apply</button>
                </form>
              )}
              <form className="fgroup" onSubmit={(e) => { e.preventDefault(); setF((x) => ({ ...x, levelMin: levels.min.trim(), levelMax: levels.max.trim() })); }}>
                <span className="flab">Level</span>
                <input className="inp narrow" inputMode="numeric" aria-label="Lowest level" placeholder="from" value={levels.min} onChange={(e) => setLevels((l) => ({ ...l, min: e.target.value.replace(/\D/g, '') }))} />
                <input className="inp narrow" inputMode="numeric" aria-label="Highest level" placeholder="to" value={levels.max} onChange={(e) => setLevels((l) => ({ ...l, max: e.target.value.replace(/\D/g, '') }))} />
                <button type="submit" className="btn sm">Apply</button>
              </form>
              <Filter label="Tier" options={TIER_OPTS} value={f.tier} onChange={set('tier')} />
              <Filter label="Visibility" options={VIS_OPTS} value={f.visibility} onChange={set('visibility')} />
              <Filter label="Owner" options={CLAIMED_OPTS} value={f.claimed} onChange={set('claimed')} />
              <Filter label="Last full fetch" options={FETCHED_OPTS} value={f.fetched} onChange={set('fetched')} />
            </div>
            {data.characters.length === 0 ? (
              <Empty icon="search" title={filtered ? 'No characters match' : 'No characters tracked on this version yet'} action={filtered ? <button type="button" className="btn sm" onClick={clear}>Clear filters</button> : null}>
                {filtered ? 'Nothing matches this search and these filters.' : `Everstats hasn’t tracked a character on ${versionName} · ${region.toUpperCase()}.`}
              </Empty>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th>Character</th><th>{word[0].toUpperCase() + word.slice(1)}</th><th className="r num">Level</th><th>Tier</th><th>Visibility</th><th>Last full fetch</th><th>Owner</th><th className="r"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {data.characters.map((c) => (
                      <tr key={c.id} className={c.state === 'missing' ? 'is-fail' : ''}>
                        <td className="dtl" data-label="">
                          {c.publicPath ? <Link className="tgt" to={c.publicPath}>{c.name ?? '—'} {c.surname}</Link> : <b>{c.name ?? '—'} {c.surname}</b>}
                          <span className="sub">{c.realm ? (c.realm.name ?? c.realm.slug) : c.slug}{c.class ? ` · ${c.class}` : ''}{c.faction ? ` · ${c.faction}` : ''}</span>
                        </td>
                        <td className="t2" data-label={word}>{c.ruleset?.name ?? '—'}</td>
                        <td className="r num" data-label="Level">{c.level ?? '—'}</td>
                        <td data-label="Tier"><TierBadge letter={c.tier?.letter ?? null} size="sm" /></td>
                        <td data-label="Visibility">
                          {c.hidden ? <Chip kind="off" icon="eye-off">Hidden</Chip> : <Chip kind="ok" icon="eye">Public</Chip>}
                          {c.state === 'missing' && <Chip kind="err">Not returned since {formatDate(c.missingSince)}</Chip>}
                          {c.state === 'not_found' && <Chip kind="warn">Profile 404s</Chip>}
                        </td>
                        <td data-label="Last full fetch"><Fresh at={c.lastFetchedAt} never="Never fetched" /></td>
                        <td data-label="Owner">
                          {!c.owner ? <span className="muted">Unclaimed</span> : c.owner.username ? <Link className="tgt" to={`/admin/directory/accounts/${c.owner.id}`}>@{c.owner.username}</Link> : <Link to={`/admin/directory/accounts/${c.owner.id}`}>Claimed</Link>}
                        </td>
                        <td className="r" data-label=""><div className="act">{c.publicPath ? <Link className="btn ghost sm" to={c.publicPath}>Open</Link> : <span className="muted xsmall">{c.hidden ? 'Hidden: no public page' : 'No public page yet'}</span>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager pager={pager} shown={data.characters.length} total={data.total} next={data.next} noun="characters" />
          </>
        )}
      </Panel>
      <div className="note small"><Icon name="shield-check" /><span>Read only: there are no admin character actions yet (a character refreshes from its public page). A character’s position, bind position and Blizzard account (<span className="mono2">position</span>, <span className="mono2">bind_position</span>, <span className="mono2">wow_account</span>) are never stored or shown. Characters whose Blizzard data aged out (stubs) aren’t listed.</span></div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------- Guilds
const FACTION_OPTS = [{ id: '', label: 'Any' }, { id: 'ALLIANCE', label: 'Alliance' }, { id: 'HORDE', label: 'Horde' }];
const RANKED_OPTS = [{ id: '', label: 'Ranked or not' }, { id: 'ranked', label: 'Ranked' }, { id: 'not', label: 'Not ranked' }];
const GM_OPTS = [{ id: '', label: 'GM claimed or not' }, { id: 'claimed', label: 'Claimed' }, { id: 'unclaimed', label: 'Unclaimed' }];
const REPORTED_OPTS = [{ id: '', label: 'Any' }, { id: 'yes', label: 'Open reports' }];
const EMPTY_GUILD_FILTERS = { q: '', faction: '', ranked: '', gm: '', reported: '' };
const factionWord = (f) => (f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : '—');

function GuildViewSwitch({ on }) {
  return (
    <div className="seg" role="group" aria-label="View">
      <Link to="/admin/directory/guilds" role="button" aria-pressed={on === 'all'} className="seg-link">All guilds</Link>
      <Link to="/admin/directory/guilds/links" role="button" aria-pressed={on === 'links'} className="seg-link">Guild links</Link>
    </div>
  );
}

export function GuildsDirectoryPage() {
  const { apiQuery, versionName, region } = useScope();
  const [f, setF] = useState(EMPTY_GUILD_FILTERS);
  const key = `${apiQuery}|${JSON.stringify(f)}`;
  const pager = usePager(key);
  const p = usePanel(`dir-guilds-${key}-${pager.cursor}`, () => {
    const qs = new URLSearchParams(apiQuery);
    for (const [k, v] of Object.entries(f)) if (v !== '') qs.set(k, v);
    if (pager.cursor) qs.set('cursor', pager.cursor);
    return api(`/api/admin/directory/guilds?${qs}`);
  }, [key, pager.cursor]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_GUILD_FILTERS);
  return (
    <>
      <DirectoryHead active="guilds" />
      <Panel panel={p} title="Guilds" id="guilds" flush
        sub={p.data ? <span className="cnt muted xsmall">{formatNumber(p.data.total)} guild{p.data.total === 1 ? '' : 's'} · {versionName} · {region.toUpperCase()}</span> : null}>
        {(data) => (
          <>
            <div className="tbar">
              <GuildViewSwitch on="all" />
              <SearchBox label="Guild name or slug" placeholder="Guild name" value={f.q} onSubmit={set('q')} />
              <span className="spacer" />
              {filtered && <button type="button" className="btn sm ghost" onClick={() => setF(EMPTY_GUILD_FILTERS)}>Clear filters</button>}
            </div>
            <div className="mod-filters">
              <Filter label="Faction" options={FACTION_OPTS} value={f.faction} onChange={set('faction')} />
              <Filter label="Ranked" options={RANKED_OPTS} value={f.ranked} onChange={set('ranked')} />
              <Filter label="Guild Master" options={GM_OPTS} value={f.gm} onChange={set('gm')} />
              <Filter label="Reports" options={REPORTED_OPTS} value={f.reported} onChange={set('reported')} />
            </div>
            {data.guilds.length === 0 ? (
              <Empty icon="search" title={filtered ? 'No guilds match' : 'No guilds on this version yet'} action={filtered ? <button type="button" className="btn sm" onClick={() => setF(EMPTY_GUILD_FILTERS)}>Clear filters</button> : null}>
                {filtered ? 'Nothing matches this search and these filters.' : `Everstats hasn’t seen a guild on ${versionName} · ${region.toUpperCase()}.`}
              </Empty>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th>Guild</th><th>Faction</th><th>Tracked / roster</th><th>Ranked</th><th>Guild Master</th><th className="r num">Links</th><th>Reports</th><th className="r"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {data.guilds.map((g) => (
                      <tr key={g.id}>
                        <td className="dtl" data-label="">
                          <Link className="tgt" to={`/admin/directory/guilds/${g.id}/links`}>{g.name}</Link>
                          <span className="sub">{[g.realm, g.ruleset?.name].filter(Boolean).join(' · ') || g.slug}</span>
                        </td>
                        <td className="t2" data-label="Faction">{factionWord(g.faction)}</td>
                        <td data-label="Tracked / roster"><RosterRatio tracked={g.tracked} roster={g.roster} /></td>
                        <td data-label="Ranked">{g.ranked ? <Chip kind="ok">Ranked</Chip> : <Chip kind="off">Not ranked · needs {g.minMembers}</Chip>}</td>
                        <td data-label="Guild Master">{g.gm ? (g.gm.username ? <Link className="tgt" to={`/admin/directory/accounts/${g.gm.id}`}>@{g.gm.username}</Link> : <Link to={`/admin/directory/accounts/${g.gm.id}`}>GM claimed</Link>) : <Chip kind="off">Unclaimed</Chip>}</td>
                        <td className="r num" data-label="Links">{g.links}</td>
                        <td data-label="Reports">{g.openReports > 0 ? <Chip kind="warn">{g.openReports} open</Chip> : <span className="muted">0</span>}</td>
                        <td className="r" data-label=""><div className="act"><Link className="btn ghost sm" to={`/admin/directory/guilds/${g.id}/links`}>Open</Link>{g.publicPath && <Link className="btn ghost sm" to={g.publicPath}>Guild page</Link>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager pager={pager} shown={data.guilds.length} total={data.total} next={data.next} noun="guilds" />
          </>
        )}
      </Panel>
    </>
  );
}

function RosterRatio({ tracked, roster }) {
  if (roster === null || roster === undefined) return <span className="num small">{formatNumber(tracked)} <span className="muted xsmall">· roster not read</span></span>;
  const pct = roster > 0 ? Math.min(100, Math.round((tracked / roster) * 100)) : 0;
  return (
    <div className="ratio">
      <span className="num small">{formatNumber(tracked)} / {formatNumber(roster)}</span>
      <div className="bar sm"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- Guild links
export function GuildLinksPage() {
  const { id } = useParams();
  return id ? <OneGuildLinks id={id} /> : <AllGuildLinks />;
}

function RemoveLinkDialog({ link, onClose, onDone }) {
  return (
    <ConfirmDialog title={`Remove “${link.label}”?`} confirmLabel="Remove link" playersSee
      what={`It leaves the guild page at once, its open reports are closed, and it’s logged on the guild with your reason. ${link.url}`}
      onClose={onClose}
      onConfirm={async (reason) => {
        await api(`/api/admin/guild-links/${link.id}/remove`, { method: 'POST', body: { reason } });
        onDone();
      }} />
  );
}

function OneGuildLinks({ id }) {
  const p = usePanel(`guild-links-${id}`, () => api(`/api/admin/directory/guilds/${id}`), [id]);
  const text = usePanel(`guild-text-${id}`, () => api(`/api/admin/moderation/guilds/${id}`), [id]);
  const [removing, setRemoving] = useState(null);
  const [resetting, setResetting] = useState(null);
  const act = useAction();
  const g = p.data?.guild;
  const name = g?.name ?? `Guild #${id}`;
  const dismiss = (reportId) => act.run(async () => {
    await api(`/api/admin/guild-links/reports/${reportId}/dismiss`, { method: 'POST', body: {} });
    p.reload();
  }, { done: 'Report dismissed' });
  return (
    <>
      <PageHead title={name} chips={<ScopeChip global />}
        crumbs={[{ label: 'Directory', to: '/admin/directory/accounts' }, { label: 'Guilds', to: '/admin/directory/guilds' }, { label: name }, { label: 'Links' }]} />
      <Panel panel={p} title="Guild" id="guild">
        {(d) => (d.guild.aged ? <span className="muted small">Blizzard’s data about this guild has aged out; its links are kept (they’re ours).</span> : (
          <div className="idhead">
            <span className="av" aria-hidden="true"><Icon name="guild" /></span>
            <div className="stack gap-4">
              <span className="nm">{d.guild.name}</span>
              <div className="row gap-6 wrap-row">
                <Chip kind="scope" icon="globe">{[d.guild.realm, factionWord(d.guild.faction), d.guild.ruleset?.name, d.guild.version].filter((x) => x && x !== '—').join(' · ')}</Chip>
                {d.guild.ranked ? <Chip kind="ok">Ranked</Chip> : <Chip kind="off">Not ranked · needs {d.guild.minMembers}</Chip>}
                {d.guild.gm ? <Chip kind="ok">GM claimed</Chip> : <Chip kind="off">GM unclaimed</Chip>}
              </div>
            </div>
            <span className="spacer" />
            <dl className="kvs">
              <dt>Tracked / roster</dt><dd className="num">{formatNumber(d.guild.tracked)} / {d.guild.roster === null ? '—' : formatNumber(d.guild.roster)}</dd>
              <dt>GM</dt><dd>{d.guild.gm ? <Link className="tgt" to={`/admin/directory/accounts/${d.guild.gm.id}`}>{d.guild.gm.username ? `@${d.guild.gm.username}` : `Account #${d.guild.gm.id}`}</Link> : <span className="muted">Nobody on Everstats</span>}</dd>
              {d.guild.publicPath && <><dt>Page</dt><dd><Link to={d.guild.publicPath}>{d.guild.publicPath}</Link></dd></>}
            </dl>
          </div>
        ))}
      </Panel>
      <Panel panel={p} title={p.data ? `Links · ${p.data.links.filter((l) => !l.removedAt).length}` : 'Links'} id="links" flush
        actions={<ActionStatus action={act} />}
        footer="Links are added by the Guild Master or officers. Removing one asks for a reason and is logged on the guild.">
        {(d) => (d.links.length === 0 ? <Empty icon="link" title="No links">This guild page has never had a link.</Empty> : (
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Label</th><th>Address (shown as text)</th><th>Added by</th><th>Added</th><th>Reports</th><th>Status</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.links.map((l) => (
                  <tr key={l.id} className={l.openReports > 0 && !l.removedAt ? 'is-fail' : ''}>
                    <td className="dtl" data-label=""><b>{l.label}</b></td>
                    <td data-label="Address (shown as text)"><span className="mono2">{l.url}</span></td>
                    <td data-label="Added by">{l.addedBy ? <Link className="tgt" to={`/admin/directory/accounts/${l.addedBy.id}`}>{l.addedBy.username ? `@${l.addedBy.username}` : `Account #${l.addedBy.id}`}</Link> : <span className="muted">—</span>}</td>
                    <td data-label="Added"><span className="nw t2">{formatDate(l.createdAt)}</span></td>
                    <td data-label="Reports">
                      {l.openReports > 0 ? <Chip kind="warn" icon="flags">{l.openReports} open</Chip> : <span className="muted">{l.closedReports ? `${l.closedReports} closed` : '0'}</span>}
                      {l.reports.map((r) => <span key={r.id} className="sub">“{r.note ?? 'No note'}” · {timeAgo(r.at)} <button type="button" className="btn sm ghost" onClick={() => dismiss(r.id)}>Dismiss</button></span>)}
                    </td>
                    <td data-label="Status">{l.removedAt ? <Chip kind="off">Removed · by {l.removedBy === 'admin' ? 'Admin' : 'the guild'}</Chip> : l.openReports > 0 ? <Chip kind="warn">Reported</Chip> : <Chip kind="ok">Live</Chip>}{l.removedReason && <span className="sub">“{l.removedReason}”</span>}</td>
                    <td className="r" data-label=""><div className="act">{!l.removedAt && <button type="button" className={`btn sm ${l.openReports > 0 ? 'danger' : 'ghost'}`} onClick={() => setRemoving(l)}>Remove…</button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>
      <Panel panel={text} title="Guild page text" id="text">
        {(d) => <GuildText data={d} onReset={setResetting} />}
      </Panel>
      {removing && <RemoveLinkDialog link={removing} onClose={() => setRemoving(null)} onDone={() => { act.set('done', `Removed “${removing.label}”`); p.reload(); text.reload(); }} />}
      {resetting && <GuildResetDialog guildId={id} part={resetting} onClose={() => setResetting(null)} onDone={() => { text.reload(); p.reload(); }} />}
    </>
  );
}

/** A guild page's own text (description, links, invite), the parts a moderation reset can clear, and its history. */
export function GuildText({ data, onReset }) {
  const g = data.guild;
  const parts = [
    g.description && { id: 'description', label: 'Description', value: g.description },
    g.links?.length > 0 && { id: 'links', label: 'Links', value: g.links.map((l) => `${l.label} — ${l.host}`).join(' · ') },
    g.discord && { id: 'discord', label: 'Discord invite', value: g.discord },
  ].filter(Boolean);
  return (
    <div className="stack gap-12">
      {parts.length === 0 ? <span className="muted small">This guild page has no description, links or invite now.</span> : (
        <dl className="kvs">
          {parts.map((x) => (
            <div key={x.id} className="contents">
              <dt>{x.label}</dt>
              <dd className="row gap-8 wrap-row"><span className="mod-body">{x.value}</span>{data.can?.['fields.reset'] && <button type="button" className="btn sm ghost" onClick={() => onReset(x)}>Reset…</button>}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.history.length > 0 && (
        <ul className="hist">
          {data.history.map((h) => <li key={h.id}><span className="dot warn" aria-hidden="true" /><b>{h.changed}</b><span className="w">{formatDateTime(h.at)} · {h.by}</span>{h.reason && <span className="why">Reason: “{h.reason}”</span>}</li>)}
        </ul>
      )}
    </div>
  );
}

export function GuildResetDialog({ guildId, part, onClose, onDone }) {
  return (
    <ConfirmDialog title={`Reset this guild page’s ${part.label.toLowerCase()}?`} confirmLabel={`Reset ${part.label.toLowerCase()}`} playersSee
      what={`“${part.value}” goes back to empty${part.id === 'links' ? ' (the links are marked removed, not deleted)' : ''}. Open reports about the guild page are marked actioned, and it’s logged on the guild with your reason.`}
      onClose={onClose}
      onConfirm={async (reason) => {
        await api(`/api/admin/moderation/guilds/${guildId}/reset`, { method: 'POST', body: { part: part.id, reason } });
        onDone();
      }} />
  );
}

function AllGuildLinks() {
  const p = usePanel('guild-links-all', () => api('/api/admin/guild-links'), []);
  const [removing, setRemoving] = useState(null);
  const [host, setHost] = useState('');
  const [hostNote, setHostNote] = useState('');
  const [unblocking, setUnblocking] = useState(null);
  const act = useAction();
  const blockAct = useAction();
  const guildCell = (l) => (l.guildId ? <Link className="tgt" to={`/admin/directory/guilds/${l.guildId}/links`}>{l.guild?.name ?? `Guild #${l.guildId}`}</Link> : <span className="muted">A guild Everstats no longer has</span>);
  const dismiss = (rid) => act.run(async () => {
    await api(`/api/admin/guild-links/reports/${rid}/dismiss`, { method: 'POST', body: {} });
    p.reload();
  }, { done: 'Report dismissed' });
  return (
    <>
      <PageHead title="Guild links" chips={<ScopeChip global />} desc="Links Guild Masters and officers put on guild pages: the reports, removing any link, and the domains refused in new links."
        crumbs={[{ label: 'Directory', to: '/admin/directory/accounts' }, { label: 'Guilds', to: '/admin/directory/guilds' }, { label: 'Guild links' }]} />
      <div className="dash-ctrl"><GuildViewSwitch on="links" /><span className="spacer" /><ActionStatus action={act} /></div>
      <Panel panel={p} title={p.data ? `Reported · ${p.data.reports.length} open` : 'Reported'} id="reported" flush>
        {(d) => (d.reports.length === 0 ? <Empty icon="check-circle" title="Nothing reported">Link reports land here and in Inbox › Reports.</Empty> : (
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Link</th><th>Guild</th><th>Note</th><th>Reported</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.reports.map((r) => (
                  <tr key={r.id} className="is-fail">
                    <td className="dtl" data-label=""><b>{r.link.label}</b><span className="sub mono2">{r.link.url}</span></td>
                    <td data-label="Guild">{guildCell(r)}</td>
                    <td className="t2" data-label="Note">{r.note ?? '—'}</td>
                    <td data-label="Reported"><span className="t2 nw">{formatDateTime(r.at)}</span></td>
                    <td className="r" data-label=""><div className="act">
                      {!r.link.removed ? <button type="button" className="btn sm danger" onClick={() => setRemoving(r.link)}>Remove…</button> : <Chip kind="off">Removed</Chip>}
                      <button type="button" className="btn sm ghost" onClick={() => dismiss(r.id)}>Dismiss</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>
      <Panel panel={p} title="Newest links" id="recent" flush>
        {(d) => (d.recent.length === 0 ? <Empty icon="link" title="No guild links yet" /> : (
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Link</th><th>Guild</th><th>Added</th><th>Status</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.recent.map((l) => (
                  <tr key={l.id}>
                    <td className="dtl" data-label=""><b>{l.label}</b><span className="sub mono2">{l.url}</span></td>
                    <td data-label="Guild">{guildCell(l)}</td>
                    <td data-label="Added"><span className="t2 nw">{formatDateTime(l.createdAt)}</span></td>
                    <td data-label="Status">{l.removedAt ? <Chip kind="off">Removed · by {l.removedBy === 'admin' ? 'Admin' : 'the guild'}</Chip> : <Chip kind="ok">Live</Chip>}</td>
                    <td className="r" data-label=""><div className="act">{!l.removedAt && <button type="button" className="btn sm ghost" onClick={() => setRemoving(l)}>Remove…</button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>
      <Panel panel={p} title="Blocklist" id="blocklist">
        {(d) => (
          <div className="mod-stack">
            <span className="t2 small">Domains refused in new guild links (each covers its subdomains). URL shorteners are always refused by a built-in list. Existing links stay until removed.</span>
            <form className="mod-row" onSubmit={(e) => {
              e.preventDefault();
              blockAct.run(async () => {
                await api('/api/admin/guild-links/blocklist', { method: 'POST', body: { host, note: hostNote } });
                setHost('');
                setHostNote('');
                p.reload();
              }, { done: `Blocked ${host}` });
            }}>
              <Field label="Domain" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" maxLength={253} />
              <Field label="Note (optional)" value={hostNote} onChange={(e) => setHostNote(e.target.value)} maxLength={200} />
              <button type="submit" className={`btn${blockAct.busy ? ' is-loading' : ''}`} disabled={!host.trim() || blockAct.busy}>Block</button>
            </form>
            <ActionStatus action={blockAct} />
            {d.blocklist.length === 0 ? <span className="muted small">Nothing blocked.</span> : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th>Domain</th><th>Note</th><th>Added</th><th className="r"><span className="sr-only">Unblock</span></th></tr></thead>
                  <tbody>
                    {d.blocklist.map((b) => (
                      <tr key={b.host}>
                        <td className="dtl" data-label=""><span className="mono2">{b.host}</span></td>
                        <td className="t2" data-label="Note">{b.note ?? '—'}</td>
                        <td data-label="Added"><span className="t2 nw">{formatDate(b.addedAt)}</span></td>
                        <td className="r" data-label=""><div className="act"><button type="button" className="btn sm ghost" onClick={() => setUnblocking(b.host)}>Unblock…</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>
      {removing && <RemoveLinkDialog link={removing} onClose={() => setRemoving(null)} onDone={() => { act.set('done', `Removed “${removing.label}”`); p.reload(); }} />}
      {unblocking && (
        <ConfirmDialog title={`Unblock ${unblocking}?`} confirmLabel="Unblock" playersSee={false} reasonRequired={false}
          what="Guild editors can add links to it again. The change is logged."
          onClose={() => setUnblocking(null)}
          onConfirm={async () => { await api(`/api/admin/guild-links/blocklist/${encodeURIComponent(unblocking)}`, { method: 'DELETE' }); p.reload(); }} />
      )}
    </>
  );
}

// Re-exported for the Inbox and Badges pages.
export { usePager, Pager, SearchBox, Filter };
export const useAccountQuery = () => {
  const [params] = useSearchParams();
  return params.get('account');
};
