import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { BadgeIcon } from '../../badges/Badges.jsx';
import { Icon } from '../../chrome/Icon.jsx';
import { Field, Segmented } from '../../components/Controls.jsx';
import { formatDate, formatDateTime, formatNumber } from '../../format.js';
import { GuildBadgeIcon, GuildPill, guildBadgeName } from '../../guildBadges/GuildBadges.jsx';
import { ActionButton, ActionStatus, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, useAction } from '../shell/parts.jsx';
import { Panel, usePanel } from '../shell/refresh.jsx';
import './moderation.css';
import './badges.css';

/**
 * Badges (0.10.3, design/v5-admin pages badges, badges-guild). Everything the 0.7.0 BadgesAdminPage and the 0.7.1
 * GuildBadgesAdminPage did, in two tabs:
 *
 *   /admin/badges/player   grant / revoke (reason required, logged), the beta-membership grant, Verified Content Creator
 *                          (its handle-change alert, the code, the checked handles), the badge table with holders,
 *                          badge logos (0.10.4: Pro Team, Platform Employee, Community Partner), badges from templates, the Early Supporter window, the back-fill, the log
 *   /admin/badges/guild    milestone thresholds I–V with a preview and guilds per level, staff grants / revokes,
 *                          the Early Guild window, partner emblems, a new Deeds badge, the back-fill, the log
 *
 * Every manual badge the server lists is grantable here (Dev Tester included: a new award of it starts hidden on the
 * profile until its holder shows it). Badges are cosmetic; the admin holds none.
 *
 * Different from the design, on purpose: no native <select> (pill radio groups instead); badge logos and guild emblems are
 * PNG or WebP only (SVG can carry scripts); "Holders" opens the public badge page, which lists them.
 */
const THEMES = [['forever', 'Forever'], ['alliance', 'Alliance'], ['horde', 'Horde']];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

function BadgeTabs({ player = null, guild = null }) {
  return (
    <PageHead title="Badges" chips={<ScopeChip global />}
      desc="Player and guild badges. Automatic badges follow their rules; manual ones are granted here. Every grant and revoke needs a reason and is logged."
      tabs={[
        { to: '/admin/badges/player', label: 'Player badges', count: player },
        { to: '/admin/badges/guild', label: 'Guild badges', count: guild },
      ]} />
  );
}

const scrollTo = (id) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);

// ------------------------------------------------------------------------------------------------- Player badges
export function PlayerBadgesTab() {
  const p = usePanel('badges-player', () => api('/api/admin/badges'), []);
  const [params] = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('account'));
  const [badgeId, setBadgeId] = useState(null);
  const s = p.data;
  return (
    <>
      <BadgeTabs player={s ? formatNumber(s.definitions.length) : null} />
      {s && (s.creator?.alerts ?? []).length > 0 && (
        <Panel panel={p} title="Creator handle changes" id="creators">
          {(d) => <CreatorAlerts alerts={d.creator.alerts} onOpen={(id) => { setAccountId(String(id)); scrollTo('grant'); }} />}
        </Panel>
      )}
      <Panel panel={p} title="Grant or revoke" id="grant">
        {(d) => <AccountGrant state={d} accountId={accountId} setAccountId={setAccountId} badgeId={badgeId} setBadgeId={setBadgeId} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title={s ? `Player badges · ${s.definitions.length}` : 'Player badges'} id="list" flush>
        {(d) => <BadgeTable state={d} onGrant={(id) => { setBadgeId(id); scrollTo('grant'); }} />}
      </Panel>
      <Panel panel={p} title="Badge logos" id="logo">
        {(d) => <LogoPanel state={d} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title="Create a badge from a template" id="template">
        {(d) => <TemplatePanel state={d} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title="Early Supporter window" id="set-badges.earlySupporter">
        {(d) => <WindowPanel early={d.earlySupporter} settingKey="badges.earlySupporter" onChanged={p.reload}
          help="Accounts created between these dates (UTC, both days included) get Early Supporter. Unset, the badge isn’t awardable and shows nowhere. After the end date it shows as “No longer available”." />}
      </Panel>
      <Panel panel={p} title="Log" id="log" flush sub={<span className="muted xsmall">append-only</span>}>
        {(d) => <PlayerLog state={d} />}
      </Panel>
    </>
  );
}

function CreatorAlerts({ alerts, onOpen }) {
  return (
    <div className="stack gap-8">
      <span className="t2 small">A verified creator changed or removed a verified handle: its Verified mark came off at once. The badge stays until you decide.</span>
      <div className="rlist flush-rlist">
        {alerts.map((a) => (
          <div key={a.accountId}>
            <Icon name="warning" size="sm" />
            <span><b>{a.username ? `@${a.username}` : `#${a.accountId}`}</b> · {a.changes.map((x) => `${x.platform}: ${x.from} → ${x.to ?? 'removed'}`).join(' · ')} <span className="muted xsmall">· {formatDateTime(a.at)}</span></span>
            <button type="button" className="btn sm" onClick={() => onOpen(a.accountId)}>Open</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountGrant({ state, accountId, setAccountId, badgeId, setBadgeId, onChanged }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [account, setAccount] = useState(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [revoking, setRevoking] = useState(null);
  const grantAct = useAction();
  const findAct = useAction();
  const manual = state.definitions.filter((d) => d.award === 'manual' && d.id !== state.creator?.badgeId);
  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      return;
    }
    api(`/api/admin/badges/accounts/${accountId}`).then((r) => setAccount(r.account), () => setAccount(null));
  }, [accountId]);
  const changed = (a) => {
    setAccount(a);
    onChanged();
  };
  const search = (e) => {
    e.preventDefault();
    findAct.run(async () => {
      const r = await api(`/api/admin/players?q=${encodeURIComponent(q.trim())}`);
      setFound(r.players);
      if (r.players.length === 1) setAccountId(String(r.players[0].id));
      return r.players.length;
    }, { done: (n) => `${n} found`, working: 'Searching…' });
  };
  const def = manual.find((d) => d.id === badgeId);
  return (
    <div className="mod-stack">
      <form className="mod-row" onSubmit={search}>
        <Field label="Account (@username, former username or account id)" value={q} onChange={(e) => setQ(e.target.value)} placeholder="@username" />
        <button type="submit" className="btn" disabled={!q.trim()}><Icon name="search" size="sm" />Find</button>
        <ActionStatus action={findAct} />
      </form>
      {found && found.length > 1 && !account && (
        <div className="mod-pills">{found.map((pl) => <button key={pl.id} type="button" className="btn sm ghost" onClick={() => setAccountId(String(pl.id))}>{pl.claimed ? `@${pl.username}` : `#${pl.id} (no username)`}</button>)}</div>
      )}
      {found && found.length === 0 && <span className="muted small">Nobody matches.</span>}
      {!account ? <span className="muted small">Find an account to see its badges and grant one.</span> : (
        <div className="mod-stack">
          <div className="row gap-10 wrap-row">
            <b>{account.displayName ?? (account.claimed ? account.username : `Account #${account.id}`)}</b>
            <span className="muted small">{account.claimed ? `@${account.username}` : 'No username yet'} · #{account.id} · joined {formatDate(account.createdAt)} · {account.providers.join(' + ') || 'passkeys only'}</span>
            <span className="spacer" />
            <Link className="btn ghost sm" to={`/admin/directory/accounts/${account.id}`}>Open account</Link>
            <button type="button" className="btn ghost sm" onClick={() => { setAccountId(null); setFound(null); }}>Clear</button>
          </div>
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Badge</th><th>Family</th><th>Source</th><th>Since</th><th className="r"><span className="sr-only">Revoke</span></th></tr></thead>
              <tbody>
                {account.badges.length === 0 && <tr><td className="dtl" data-label="" colSpan={5}><span className="muted">No badges.</span></td></tr>}
                {account.badges.map((b) => (
                  <tr key={b.id}>
                    <td className="dtl" data-label=""><span className="who2"><BadgeIcon badge={b} size="inline" /><b>{b.name}</b></span>{b.state === 'revoked' && <span className="sub">{b.revokedBy === 'rule' ? 'Removed by its rule' : 'Revoked'}</span>}</td>
                    <td className="t2" data-label="Family">{b.familyLabel}</td>
                    <td className="t2" data-label="Source">{b.source === 'admin' ? `Granted by admin${b.reason ? `: ${b.reason}` : ''}` : 'Automatic'}{b.state === 'revoked' && b.revokedReason ? ` · ${b.revokedReason}` : ''}</td>
                    <td data-label="Since"><span className="t2 nw">{formatDate(b.state === 'revoked' ? b.revokedAt : b.earnedAt)}</span></td>
                    <td className="r" data-label=""><div className="act">{b.award === 'manual' && b.state === 'held' ? <button type="button" className="btn sm danger" onClick={() => setRevoking(b)}>Revoke…</button> : <span className="muted xsmall">{b.award === 'automatic' ? 'automatic' : ''}</span>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BetaGrant account={account} onDone={changed} />
          {state.creator && <CreatorGrant key={account.id} account={account} info={state.creator} definition={state.definitions.find((d) => d.id === state.creator.badgeId) ?? null} onDone={changed} />}
          <div className="mod-stack" id="grant-form">
            <h3 className="h3">Grant a badge</h3>
            <span className="small t2" id="grant-list-h">Badge (manual badges only)</span>
            <div className="radio-list" role="radiogroup" aria-labelledby="grant-list-h">
              {manual.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={badgeId === d.id} className="bdg-pill" disabled={!d.grantable} onClick={() => setBadgeId(d.id)}
                  title={d.grantable ? undefined : 'Upload and save its logo first'}>
                  <BadgeIcon badge={d} labelled={false} />
                  <span className="bdg-pill-name">{d.name}{d.grantable ? '' : ' (needs a logo)'}</span>
                </button>
              ))}
            </div>
            {badgeId === state.creator?.badgeId && <span className="muted xsmall">Verified Content Creator is granted from its own form above.</span>}
            <div className="field">
              <label htmlFor="grant-reason">Reason <span className="muted">(required, saved to the log)</span></label>
              <textarea id="grant-reason" className="inp" rows={3} maxLength={500} value={reason} placeholder="Why is this account getting this badge?" onChange={(e) => setReason(e.target.value)} />
            </div>
            <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player with a “Badge granted” toast</label>
            <div className="row gap-10 wrap-row">
              <ActionButton action={grantAct} className="btn gold" disabled={!def || reason.trim().length < 3}
                done={() => `${def?.name ?? 'Badge'} granted${notify ? ': the player gets a toast on their next page' : ''}`}
                onRun={async () => {
                  changed((await api(`/api/admin/badges/accounts/${account.id}/grant`, { method: 'POST', body: { badgeId, reason, notify } })).account);
                  setReason('');
                }}>Grant {def?.name ?? 'badge'}</ActionButton>
              <ActionStatus action={grantAct} idle="Revoking asks for a reason in a confirmation." />
            </div>
          </div>
        </div>
      )}
      {revoking && (
        <ConfirmDialog title={`Revoke ${revoking.name} from ${account.claimed ? `@${account.username}` : `account #${account.id}`}?`} confirmLabel={`Revoke ${revoking.name}`} playersSee
          what={`It leaves their profile at once${revoking.id === state.creator?.badgeId ? ', and so does every Verified mark on their handles' : ''}. The award is kept as revoked, with your reason, in the log.`}
          onClose={() => setRevoking(null)}
          onConfirm={async (reason2) => changed((await api(`/api/admin/badges/accounts/${account.id}/revoke`, { method: 'POST', body: { badgeId: revoking.id, reason: reason2 } })).account)} />
      )}
    </div>
  );
}

/**
 * 0.7.1 (owner's decision): grant beta membership to an account made BEFORE the beta window opened. Reason required,
 * logged; Beta Tester then follows from the rule. Only for accounts made before the window closed; it never changes the
 * window. Membership is permanent once granted.
 */
function BetaGrant({ account, onDone }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  const b = account.beta;
  return (
    <div className="note small">
      <Icon name="info" />
      <span className="row gap-10 wrap-row">
        <span><b>Beta:</b> {b.member ? <>beta member since {formatDate(b.since)}</> : 'not a beta member'}.</span>
        {!b.member && (b.grantable
          ? <button type="button" className="btn sm" onClick={() => setOpen(true)}>Grant beta membership…</button>
          : <span className="muted xsmall">Made after the beta window closed: can’t be granted.</span>)}
        <ActionStatus action={act} />
      </span>
      {open && (
        <ConfirmDialog title="Grant beta membership?" confirmLabel="Grant membership" danger={false} playersSee
          what={`${account.claimed ? `@${account.username}` : `Account #${account.id}`} becomes a beta member for good (it can’t be undone), and gets the Beta Tester badge like any member. The beta window doesn’t change.`}
          ack="I understand this can’t be undone."
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            onDone((await api(`/api/admin/badges/accounts/${account.id}/beta`, { method: 'POST', body: { reason } })).account);
            act.set('done', 'Beta membership granted: Beta Tester follows from the rule');
          }} />
      )}
    </div>
  );
}

/**
 * Verified Content Creator (0.8.1, server/badges/creators.js): Everstats makes a short code; the creator puts it on their
 * channel; the admin looks at the channel by hand (Everstats never fetches it) and ticks the handles checked.
 */
function CreatorGrant({ account, info, definition, onDone }) {
  const c = account.creator;
  const eligible = account.socials.filter((s) => s.creatorPlatform);
  const [ticked, setTicked] = useState(() => new Set(eligible.filter((s) => s.verified).map((s) => s.platform)));
  const [codeChecked, setCodeChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const act = useAction();
  const holds = account.badges.some((b) => b.id === info.badgeId && b.state === 'held');
  const call = (path, body, done) => act.run(async () => onDone((await api(`/api/admin/badges/accounts/${account.id}/creator/${path}`, { method: 'POST', body })).account), { done });
  const names = info.platforms.map((p) => p.label);
  return (
    <div className="mod-stack" id="creator-grant">
      <div className="row gap-10 wrap-row">
        <h3 className="h3 row gap-8">{definition && <BadgeIcon badge={definition} size="inline" labelled={false} />}Verified Content Creator</h3>
        {definition?.artTemporary && <Chip kind="info">Temporary art</Chip>}
      </div>
      <ol className="small t2 creator-steps">
        <li>Start a verification: Everstats makes a short code for this account.</li>
        <li>The creator sees the code in Settings → Profile and puts it in the bio or a panel of their {names.slice(0, -1).join(', ')} or {names.at(-1)} channel.</li>
        <li>Open their channel yourself and look for the code. Everstats never fetches or scrapes it.</li>
        <li>Tick the handles you checked, give a reason, grant. Every step is logged.</li>
      </ol>
      {!c || c.state === 'revoked' ? (
        <div className="row gap-10 wrap-row">
          <button type="button" className="btn" disabled={act.busy} onClick={() => call('start', {}, 'Verification started: the creator now sees the code in Settings → Profile')}>Start a verification</button>
          {c?.state === 'revoked' && <span className="muted xsmall">Revoked {formatDate(c.revokedAt)}. Starting again makes a new code.</span>}
          <ActionStatus action={act} />
        </div>
      ) : (
        <>
          <div className="row gap-10 wrap-row">
            <span className="small">Code for this account</span>
            <code className="mod-code">{c.code}</code>
            <Chip kind={c.state === 'pending' ? 'warn' : 'ok'}>{c.state === 'pending' ? `Pending since ${formatDate(c.startedAt)}` : `Verified ${formatDate(c.verifiedAt)}`}</Chip>
          </div>
          {c.alert && (
            <div className="note warn small" role="status">
              <Icon name="warning" />
              <span className="flex-fill">Changed since it was verified: {c.alert.changes.map((x) => `${x.platform} ${x.from} → ${x.to ?? 'removed'}`).join(' · ')}. That handle’s Verified mark is already off; the badge stays until you decide.</span>
              <button type="button" className="btn sm" disabled={act.busy} onClick={() => call('checked', {}, 'Marked as checked')}>Mark as checked</button>
            </div>
          )}
          <fieldset className="plain-fieldset stack gap-6">
            <legend className="small t2">Handles on this profile you checked</legend>
            {eligible.length === 0 && <span className="muted small">This profile has no {names.join(', ')} handle. The creator adds it in Settings → Profile first.</span>}
            {eligible.map((s) => (
              <label key={s.platform} className="check">
                <input type="checkbox" checked={ticked.has(s.platform)} onChange={(e) => setTicked((t) => {
                  const n = new Set(t);
                  if (e.target.checked) n.add(s.platform);
                  else n.delete(s.platform);
                  return n;
                })} />
                {s.label} · <span className="mono2">{s.handle}</span>{s.verified && <Chip kind="ok">Verified</Chip>}
              </label>
            ))}
            {account.socials.some((s) => !s.creatorPlatform) && <span className="muted xsmall">Other handles ({account.socials.filter((s) => !s.creatorPlatform).map((s) => s.label).join(', ')}) can’t be verified with this badge.</span>}
          </fieldset>
          <label className="check"><input type="checkbox" checked={codeChecked} onChange={(e) => setCodeChecked(e.target.checked)} /> I saw <span className="mono2">{c.code}</span> on their channel myself</label>
          <div className="field">
            <label htmlFor="creator-reason">Reason <span className="muted">(required, saved to the log)</span></label>
            <textarea id="creator-reason" className="inp" rows={2} maxLength={500} value={reason} placeholder="Where you saw the code, and when" onChange={(e) => setReason(e.target.value)} />
          </div>
          {!holds && <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player with a “Badge granted” toast</label>}
          <div className="row gap-10 wrap-row">
            <button type="button" className={`btn gold${act.busy ? ' is-loading' : ''}`} disabled={!ticked.size || !codeChecked || reason.trim().length < 3 || act.busy}
              onClick={() => call('grant', { platforms: [...ticked], reason, codeChecked, notify }, holds ? 'Verified handles updated' : 'Verified Content Creator granted')}>
              {holds ? 'Update verified handles' : 'Grant Verified Content Creator'}
            </button>
            <ActionStatus action={act} idle={holds ? 'Revoke it from the table above: that removes every Verified mark too.' : null} />
          </div>
        </>
      )}
    </div>
  );
}

function BadgeTable({ state, onGrant }) {
  const [filter, setFilter] = useState('');
  const bf = state.backfill;
  const list = state.definitions.filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="tbar">
        <label className="search"><Icon name="search" size="sm" /><input placeholder="Filter badges" aria-label="Filter badges" value={filter} onChange={(e) => setFilter(e.target.value)} data-edit-guard="off" /></label>
        <span className="spacer" />
        <span className="cnt">{bf ? `Deploy back-fill ${formatDateTime(bf.at)}: ${formatNumber(bf.accounts)} account(s) checked; awarded ${Object.keys(bf.awarded).length ? Object.entries(bf.awarded).map(([k, n]) => `${state.definitions.find((d) => d.id === k)?.name ?? k} ${formatNumber(n)}`).join(' · ') : 'nothing'} (no toasts)` : 'The deploy back-fill hasn’t run yet (the worker runs it within a minute of starting).'}</span>
      </div>
      {list.length === 0 ? <Empty icon="search" title="No badges match" /> : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th>Badge</th><th>Family</th><th>How it’s given</th><th className="r num">Holders</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td className="dtl" data-label=""><span className="who2"><BadgeIcon badge={d} size="inline" /><b>{d.name}</b></span>{d.artTemporary && <span className="sub">Temporary art</span>}</td>
                  <td className="t2" data-label="Family">{d.familyLabel}</td>
                  <td data-label="How it’s given">{d.award === 'automatic' ? <Chip kind="ok">Automatic</Chip> : d.grantable ? <Chip kind="info">Manual</Chip> : <Chip kind="warn">Manual · needs a logo first</Chip>}{d.createdBy === 'admin' && <span className="sub">made here</span>}</td>
                  <td className="r num" data-label="Holders">{formatNumber(d.heldBy)}</td>
                  <td className="r" data-label=""><div className="act">
                    {d.award === 'manual' && d.grantable && d.id !== state.creator?.badgeId && <button type="button" className="btn sm ghost" onClick={() => onGrant(d.id)}>Grant…</button>}
                    <Link className="btn sm ghost" to={`/badges/${d.id}`}>Holders</Link>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Badge logos (0.10.4, server/badges/logos.js): a partner's own branding inside its badge's frame, for every Pro Team,
 * Platform Employee and Community Partner badge. Only WITH permission: who granted it, when and how are required (the
 * server refuses an upload or a save without them) and go to the audit log. The upload comes back re-encoded at every
 * size and is previewed in all three themes, at every pill size and at share-card size, before Save; Cancel discards it.
 * Remove (reason, players see it) puts the badge's own art back; nobody loses the badge.
 */
const EMPTY_NOTE = { grantedBy: '', grantedAt: '', how: '' };
const today = () => new Date().toISOString().slice(0, 10);

function LogoPanel({ state, onChanged }) {
  const badges = state.definitions.filter((d) => d.takesLogo);
  const [id, setId] = useState(badges[0]?.id ?? null);
  const [note, setNote] = useState(EMPTY_NOTE);
  const [preview, setPreview] = useState(null);
  const [backing, setBacking] = useState('none');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const act = useAction();
  const def = badges.find((b) => b.id === id) ?? null;
  const rules = state.logoRules;
  const noteReady = note.grantedBy.trim() && note.grantedAt && note.how.trim();
  const reset = () => {
    setPreview(null);
    setChecked(false);
    setBacking(def?.logo?.backing ?? 'none');
  };
  const discard = () => {
    if (preview) api(`/api/admin/badges/${id}/logo/pending`, { method: 'DELETE' }).catch(() => {});
    reset();
  };
  const upload = (file) => {
    reset();
    if (!file) return;
    // The server decides what the file is from its bytes (a PNG named .jpg is fine; an SVG named .png is not).
    if (file.size > rules.maxBytes) {
      act.set('failed', `That file is over ${rules.maxBytes / 1024} KB.`);
      return;
    }
    act.run(async () => {
      const qs = new URLSearchParams({ grantedBy: note.grantedBy.trim(), grantedAt: note.grantedAt, how: note.how.trim() });
      const res = await fetch(`/api/admin/badges/${id}/logo?${qs}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);
      setPreview(body.preview);
    }, { done: 'Re-encoded: check every size in every theme, then save', working: 'Uploading…' });
  };
  if (!badges.length) return <span className="muted small">No badge takes a logo yet. Make a Pro Team or Community Partner badge from a template (below).</span>;
  const kind = def ? state.logoTemplates[def.template] : null;
  const shown = def ? { ...def, logo: preview ? { backing, srcs: preview } : def.logo } : null;
  const fallback = def?.template === 'platform-employee' ? `its “${def.monogram ?? '?'}” monogram` : 'its own art';
  const set = (k) => (e) => setNote((n) => ({ ...n, [k]: e.target.value }));
  return (
    <div className="mod-split">
      <div className="mod-stack">
        <span className="t2 small">A partner’s own logo inside its badge’s frame: one per Pro Team, per company (Platform Employee) and per Community Partner. <b>Only with the partner’s permission</b>, recorded below. The badge’s name always stays a text pill.</span>
        <div className="radio-list" role="radiogroup" aria-label="Badge">
          {badges.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={id === b.id} className="bdg-pill"
              onClick={() => { discard(); setId(b.id); setBacking(b.logo?.backing ?? 'none'); act.reset(); }}>
              <BadgeIcon badge={b} labelled={false} /><span className="bdg-pill-name">{b.name} <span className="muted xsmall">· {state.logoTemplates[b.template]?.label}{b.logo ? '' : ' · no logo'}</span></span>
            </button>
          ))}
        </div>
        {def && (
          <div className="note small">
            <Icon name="info" />
            {def.logo ? (
              <span className="stack gap-6">
                <span><b>Saved logo</b>{def.logoNote?.setAt ? ` since ${formatDate(def.logoNote.setAt)}` : ''}. Permission: {def.logoNote ? `${def.logoNote.by} · ${def.logoNote.at} · ${def.logoNote.how}` : 'not recorded'}.</span>
                <span><button type="button" className="btn sm danger" onClick={() => setRemoving(true)}>Remove logo…</button></span>
              </span>
            ) : <span>No logo: {def.name} shows {fallback}.{def.template === 'partner-pro' ? ' A Pro Team badge can be granted once its logo is saved.' : ''}</span>}
          </div>
        )}
        <fieldset className="plain-fieldset stack gap-6">
          <legend className="small t2">Permission (all three required, saved to the audit log)</legend>
          <Field label="Who granted it" value={note.grantedBy} onChange={set('grantedBy')} maxLength={120} placeholder="Name and role at the partner" />
          <Field label="When" type="date" value={note.grantedAt} max={today()} onChange={set('grantedAt')} />
          <Field label="How" value={note.how} onChange={set('how')} maxLength={200} placeholder="e.g. email from their marketing lead, Nov 2026" />
        </fieldset>
        <div className="dropzone">
          <Icon name="download" />
          <b>Choose the logo</b>
          <span className="small">PNG or WebP only (no SVG, no JPEG), checked by its content. At least {rules.minSide} × {rules.minSide}, up to {rules.maxBytes / 1024} KB; square with a transparent background works best, no frame (the badge adds its own). Re-encoded on the server at {rules.sizes.join(', ')} px with no metadata; the original isn’t kept.</span>
          <input type="file" accept="image/png,image/webp" disabled={!noteReady || act.busy} aria-label="Logo file (PNG or WebP)" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          {!noteReady && <span className="muted xsmall">Fill in the permission first.</span>}
        </div>
        <ActionStatus action={act} />
        {preview && (
          <Segmented label="Backing" value={backing} onChange={setBacking} options={[{ id: 'none', label: 'No backing' }, { id: 'plate', label: 'Light plate (for dark logos)' }]} />
        )}
        {preview && (
          <div className="row gap-10 wrap-row">
            <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I’ve checked every size in all three themes</label>
            <button type="button" className="btn gold" disabled={!checked || !noteReady} onClick={() => setSaving(true)}>{def?.logo ? 'Replace logo…' : 'Save logo…'}</button>
            <button type="button" className="btn ghost" onClick={() => { discard(); act.reset(); }}>Cancel</button>
          </div>
        )}
      </div>
      {shown && (
        <LogoPreview badge={shown}
          note={preview ? 'Showing the uploaded logo, re-encoded by the server (not saved yet).' : def.logo ? 'Showing the saved logo.' : `No logo yet: showing ${fallback}.`} />
      )}
      {saving && (
        <ConfirmDialog title={`${def.logo ? 'Replace' : 'Save'} the logo for ${def.name}?`} confirmLabel={def.logo ? 'Replace logo' : 'Save logo'} danger={false} playersSee
          what={`It shows wherever ${def.name} does (profiles, pills, inline badges, share cards) at once${def.logo ? ', in place of the saved one (the old image isn’t kept; its permission note stays in the audit log)' : ''}. Permission: ${note.grantedBy.trim()} · ${note.grantedAt} · ${note.how.trim()}.`}
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            await api(`/api/admin/badges/${id}/logo/save`, { method: 'POST', body: { ...note, reason, previewChecked: checked, backing } });
            act.set('done', `Logo saved for ${def.name}${kind ? ` (${kind.label})` : ''}`);
            setPreview(null);
            setChecked(false);
            setNote(EMPTY_NOTE);
            onChanged();
          }} />
      )}
      {removing && (
        <ConfirmDialog title={`Remove ${def.name}’s logo?`} confirmLabel="Remove logo" playersSee
          what={`${def.name} goes back to ${fallback} everywhere at once. Everyone who holds it keeps it. The image is deleted; its permission note and your reason stay in the audit log.`}
          onClose={() => setRemoving(false)}
          onConfirm={async (reason) => {
            await api(`/api/admin/badges/${id}/logo`, { method: 'DELETE', body: { reason } });
            act.set('done', `Logo removed: ${def.name} shows ${fallback} again`);
            onChanged();
          }} />
      )}
    </div>
  );
}

/** One badge at every size it's drawn at, in all three themes: pills (profile 44px, Settings 32px), inline, card, large. */
function LogoPreview({ badge, note }) {
  return (
    <div className="stack gap-8">
      <span className="eyebrow">Preview · all three themes · every size</span>
      <div className="mod-preview3">
        {THEMES.map(([theme, label]) => (
          <div key={theme} data-theme={theme} className="logo-prev">
            <span className="eyebrow">{label}</span>
            <span className="bdg-pill"><BadgeIcon badge={badge} labelled={false} /><span className="bdg-pill-name">{badge.name}</span></span>
            <span className="feat-pill"><BadgeIcon badge={badge} labelled={false} /><span className="bdg-pill-name">{badge.name}</span></span>
            <span className="row gap-6 small"><span className="handle mono">@username</span><BadgeIcon badge={badge} size="inline" labelled={false} /></span>
            <span className="logo-prev-card"><BadgeIcon badge={badge} size="card" labelled={false} /><span className="small">{badge.name}</span></span>
            <span className="row gap-10"><BadgeIcon badge={badge} size="lg" labelled={false} /><BadgeIcon badge={badge} size="xl" labelled={false} /></span>
            <span className="muted xsmall">pill 44 · pill 32 · inline 18 · share card · 112 · 128</span>
          </div>
        ))}
      </div>
      <span className="muted xsmall">{note}</span>
    </div>
  );
}

function ThemePreview({ note, children }) {
  return (
    <div className="stack gap-8">
      <span className="eyebrow">Preview · all three themes · large / standard / inline</span>
      <div className="mod-preview3">
        {THEMES.map(([theme, label]) => <div key={theme} data-theme={theme}><span className="eyebrow">{label}</span>{children()}</div>)}
      </div>
      <span className="muted xsmall">{note}</span>
    </div>
  );
}

const TEMPLATE_HELP = {
  'partner-pro': 'A professional team’s own partner badge. Granted by hand, and only once its logo is saved (Badge logos, above; with the team’s permission).',
  'partner-community': 'One partner site or community (Wowhead, Icy Veins…), made when a partnership exists. Granted by hand; shows the Community Partner art until its logo is saved (Badge logos, above).',
  'platform-employee': 'An employee badge for a sign-in platform: one capital letter on the verified rosette. Granted by hand with a reason; work-email verification comes after 1.0.',
  class: 'A class Blizzard adds. Automatic: it goes to everyone who owns a level 10+ character whose class Blizzard names exactly as typed here, on the next pass (within 6 hours).',
  achievement: 'A new achievement. Granted by hand: an automatic rule needs code (server/badges/rules.js).',
};
const EMPTY_TEMPLATE = { id: '', name: '', description: '', how: '', monogram: '', class: '' };

function TemplatePanel({ state, onChanged }) {
  const [tpl, setTpl] = useState(state.templates[0]?.id ?? 'partner-pro');
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const act = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="mod-stack">
      <Segmented label="Template" options={state.templates.map((t) => ({ id: t.id, label: t.label }))} value={tpl} onChange={setTpl} />
      <span className="t2 small">{TEMPLATE_HELP[tpl]}</span>
      {tpl === 'class' && state.classesWithoutBadge.length > 0 && <div className="note small"><Icon name="info" /><span>Classes Blizzard has returned that have no badge yet: {state.classesWithoutBadge.join(', ')}.</span></div>}
      <div className="mod-row">
        <Field label="Id (in the address /badges/…)" value={form.id} onChange={set('id')} placeholder="a-team-partner" maxLength={48} />
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={40} />
        {tpl === 'platform-employee' && <Field label="Monogram (one capital letter)" value={form.monogram} onChange={set('monogram')} maxLength={1} />}
        {tpl === 'class' && <Field label="Blizzard class name, exactly" value={form.class} onChange={set('class')} maxLength={40} />}
      </div>
      <Field label="Description" value={form.description} onChange={set('description')} maxLength={300} />
      {tpl !== 'class' && <Field label="How it’s earned (optional: a default fits the template)" value={form.how} onChange={set('how')} maxLength={200} />}
      <div className="row gap-10 wrap-row">
        <ActionButton action={act} className="btn" disabled={!form.id || !form.name || !form.description} done={() => `Created ${form.name || 'the badge'}`}
          onRun={async () => {
            await api('/api/admin/badges/definitions', { method: 'POST', body: { template: tpl, ...form } });
            setForm(EMPTY_TEMPLATE);
            onChanged();
          }}>Create badge</ActionButton>
        <ActionStatus action={act} />
      </div>
    </div>
  );
}

/** A start–end window held in an admin setting (Early Supporter, Early Guild). Saving or clearing asks a reason. */
function WindowPanel({ early, settingKey, help, onChanged, extraStatus = null }) {
  const [start, setStart] = useState(early?.start ?? '');
  const [end, setEnd] = useState(early?.end ?? '');
  const [confirm, setConfirm] = useState(null);
  const act = useAction();
  const status = !early ? <Chip kind="off">Not set</Chip> : early.closed ? <Chip kind="off">Closed</Chip> : early.upcoming ? <Chip kind="warn">Upcoming</Chip> : <Chip kind="ok">Open</Chip>;
  return (
    <div className="mod-stack">
      <span className="t2 small">{help}</span>
      <span className="row gap-8 wrap-row small">{status}{early ? <b>{early.start} – {early.end}</b> : null}{extraStatus}</span>
      <div className="mod-row">
        <Field label="Start (YYYY-MM-DD, UTC)" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label="End (included)" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button type="button" className="btn" disabled={!start || !end} onClick={() => setConfirm({ start, end })}>Save window…</button>
        {early && <button type="button" className="btn ghost" onClick={() => setConfirm('clear')}>Clear…</button>}
      </div>
      <ActionStatus action={act} />
      {confirm && (
        <ConfirmDialog title={confirm === 'clear' ? 'Clear the window?' : `Set the window to ${confirm.start} – ${confirm.end}?`} confirmLabel={confirm === 'clear' ? 'Clear window' : 'Save window'} danger={confirm === 'clear'} playersSee
          what={confirm === 'clear' ? 'The badge isn’t awardable any more and shows nowhere. Badges already earned stay.' : 'Accounts or guilds inside it earn the badge on the next pass (within 6 hours).'}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await api(`/api/admin/settings/${settingKey}`, { method: 'PUT', body: { value: confirm === 'clear' ? null : confirm, reason } });
            act.set('done', confirm === 'clear' ? 'Window cleared' : 'Window saved');
            onChanged();
          }} />
      )}
    </div>
  );
}

const PLAYER_ACTIONS = {
  granted: 'Granted', revoked: 'Revoked', mark_uploaded: 'Mark uploaded', mark_saved: 'Mark updated', created: 'Badge created', backfill: 'Back-fill',
  renamed: 'Renamed', creator_started: 'Creator verification started', creator_verified: 'Creator handles verified',
  creator_handle_changed: 'Creator changed a verified handle', creator_revoked: 'Creator marks removed', creator_alert_checked: 'Handle change checked',
  logo_uploaded: 'Logo uploaded (not saved)', logo_saved: 'Logo saved', logo_replaced: 'Logo replaced', logo_removed: 'Logo removed',
  logo_carried_over: 'Partner mark became its logo (0.10.4)',
};
const permissionLine = (d) => (d?.permission && typeof d.permission === 'object' ? `Permission: ${d.permission.by} · ${d.permission.at} · ${d.permission.how}` : null);

function PlayerLog({ state }) {
  if (state.log.length === 0) return <Empty icon="audit" title="Nothing logged yet" />;
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>When</th><th>Action</th><th>Badge</th><th>Account</th><th>Reason</th></tr></thead>
        <tbody>
          {state.log.map((e) => (
            <tr key={e.id}>
              <td className="dtl" data-label=""><span className="t2 nw">{formatDateTime(e.at)}</span></td>
              <td data-label="Action"><Chip kind={e.type === 'granted' ? 'ok' : e.type === 'revoked' ? 'err' : 'info'}>{PLAYER_ACTIONS[e.type] ?? e.type}</Chip></td>
              <td data-label="Badge">{e.badgeId ? state.definitions.find((d) => d.id === e.badgeId)?.name ?? e.badgeId : '—'}</td>
              <td data-label="Account">{e.accountId ? <Link className="tgt" to={`/admin/directory/accounts/${e.accountId}`}>{e.username ? `@${e.username}` : `#${e.accountId}`}</Link> : '—'}</td>
              <td className="t2" data-label="Reason">{[e.reason, permissionLine(e.detail)].filter(Boolean).join(' · ') || (e.type === 'backfill' ? `${e.detail.accounts} accounts` : e.type === 'logo_carried_over' ? 'Permission not recorded (uploaded before 0.10.4)' : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- Guild badges
const GUILD_TYPES = {
  unlocked: 'Unlocked', level: 'Level up', lost: 'Lost', regained: 'Regained', granted: 'Granted', revoked: 'Revoked', display: 'Display',
  thresholds: 'Thresholds', mark_uploaded: 'Emblem uploaded', mark_saved: 'Emblem saved', created: 'Created', backfill: 'Back-fill',
};
const compact = (n) => (n >= 1e6 ? `${formatNumber(n / 1e6)}M` : n >= 1e4 ? `${formatNumber(n / 1e3)}k` : formatNumber(n));

export function GuildBadgesTab() {
  const p = usePanel('badges-guild', () => api('/api/admin/guild-badges'), []);
  const [editing, setEditing] = useState(null);
  const [granting, setGranting] = useState(null);
  const s = p.data;
  return (
    <>
      <BadgeTabs guild={s ? formatNumber(s.definitions.length) : null} />
      <Panel panel={p} title="Milestone badges · levels I–V" id="milestones" flush footer="Changing a threshold never takes a level away from a guild that already reached it.">
        {(d) => {
          const levelled = d.definitions.filter((x) => x.levelled);
          return levelled.length === 0 ? <Empty icon="badge" title="No levelled guild badges" /> : (
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th>Badge</th><th>Measure</th><th>Thresholds I → V</th><th>Guilds at I · II · III · IV · V</th><th className="r"><span className="sr-only">Edit</span></th></tr></thead>
                <tbody>
                  {levelled.map((x) => (
                    <tr key={x.id} className={editing === x.id ? 'is-sel' : ''}>
                      <td className="dtl" data-label=""><span className="who2"><GuildBadgeIcon badge={x} size="inline" labelled={false} /><b>{x.name}</b></span></td>
                      <td className="t2" data-label="Measure">{x.measure}</td>
                      <td data-label="Thresholds I → V"><span className="mono2">{x.thresholds.map(compact).join(' · ')}</span></td>
                      <td data-label="Guilds at each level"><span className="num t2">{(x.byLevel ?? []).map(formatNumber).join(' · ')}</span></td>
                      <td className="r" data-label=""><div className="act"><button type="button" className="btn sm ghost" onClick={() => { setEditing(x.id); scrollTo('thresholds'); }}>Edit levels…</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Panel>
      {editing && s && (
        <Panel panel={p} title={`Level thresholds · ${s.definitions.find((x) => x.id === editing)?.name ?? editing}`} id="thresholds" actions={<button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>Close</button>}>
          {(d) => <Thresholds key={editing} def={d.definitions.find((x) => x.id === editing)} onChanged={p.reload} />}
        </Panel>
      )}
      <Panel panel={p} title="Other guild badges" id="others" flush>
        {(d) => (
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Badge</th><th>Family</th><th>How it’s given</th><th className="r num">Guilds holding it</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.definitions.filter((x) => !x.levelled).map((x) => (
                  <tr key={x.id}>
                    <td className="dtl" data-label=""><span className="who2"><GuildBadgeIcon badge={x} size="inline" labelled={false} /><b>{x.name}</b></span></td>
                    <td className="t2" data-label="Family">{d.families?.find?.((f) => f.id === x.family)?.label ?? x.family}</td>
                    <td data-label="How it’s given">{x.grantable ? <Chip kind="info">Manual (staff)</Chip> : <Chip kind="ok">Automatic</Chip>}</td>
                    <td className="r num" data-label="Guilds holding it">{formatNumber(x.heldBy)}</td>
                    <td className="r" data-label=""><div className="act">{x.grantable && <button type="button" className="btn sm ghost" onClick={() => { setGranting(x.id); scrollTo('guild-grant'); }}>Grant…</button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel panel={p} title="Grant or revoke" id="guild-grant">
        {(d) => <GuildGrant state={d} badgeId={granting} setBadgeId={setGranting} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title="Early Guild window" id="set-guildBadges.earlyWindow">
        {(d) => <WindowPanel early={d.early} settingKey="guildBadges.earlyWindow" onChanged={p.reload}
          help="Guilds first tracked between these dates unlock Early Guild. After it closes, the badge shows “No longer available”. Unset, it shows nowhere. Founding Guild uses the open-beta window and can’t be edited." />}
      </Panel>
      <Panel panel={p} title="Partner guild emblem" id="emblem">
        {(d) => <PartnerEmblem state={d} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title="New Deeds badge" id="deeds">
        {(d) => <DeedsTemplate state={d} onChanged={p.reload} />}
      </Panel>
      <Panel panel={p} title="Back-fill on deploy" id="backfill">
        {(d) => <GuildBackfill state={d} />}
      </Panel>
      <Panel panel={p} title="Log" id="glog" flush>
        {(d) => <GuildLog state={d} />}
      </Panel>
    </>
  );
}

function GuildBackfill({ state }) {
  const b = state.backfill;
  if (!b) return <span className="muted small">The one-time back-fill hasn’t run yet: the worker runs it within a minute of starting.</span>;
  const defs = new Map(state.definitions.map((d) => [d.id, d]));
  return (
    <div className="stack gap-8">
      <span className="t2 small">{formatDateTime(b.at)} · {formatNumber(b.guilds)} guild{b.guilds === 1 ? '' : 's'} checked, no toasts and no “Unlocked” ribbons. Held right after it:</span>
      {b.held.length === 0 ? <span className="muted small">Nothing.</span> : (
        <div className="mod-pills">{b.held.map((h) => <Chip key={`${h.badge}-${h.level}`} kind="info">{defs.get(h.badge)?.name ?? h.badge}{h.level ? ` ${NUMERALS[h.level - 1]}` : ''}: {formatNumber(h.guilds)}</Chip>)}</div>
      )}
    </div>
  );
}

/** A guild picked by name (the admin's own search of stored guilds; no Blizzard request). */
function GuildPicker({ value, onPick, label = 'Guild' }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => api(`/api/admin/guild-badges/guilds?q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) setFound(r.guilds); }, () => {}), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  if (value) {
    return (
      <div className="row gap-8 wrap-row">
        <span className="lbl">{label}</span><b>{value.name}</b><span className="muted xsmall">{value.faction ?? ''} · #{value.id}</span>
        <Link className="btn ghost sm" to={`/admin/directory/guilds/${value.id}/links`}>Open in Directory</Link>
        <button type="button" className="btn ghost sm" onClick={() => onPick(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="stack gap-6">
      <Field label={label} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guild name" autoComplete="off" />
      {found.length > 0 && <div className="mod-pills">{found.map((g) => <button key={g.id} type="button" className="btn sm ghost" onClick={() => onPick(g)}>{g.name}</button>)}</div>}
      {q.trim().length >= 2 && found.length === 0 && <span className="muted xsmall">No stored guild matches.</span>}
    </div>
  );
}

function GuildGrant({ state, badgeId, setBadgeId, onChanged }) {
  const staff = state.definitions.filter((d) => d.grantable);
  const [guild, setGuild] = useState(null);
  const [detail, setDetail] = useState(null);
  const [labelText, setLabelText] = useState('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState(null);
  const act = useAction();
  const chosen = badgeId ?? staff[0]?.id ?? null;
  useEffect(() => {
    setDetail(null);
    if (guild) api(`/api/admin/guild-badges/guilds/${guild.id}`).then((r) => setDetail(r.guild), () => {});
  }, [guild]);
  const def = staff.find((d) => d.id === chosen);
  return (
    <div className="mod-stack">
      <GuildPicker value={guild} onPick={setGuild} />
      {detail && (
        <div className="stack gap-6">
          <span className="lbl">Badges now</span>
          {detail.awards.length === 0 ? <span className="muted small">None.</span> : (
            <div className="rlist flush-rlist">
              {detail.awards.map((a) => (
                <div key={a.id}>
                  <GuildBadgeIcon badge={a} size="inline" />
                  <span className="small">{guildBadgeName(a)} <Chip kind={a.state === 'held' ? 'ok' : 'off'}>{a.state}</Chip> <span className="muted xsmall">{a.source === 'admin' ? `granted: ${a.reason ?? ''}` : 'automatic'}</span></span>
                  {a.award === 'manual' && a.state === 'held' ? <button type="button" className="btn danger sm" onClick={() => setRevoking(a)}>Revoke…</button> : <span />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="lbl" id="staff-badge-h">Badge (staff badges only)</span>
      <div className="radio-list" role="radiogroup" aria-labelledby="staff-badge-h">
        {staff.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={chosen === d.id} className="gpill sm" onClick={() => setBadgeId(d.id)}>
            <GuildBadgeIcon badge={d} size="pill-ico" labelled={false} /><span>{d.name}</span>
          </button>
        ))}
      </div>
      {chosen === 'featured-guild' && (
        <div className="mod-row">
          <Field label="Event label (optional)" value={labelText} onChange={(e) => setLabelText(e.target.value)} maxLength={40} />
          <Field label="Show until (optional, YYYY-MM-DD)" value={until} onChange={(e) => setUntil(e.target.value)} placeholder="YYYY-MM-DD" maxLength={10} />
        </div>
      )}
      {def?.template === 'partner-guild' && <span className="muted xsmall">Partner Guild needs this guild’s emblem saved first (Partner guild emblem, below).</span>}
      <div className="field">
        <label htmlFor="gb-reason">Reason <span className="muted">(required, saved to the log)</span></label>
        <textarea id="gb-reason" className="inp" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this guild getting this badge?" />
      </div>
      <div className="row gap-10 wrap-row">
        <ActionButton action={act} className="btn gold" disabled={!guild || !chosen || reason.trim().length < 3}
          done={() => `Granted ${def?.name ?? 'the badge'}: the Guild Master and officers get a toast on their next visit`}
          onRun={async () => {
            setDetail((await api(`/api/admin/guild-badges/guilds/${guild.id}/grant`, { method: 'POST', body: { badgeId: chosen, reason, label: labelText, until } })).guild);
            setReason('');
            onChanged();
          }}>Grant {def?.name ?? ''}</ActionButton>
        <ActionStatus action={act} idle="Revoke asks for its own reason." />
      </div>
      {revoking && (
        <ConfirmDialog title={`Revoke ${revoking.name} from ${guild.name}?`} confirmLabel={`Revoke ${revoking.name}`} playersSee
          what="It leaves the guild page at once. The award is kept as revoked, with your reason, in the log."
          onClose={() => setRevoking(null)}
          onConfirm={async (r) => {
            setDetail((await api(`/api/admin/guild-badges/guilds/${guild.id}/revoke`, { method: 'POST', body: { badgeId: revoking.id, reason: r } })).guild);
            act.set('done', `Revoked ${revoking.name}`);
            onChanged();
          }} />
      )}
    </div>
  );
}

function Thresholds({ def, onChanged }) {
  const [values, setValues] = useState(def.thresholds.map(String));
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const previewAct = useAction();
  const saveAct = useAction();
  const nums = values.map((v) => Number(String(v).replace(/[,_\s]/g, '')));
  const max = preview ? Math.max(1, ...preview.wouldReach, ...preview.holdNow) : 1;
  return (
    <div className="mod-stack">
      <span className="t2 small">Lowering a threshold unlocks levels within a minute; raising one never removes a level a guild already holds. Preview first.</span>
      <div className="mod-thr">
        {['I · Iron', 'II · Bronze', 'III · Silver', 'IV · Gold', 'V · Forever'].map((l, i) => (
          <Field key={l} label={`Level ${l}`} value={values[i] ?? ''} inputMode="numeric" onChange={(e) => { const v = [...values]; v[i] = e.target.value; setValues(v); setPreview(null); }} />
        ))}
      </div>
      <div className="row gap-10 wrap-row">
        <ActionButton action={previewAct} done={(r) => `${formatNumber(r.measuredGuilds)} guilds measured`} working="Counting…"
          onRun={async () => {
            const r = await api(`/api/admin/guild-badges/${def.id}/thresholds/preview`, { method: 'POST', body: { thresholds: nums } });
            setPreview(r);
            return r;
          }}>Preview</ActionButton>
        <button type="button" className="btn gold" disabled={!preview} onClick={() => setSaving(true)}>Save thresholds…</button>
        <button type="button" className="btn ghost" onClick={() => { setValues(def.thresholds.map(String)); setPreview(null); }}>Reset</button>
        <ActionStatus action={previewAct} />
        <ActionStatus action={saveAct} />
      </div>
      {preview && (
        <div className="stack gap-8">
          <span className="eyebrow">Guilds whose current value reaches each level ({formatNumber(preview.measuredGuilds)} measured)</span>
          <div className="mod-levels">
            {nums.map((n, i) => (
              <div key={NUMERALS[i]}>
                <span className="mono2">{NUMERALS[i]}</span>
                <div className="bar sm"><span style={{ width: `${(preview.wouldReach[i] / max) * 100}%` }} /></div>
                <span>{formatNumber(preview.wouldReach[i])} <span className="muted xsmall">({formatNumber(preview.holdNow[i])} hold it now)</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
      {saving && (
        <ConfirmDialog title={`Save the ${def.name} thresholds?`} confirmLabel="Save thresholds" danger={false} playersSee
          what={`New levels: ${nums.map(formatNumber).join(' · ')}. Guilds that reach a lowered level unlock it within a minute. A guild that holds a level keeps it.`}
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            await api(`/api/admin/guild-badges/${def.id}/thresholds`, { method: 'PUT', body: { thresholds: nums, reason } });
            saveAct.set('done', 'Thresholds saved');
            onChanged();
          }} />
      )}
    </div>
  );
}

function PartnerEmblem({ state, onChanged }) {
  const partner = state.definitions.find((d) => d.template === 'partner-guild');
  const [guild, setGuild] = useState(null);
  const [permission, setPermission] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const act = useAction();
  if (!partner) return <span className="muted small">There is no Partner Guild badge.</span>;
  const saved = guild ? state.marks.find((m) => m.guildId === guild.id) : null;
  const upload = (file) => {
    if (!file || !guild) return;
    act.run(async () => {
      const res = await fetch(`/api/admin/guild-badges/guilds/${guild.id}/mark?permission=confirmed`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);
      setPreviewUrl(body.preview);
      setChecked(false);
    }, { done: 'Uploaded: check the preview, then save', working: 'Uploading…' });
  };
  const cancel = async () => {
    if (guild) await api(`/api/admin/guild-badges/guilds/${guild.id}/mark/pending`, { method: 'DELETE' }).catch(() => {});
    setPreviewUrl(null);
    act.reset();
  };
  const shown = { ...partner, mark: previewUrl ?? saved?.url ?? null };
  return (
    <div className="mod-split">
      <div className="mod-stack">
        <span className="t2 small">A partner guild’s own emblem in the Partner Guild template, only with their written permission.</span>
        <GuildPicker value={guild} onPick={(g) => { setGuild(g); setPreviewUrl(null); }} />
        <label className="check"><input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} /> The guild has given written permission to use this emblem</label>
        <div className="dropzone stack gap-6">
          <Icon name="download" />
          <b>Choose the emblem</b>
          <span className="muted xsmall">PNG or WebP only, at least 256 × 256, at most 2 MB. No SVG. It’s re-encoded on the server; nothing but its pixels is kept. It sits in a circle on the cloth.</span>
          <input type="file" accept="image/png,image/webp" disabled={!guild || !permission || act.busy} aria-label="Emblem file" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        <label className="check"><input type="checkbox" checked={checked} disabled={!previewUrl} onChange={(e) => setChecked(e.target.checked)} /> Checked in all three themes and at inline size</label>
        <div className="row gap-10 wrap-row">
          <button type="button" className="btn gold" disabled={!previewUrl || !checked} onClick={() => setSaving(true)}>Save emblem…</button>
          {previewUrl && <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>}
          <ActionStatus action={act} idle={saved && !previewUrl ? `Saved emblem since ${formatDate(saved.setAt)}.` : null} />
        </div>
      </div>
      <ThemePreview note={shown.mark ? (previewUrl ? 'Showing the uploaded emblem (not saved yet).' : 'Showing the saved emblem.') : 'The template’s neutral “PG” placeholder until an emblem is uploaded.'}>
        {() => (
          <>
            <GuildBadgeIcon badge={shown} size="lg" labelled={false} />
            <span className="row gap-10"><GuildBadgeIcon badge={shown} labelled={false} /><GuildBadgeIcon badge={shown} size="inline" labelled={false} /></span>
            <GuildPill badge={{ ...shown, heldBy: 0 }} small ribbon={false} />
          </>
        )}
      </ThemePreview>
      {saving && (
        <ConfirmDialog title={`Save this emblem for ${guild.name}?`} confirmLabel="Save emblem" danger={false} playersSee
          what="It replaces any saved emblem for this guild (the old one isn’t kept). Partner Guild can then be granted to it."
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            await api(`/api/admin/guild-badges/guilds/${guild.id}/mark/save`, { method: 'POST', body: { reason, previewChecked: checked } });
            act.set('done', 'Emblem saved: Partner Guild can now be granted to this guild');
            setPreviewUrl(null);
            onChanged();
          }} />
      )}
    </div>
  );
}

const EMPTY_DEEDS = { id: '', name: '', statistic: '', measure: '', thresholds: ['', '', '', '', ''] };

function DeedsTemplate({ state, onChanged }) {
  const [form, setForm] = useState(EMPTY_DEEDS);
  const [filter, setFilter] = useState('');
  const act = useAction();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const matches = filter.trim().length >= 2 ? state.statisticNames.filter((n) => n.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 12) : [];
  return (
    <div className="mod-stack">
      <span className="t2 small">From the Deeds template: the combined total of one statistic, levels I–V. Drawn with the template’s neutral motif. Deeds statistics are matched by name.</span>
      <div className="mod-row">
        <Field label="Id (lower case, hyphens)" value={form.id} onChange={(e) => set('id', e.target.value)} maxLength={48} />
        <Field label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={40} />
      </div>
      <Field label="Find the statistic (by name, from the catalog)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {matches.length > 0 && <div className="radio-list" role="radiogroup" aria-label="Statistic">{matches.map((n) => <button key={n} type="button" role="radio" aria-checked={form.statistic === n} className="btn sm" onClick={() => set('statistic', n)}>{n}</button>)}</div>}
      {form.statistic && <span className="small">Statistic: <b>{form.statistic}</b></span>}
      <Field label="Measure (how progress reads)" value={form.measure} onChange={(e) => set('measure', e.target.value)} maxLength={40} />
      <div className="mod-thr">
        {NUMERALS.map((l, i) => <Field key={l} label={`Level ${l}`} value={form.thresholds[i]} inputMode="numeric" onChange={(e) => set('thresholds', form.thresholds.map((v, j) => (j === i ? e.target.value : v)))} />)}
      </div>
      <div className="row gap-10 wrap-row">
        <ActionButton action={act} className="btn gold" disabled={!form.id || !form.name || !form.statistic} done={() => 'Guild badge created: guilds are checked for it within a minute'}
          onRun={async () => {
            await api('/api/admin/guild-badges/definitions', { method: 'POST', body: { ...form, thresholds: form.thresholds.map((v) => Number(String(v).replace(/[,_\s]/g, ''))) } });
            setForm(EMPTY_DEEDS);
            onChanged();
          }}>Create guild badge</ActionButton>
        <ActionStatus action={act} />
      </div>
    </div>
  );
}

function GuildLog({ state }) {
  if (state.log.length === 0) return <Empty icon="audit" title="Nothing logged yet" />;
  const defs = new Map(state.definitions.map((d) => [d.id, d]));
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>When</th><th>Action</th><th>Badge</th><th>Guild</th><th>Reason</th></tr></thead>
        <tbody>
          {state.log.map((e) => (
            <tr key={e.id}>
              <td className="dtl" data-label=""><span className="t2 nw">{formatDateTime(e.at)}</span></td>
              <td data-label="Action"><Chip kind={e.type === 'granted' ? 'ok' : e.type === 'revoked' ? 'err' : 'info'}>{GUILD_TYPES[e.type] ?? e.type}</Chip></td>
              <td data-label="Badge">{e.badgeId ? (defs.get(e.badgeId)?.name ?? e.badgeId) : '—'}{e.type === 'thresholds' && e.detail?.to ? <span className="sub">→ {e.detail.to.map(formatNumber).join(' / ')}</span> : null}</td>
              <td data-label="Guild">{e.guild ? <Link className="tgt" to={`/admin/directory/guilds/${e.guild.id}/links`}>{e.guild.name ?? `#${e.guild.id}`}</Link> : e.type === 'backfill' ? `${formatNumber(e.detail?.guilds ?? 0)} guilds` : '— all guilds —'}</td>
              <td className="t2" data-label="Reason">{e.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
