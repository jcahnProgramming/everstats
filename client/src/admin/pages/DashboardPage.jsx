import { useCallback, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Segmented } from '../../components/Controls.jsx';
import { Sortable } from '../../components/Sortable.jsx';
import { formatBytes, formatNumber, timeAgo } from '../../format.js';
import { usePanel } from '../shell/refresh.jsx';
import { ActionButton, ActionStatus, Chip, PageHead, ScopedLink, useAction } from '../shell/parts.jsx';
import { useScope, useShellInfo } from '../shell/scope.jsx';
import { errorWords } from '../shell/refresh.jsx';
import './dashboard.css';

/**
 * The admin Dashboard (0.10.3, design/v5-admin pages/dashboard, dashboard-edit, dashboard-clear). The landing page.
 *
 *   Needs you   a strip of link chips to wherever each thing is dealt with; "All clear" with a one-line summary when empty
 *   Period      since I last checked / 24 h / 7 days / since launch, applied to every card's change; Mark as checked
 *   Cards       CARDS below, in the admin's saved order, hidden ones in a tray; per-version cards follow the switcher
 *
 * Different from the mockup, on purpose:
 *   - Player data shows "Banned now" where the mockup has "Sign-ins · 24 h": Everstats doesn't count sign-ins (Activity
 *     counts only the kinds in server/activity/count.js), and a number we don't measure is never shown.
 *   - Edit layout reorders compact, same-size tiles (title + headline) with the site's one drag list (Sortable): items
 *     in one list must be the same size (CLAUDE.md, Sortable), and the full cards differ in width. Done shows the cards
 *     in the new order.
 *   - Faction / Ruleset / Characters say "tracked" counts from Everstats' database; Blizzard data that aged out of the
 *     30-day window isn't counted.
 */
const RANGES = [
  { id: 'checked', label: 'Since I last checked' },
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 days' },
  { id: 'launch', label: 'Since launch' },
];

function Delta({ n, unit = '' }) {
  if (n === null || n === undefined) return null;
  if (n === 0) return <span className="delta flat">— no change</span>;
  return <span className={`delta ${n > 0 ? 'up' : 'down'}`}>{n > 0 ? '▲' : '▼'} {formatNumber(Math.abs(n))}{unit}</span>;
}

function Spark({ days, label }) {
  const values = days.map((d) => d.n);
  if (values.every((v) => v === null)) return <span className="muted xsmall">{label}: not counted for these days</span>;
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const w = 100 / days.length;
  return (
    <figure className="spark-fig">
      <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${label}: ${values.map((v) => v ?? 'not counted').join(', ')}`}>
        {days.map((d, i) => {
          const h = d.n === null ? 0 : Math.max(1.5, (d.n / max) * 38);
          return <rect key={d.day} className={i === days.length - 1 ? 'last' : undefined} x={i * w + w * 0.12} y={40 - h} width={w * 0.76} height={h} rx="0.8" />;
        })}
      </svg>
      <figcaption className="muted xsmall">{label} · {days.length} days</figcaption>
    </figure>
  );
}

function Bar({ value, max, label, n }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bdrow">
      <span>{label}</span>
      <div className="bar sm" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <span className="n">{n ?? formatNumber(value)}</span>
    </div>
  );
}

const sinceText = (range) => (range === 'launch' ? 'Since launch' : range === '24h' ? 'Last 24 h' : range === '7d' ? 'Last 7 days' : 'Since last check');

/** The cards: id, title, wide, global (All versions), the section it links to, and how it draws. */
const CARDS = [
  {
    id: 'players', title: 'Player data', wide: true, global: true, link: { to: '/admin/directory/accounts', label: 'Accounts' },
    headline: (c) => ({ big: formatNumber(c.total), lab: 'accounts', delta: c.new }),
    change: (c) => (c.new === null ? null : `${c.new >= 0 ? '+' : ''}${formatNumber(c.new)} accounts`),
    body: (c) => {
      const maxM = Math.max(1, ...c.methods.map((m) => m.n));
      const label = { battlenet: 'Battle.net', discord: 'Discord', passkey: 'Player passkeys' };
      return (
        <>
          <div className="kpis">
            <div className="kpi"><span className="l">New · 24 h</span><span className="v">{formatNumber(c.new24)}</span><span className="d"><Delta n={c.new24 - c.new24before} /> vs the day before</span></div>
            <div className="kpi"><span className="l">Beta members</span><span className="v">{formatNumber(c.beta)}</span><span className="d">Beta {c.betaOpen ? 'open' : 'closed'}</span></div>
            <div className="kpi"><span className="l">2FA or passkey</span><span className="v">{c.total ? `${Math.round((c.strong / c.total) * 100)}%` : '—'}</span><span className="d">{formatNumber(c.strong)} accounts{c.totp !== undefined ? ` · 2FA ${formatNumber(c.totp)} · passkey ${formatNumber(c.passkeys)}` : ''}</span></div>
            <div className="kpi"><span className="l">Banned now</span><span className="v">{formatNumber(c.banned)}</span><span className="d">{formatNumber(c.tempBanned)} temporary</span></div>
          </div>
          <div className="cols2">
            <div className="breakdown">
              <span className="eyebrow">Player accounts per sign-in method</span>
              {c.methods.map((m) => <Bar key={m.id} label={label[m.id] ?? m.id} value={m.n} max={maxM} />)}
            </div>
            <div className="stack gap-6">
              <span className="eyebrow">Moderation status</span>
              <div className="row gap-6 wrap-row">
                <Chip kind="ok">Not banned {formatNumber(c.total - c.banned)}</Chip>
                <Chip kind="warn">Warned {formatNumber(c.warned)}</Chip>
                <Chip kind="warn" icon="clock">Temp-banned {formatNumber(c.tempBanned)}</Chip>
                <Chip kind="err" icon="no-coverage">Banned {formatNumber(c.banned)}</Chip>
              </div>
              <span className="muted xsmall">Gold shown publicly: {formatNumber(c.goldPublic)} characters (counts only)</span>
              <Spark days={c.days} label="New accounts per day" />
            </div>
          </div>
        </>
      );
    },
  },
  {
    id: 'inbox', title: 'Inbox', global: true, link: { to: '/admin/inbox/feedback', label: 'Inbox' },
    headline: (c) => ({ big: formatNumber(c.total), lab: 'need a reply or decision', delta: c.new }),
    change: (c) => (c.new === null ? null : `+${formatNumber(c.new)} new`),
    body: (c) => {
      const max = Math.max(1, c.unread - c.appeals, c.reports, c.appeals);
      return (
        <div className="breakdown">
          <Bar label="Unread feedback" value={c.unread - c.appeals} max={max} />
          <Bar label="Open reports" value={c.reports} max={max} />
          <Bar label="Ban appeals" value={c.appeals} max={max} />
          <span className="muted xsmall">{c.oldestUnread ? `Oldest unread: ${timeAgo(c.oldestUnread)}` : 'Nothing unread'}</span>
        </div>
      );
    },
  },
  {
    id: 'faction', title: 'Faction data', link: { to: '/admin/directory/characters', label: 'Directory' },
    headline: (c, all) => {
      const t = c.tracked || 0;
      const pct = (n) => (t ? Math.round((n / t) * 100) : 0);
      return { big: t ? c.names.map((f) => pct(c.overall[f])).join(' / ') : '—', lab: t ? `${c.names.join(' / ')} · % of tracked, all ${all.ruleset?.list?.length ? 'rulesets' : 'characters'}` : 'no tracked characters yet', delta: null };
    },
    change: (c) => (c.new === null ? null : `+${formatNumber(c.new)} tracked`),
    body: (c, all) => {
      if (!c.tracked) return <span className="muted small">No tracked characters on this version and region yet.</span>;
      const cls = (f) => (f === 'Alliance' ? 'al' : f === 'Horde' ? 'ho' : 'nn');
      return (
        <>
          <div className="splitbar" role="img" aria-label={c.names.map((f) => `${f} ${formatNumber(c.overall[f])}`).join(', ')}>
            {c.names.map((f) => <span key={f} className={cls(f)} style={{ width: `${(c.overall[f] / c.tracked) * 100}%` }}>{f} {Math.round((c.overall[f] / c.tracked) * 100)}%</span>)}
            {c.none > 0 && <span className="nn" style={{ width: `${(c.none / c.tracked) * 100}%` }}>None</span>}
          </div>
          {!all.ruleset.error && (
            <div className="breakdown">
              {all.ruleset.list.filter((r) => r.tracked > 0).map((r) => (
                <div className="bdrow" key={r.id}>
                  <span>{r.name}</span>
                  <div className="splitbar sm" aria-hidden="true">{c.names.map((f) => <span key={f} className={cls(f)} style={{ width: `${r.tracked ? ((r.factions[f] ?? 0) / r.tracked) * 100 : 0}%` }} />)}</div>
                  <span className="n">{c.names.map((f) => formatNumber(r.factions[f] ?? 0)).join(' / ')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      );
    },
  },
  {
    id: 'ruleset', title: 'Ruleset data', link: { to: '/admin/tiers', label: 'Tiers' },
    headline: (c) => {
      const graded = c.list.filter((r) => r.eligible >= c.minPopulation).length;
      return { big: c.list.length ? `${graded} of ${c.list.length}` : '—', lab: c.list.length ? 'rulesets at the tier minimum' : 'no rulesets loaded yet', delta: null };
    },
    change: (c) => (c.new === null ? null : `+${formatNumber(c.new)} tracked`),
    body: (c) => {
      const max = Math.max(c.minPopulation, ...c.list.map((r) => r.eligible));
      return (
        <div className="breakdown">
          {c.list.map((r) => <Bar key={r.id} label={r.name} value={r.eligible} max={max} n={r.eligible >= c.minPopulation ? formatNumber(r.eligible) : `${formatNumber(r.eligible)} / ${formatNumber(c.minPopulation)}`} />)}
          <span className="muted xsmall">Tier minimum {formatNumber(c.minPopulation)} tier-eligible · {c.lastGradedAt ? `last graded ${timeAgo(c.lastGradedAt)}` : 'not graded yet'}</span>
        </div>
      );
    },
  },
  {
    id: 'characters', title: 'Characters & guilds', link: { to: '/admin/directory/characters', label: 'Directory' },
    headline: (c) => ({ big: formatNumber(c.known), lab: 'characters known', delta: c.new }),
    change: (c) => (c.new === null ? null : `+${formatNumber(c.new)} characters · +${formatNumber(c.newGuilds)} guilds`),
    body: (c) => {
      const max = Math.max(1, c.tracked, ...c.bySource.map((s) => s.n));
      return (
        <div className="breakdown">
          <Bar label="Tracked" value={c.tracked} max={max} />
          {c.bySource.map((s) => <Bar key={s.id} label={`Arrived by ${s.id === 'lookup' ? 'lookup' : s.id === 'account' ? 'sign-in' : 'roster seed'}`} value={s.n} max={max} />)}
          <span className="small"><b>{formatNumber(c.guilds)}</b> guilds known · {formatNumber(c.hidden)} hidden · {formatNumber(c.missing)} missing</span>
        </div>
      );
    },
  },
  {
    id: 'searches', title: 'Searches & traffic', wide: true, global: true, link: { to: null, label: null },
    headline: (c) => {
      const total = ['character.search', 'guild.search', 'search.page'].reduce((n, k) => n + (c.kinds[k]?.since ?? 0), 0);
      return { big: formatNumber(total), lab: 'searches', delta: null };
    },
    change: (c) => (c.partial ? 'Counting began later: earlier is unknown' : null),
    body: (c) => {
      const rows = Object.entries(c.kinds).filter(([, k]) => k.total > 0 || true);
      const max = Math.max(1, ...rows.map(([, k]) => k.since));
      return (
        <>
          <Spark days={c.days} label="Searches and look-ups per day" />
          <div className="breakdown">
            {rows.map(([id, k]) => <Bar key={id} label={k.label} value={k.since} max={max} />)}
          </div>
          {c.partial && <span className="muted xsmall">Counting began {c.countingSince ? timeAgo(c.countingSince) : 'with 0.7.1'}; before that is unknown, not zero.</span>}
        </>
      );
    },
  },
  {
    id: 'crawler', title: 'Crawler', link: { to: '/admin/data/crawler', label: 'Crawler' },
    headline: (c) => ({ big: String(c.perSecond), lab: `of ${formatNumber(c.ceiling)} requests / s this hour`, delta: null }),
    change: () => null,
    body: (c) => {
      const state = { running: ['ok', 'Running'], idle: ['ok', 'Idle'], paused: ['warn', 'Background paused'], not_responding: ['err', 'Not responding'], not_configured: ['warn', 'No Blizzard keys'], not_started: ['off', 'Not started'] }[c.state] ?? ['info', c.state];
      return (
        <>
          <div className="row gap-6 wrap-row">
            <Chip kind={state[0]}>{state[1]}</Chip>
            {c.budgetUsedPct !== null && <Chip kind={c.budgetUsedPct >= 90 ? 'warn' : 'info'} icon="chart">{c.budgetUsedPct}% of budget</Chip>}
          </div>
          <div className="bar" aria-hidden="true"><span style={{ width: `${Math.min(100, c.budgetUsedPct ?? 0)}%` }} /></div>
          <dl className="kvs">
            <dt>Queue</dt><dd>{formatNumber(c.queued)} waiting · {formatNumber(c.running)} running</dd>
            <dt>This hour</dt><dd>{formatNumber(c.requestsThisHour)} requests · {formatNumber(c.errorsThisHour)} errors · {formatNumber(c.throttled)} throttled</dd>
            <dt>Last error</dt><dd>{c.lastError ? `${c.lastError.status ?? c.lastError.error ?? ''} · ${timeAgo(c.lastError.at)}` : 'None since the worker started'}</dd>
          </dl>
        </>
      );
    },
  },
  {
    id: 'collections', title: 'Collections', link: { to: '/admin/data/collections', label: 'Catalogs' },
    headline: (c) => ({ big: c.tracked ? `${Math.round((c.with_collections / c.tracked) * 100)}%` : '—', lab: 'of tracked characters have collections', delta: c.new }),
    change: (c) => (c.new === null ? null : `+${formatNumber(c.new)} first fetches`),
    body: (c) => {
      const by = (s) => c.catalogs.filter((x) => x.state === s).length;
      return (
        <>
          <div className="bar" aria-hidden="true"><span style={{ width: `${c.tracked ? (c.with_collections / c.tracked) * 100 : 0}%` }} /></div>
          <div className="row gap-6 wrap-row">
            <Chip kind="ok">{by('ok')} ready</Chip>
            {by('building') + by('queued') > 0 && <Chip kind="run">{by('building') + by('queued')} building</Chip>}
            {by('failed') > 0 && <Chip kind="err">{by('failed')} failed</Chip>}
            {by('empty') > 0 && <Chip kind="off">{by('empty')} empty</Chip>}
          </div>
          <span className="muted xsmall">Backfill {c.backfill ? 'on' : 'off'} · {formatNumber(c.perDay)} characters / day · {formatNumber(c.with_collections)} of {formatNumber(c.tracked)}</span>
        </>
      );
    },
  },
  {
    id: 'retention', title: 'Data retention', global: true, link: { to: '/admin/retention', label: 'Retention' },
    headline: (c) => {
      if (!c.oldestAt) return { big: '—', lab: 'no Blizzard data stored yet', delta: null };
      const ms = Date.now() - new Date(c.oldestAt).getTime();
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      return { big: `${d} d ${h} h`, lab: 'oldest Blizzard data', delta: null };
    },
    change: () => null,
    body: (c) => (
      <>
        <div>{c.outside.length ? <Chip kind="err">Outside the window: {c.outside.join(', ')}</Chip> : <Chip kind="ok">Within the {c.windowDays}-day window</Chip>}</div>
        <dl className="kvs">
          <dt>Deleted at</dt><dd>{c.keepDays} days</dd>
          <dt>Last sweep</dt><dd>{c.lastSweepAt ? `${timeAgo(c.lastSweepAt)} · ${c.lastSweepProblem ? 'with problems' : 'OK'}` : 'not yet'}</dd>
        </dl>
      </>
    ),
  },
  {
    id: 'backups', title: 'Backups', global: true, link: { to: '/admin/data/backups', label: 'Backups' },
    headline: (c) => {
      if (!c.lastSuccessAt) return { big: '—', lab: 'no good backup yet', delta: null };
      const h = Math.round((Date.now() - new Date(c.lastSuccessAt).getTime()) / 3_600_000);
      return { big: `${h} h`, lab: 'since the last good backup', delta: null };
    },
    change: (c) => (c.recent.length ? `${c.recent.filter((r) => r.outcome === 'ok').length} of ${c.recent.length} recent runs verified` : null),
    body: (c) => (
      <>
        <div>{c.running ? <Chip kind="run">Running now</Chip> : c.failing ? <Chip kind="err">Last attempt failed</Chip> : c.lastSuccessAt ? <Chip kind="ok">Verified</Chip> : <Chip kind="warn">None yet</Chip>}</div>
        <dl className="kvs">
          <dt>Size</dt><dd>{c.lastSuccessBytes !== null ? formatBytes(c.lastSuccessBytes) : '—'}</dd>
          <dt>File</dt><dd className="mono2">{c.lastSuccessFile ?? '—'}</dd>
        </dl>
      </>
    ),
  },
  {
    id: 'features', title: 'Features', wide: true, global: true, link: { to: '/admin/features', label: 'Features' },
    headline: (c) => ({ big: formatNumber(c.off.length), lab: c.off.length === 1 ? 'feature off right now' : 'features off right now', delta: null }),
    change: () => null,
    body: (c) => (
      <>
        <div className="row gap-6 wrap-row">
          {c.off.map((f) => <Chip key={f.id} kind="off">{f.name} · {f.on ? `waits on ${f.blockedBy.join(', ')}` : 'off'}</Chip>)}
          {c.lockedOff.length > 0 && <Chip kind="off" icon="lock">{c.lockedOff.map((f) => f.name).join(' · ')} · off until 0.11.0</Chip>}
        </div>
        <span className="muted xsmall">
          {c.off.some((f) => f.playerVisible) ? `Players see the fallback for: ${c.off.filter((f) => f.playerVisible).map((f) => f.name).join(', ')}.` : 'Nothing players see is switched off.'} The other {c.total - c.off.length} switches are on.
        </span>
      </>
    ),
  },
];

const DEFAULT_ORDER = CARDS.map((c) => c.id);

function Card({ def, card, all, range, editing = false, onHide = null, grip = null }) {
  const failed = card?.error;
  const head = !failed && card ? def.headline(card, all) : null;
  const change = !failed && card ? def.change(card, all) : null;
  return (
    <article className={`dcard${def.wide ? ' w' : ''}${failed ? ' is-error' : ''}`} aria-label={def.title} id={`card-${def.id}`}>
      <div className="hd">
        <h2>{def.title}</h2>
        <span className="spacer" />
        <ScopeChipFor global={def.global} />
        {editing && (
          <span className="edit">
            {grip}
            <button type="button" className="btn ghost sm icon" aria-label={`Hide ${def.title}`} onClick={onHide} data-no-drag=""><Icon name="eye-off" /></button>
          </span>
        )}
      </div>
      <div className="bd">
        {failed ? (
          <div className="perr" role="alert"><Icon name="error" /><span><b>This card couldn’t load.</b> {card.error}</span></div>
        ) : (
          <>
            <div className="head"><span className="big">{head.big}</span><span className="lab">{head.lab}</span><Delta n={head.delta} /></div>
            {!editing && def.body(card, all)}
          </>
        )}
      </div>
      {!editing && (
        <div className="ft">
          <span className="muted">{sinceText(range)}</span>
          {change ? <span className="t2">{change}</span> : <span className="muted">{range === 'launch' ? '—' : 'not measured'}</span>}
          <span className="spacer" />
          {def.link.label && <ScopedLink to={def.link.to}>{def.link.label} →</ScopedLink>}
        </div>
      )}
    </article>
  );
}

function ScopeChipFor({ global }) {
  const { versionName, region } = useScope();
  return <Chip kind="scope" icon="globe">{global ? 'All versions' : `${versionName.replace(/^WoW /, '')} · ${region.toUpperCase()}`}</Chip>;
}

export function DashboardPage() {
  const { apiQuery } = useScope();
  const info = useShellInfo();
  const [range, setRange] = useState('checked');
  const [editing, setEditing] = useState(false);
  const prefs = info.prefs ?? {};
  const [order, setOrder] = useState(() => {
    const saved = (prefs['dashboard.order'] ?? []).filter((id) => DEFAULT_ORDER.includes(id));
    return [...saved, ...DEFAULT_ORDER.filter((id) => !saved.includes(id))];
  });
  const [hidden, setHidden] = useState(() => (prefs['dashboard.hidden'] ?? []).filter((id) => DEFAULT_ORDER.includes(id)));
  const p = usePanel('dashboard', () => api(`/api/admin/dashboard?range=${range}&${apiQuery}`), [range, apiQuery]);
  const mark = useAction();

  const savePrefs = useCallback(async (nextOrder, nextHidden) => {
    await api('/api/admin/prefs/dashboard.order', { method: 'PUT', body: { value: nextOrder } });
    await api('/api/admin/prefs/dashboard.hidden', { method: 'PUT', body: { value: nextHidden } });
  }, []);
  const hide = (id) => {
    const next = [...hidden, id];
    setHidden(next);
    savePrefs(order, next);
  };
  const show = (id) => {
    const next = hidden.filter((x) => x !== id);
    setHidden(next);
    savePrefs(order, next);
  };
  const reset = () => {
    setOrder(DEFAULT_ORDER);
    setHidden([]);
    savePrefs(DEFAULT_ORDER, []);
  };

  const d = p.data;
  const visible = useMemo(() => order.filter((id) => !hidden.includes(id)).map((id) => CARDS.find((c) => c.id === id)), [order, hidden]);
  const checkedText = d?.checkedAt ? `Since I last checked · ${timeAgo(d.checkedAt)}` : 'Since I last checked · never';

  return (
    <>
      <PageHead title="Dashboard" desc={d?.checkedAt ? `Since you last checked, ${timeAgo(d.checkedAt)}. Cards scoped to a version follow the switcher; the rest say “All versions”.` : 'You haven’t marked anything as checked yet. Cards scoped to a version follow the switcher; the rest say “All versions”.'} />
      {d && (d.needs.length ? (
        <div className="needs" role="region" aria-label="Needs you">
          <span className="t"><Icon name="warning" />Needs you · {d.needs.length}</span>
          {d.needs.map((n) => (
            <ScopedLink key={n.text} className={`it ${n.tone}`} to={n.to}><Icon name={n.icon} />{n.n !== null && <b>{formatNumber(n.n)}</b>} {n.text}</ScopedLink>
          ))}
        </div>
      ) : (
        <div className="needs clear" role="region" aria-label="Needs you">
          <span className="t"><Icon name="check-circle" />All clear</span>
          <span className="m">No unread feedback or open reports, every catalog and backup is fine, the crawler is within budget and all data is inside the retention window.</span>
        </div>
      ))}
      {p.error && d && <div className="perr" role="alert"><Icon name="error" /><span><b>Couldn’t update the dashboard.</b> {errorWords(p.error)} The numbers below are from the last good load.</span><span className="spacer" /><button type="button" className="btn sm" onClick={p.reload}>Retry</button></div>}
      {p.error && !d && <div className="perr" role="alert"><Icon name="error" /><span><b>Couldn’t load the dashboard.</b> {errorWords(p.error)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={p.reload}>Retry</button></div>}
      <div className="dash-ctrl">
        <Segmented label="Period" options={RANGES.map((r) => ({ id: r.id, label: r.id === 'checked' ? checkedText : r.label }))} value={range} onChange={setRange} />
        <ActionButton action={mark} icon="check-circle" onRun={async () => {
          await api('/api/admin/activity/checked', { method: 'POST', body: { confirm: true } });
          setRange('checked');
          await p.reload();
        }} done="Marked: changes now count from here">Mark as checked</ActionButton>
        <ActionStatus action={mark} />
        <span className="spacer" />
        {editing && <button type="button" className="btn sm ghost" onClick={reset}>Reset layout</button>}
        <button type="button" className={`btn sm${editing ? ' gold' : ' ghost'}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          <Icon name={editing ? 'check' : 'grip'} />{editing ? 'Done' : 'Edit layout'}
        </button>
      </div>
      <div className={`dash-body${p.loading && d ? ' is-loading' : ''}`} aria-busy={p.loading || undefined}>
        {!d ? (
          <div className="dgrid" aria-hidden="true">{CARDS.map((c) => <article key={c.id} className={`dcard${c.wide ? ' w' : ''}`}><div className="hd"><h2>{c.title}</h2></div><div className="bd"><div className="ghostrows"><i /><i /><i /></div></div></article>)}</div>
        ) : editing ? (
          <>
            <p className="muted small">Drag the cards into the order you want, or hide them. Saved for you as you go.</p>
            <Sortable items={visible} idOf={(c) => c.id} labelOf={(c) => c.title} ariaLabel="Dashboard cards, in order" className="dgrid is-editing edit-list" itemClassName="edit-slot"
              onReorder={async (ids) => {
                const next = [...ids, ...order.filter((id) => !ids.includes(id))];
                setOrder(next);
                await savePrefs(next, hidden);
              }}
              renderItem={(def, { grip }) => <Card def={def} card={d.cards[def.id]} all={d.cards} range={range} editing grip={grip} onHide={() => hide(def.id)} />} />
            {hidden.length > 0 && (
              <div className="hiddentray" role="region" aria-label="Hidden cards">
                <span className="eyebrow">Hidden</span>
                {hidden.map((id) => {
                  const def = CARDS.find((c) => c.id === id);
                  return <button key={id} type="button" className="btn sm" onClick={() => show(id)}><Icon name="eye" />Show {def.title}</button>;
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="dgrid">{visible.map((def) => <Card key={def.id} def={def} card={d.cards[def.id]} all={d.cards} range={range} />)}</div>
            {hidden.length > 0 && <p className="muted small">{hidden.length} card{hidden.length === 1 ? '' : 's'} hidden · <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Edit layout</button> to show {hidden.length === 1 ? 'it' : 'them'}.</p>}
          </>
        )}
      </div>
      {d && <p className="muted xsmall">Counted {timeAgo(d.now)} from Everstats’ database. Searches are counted from 0.7.1 on; characters and guilds count what is stored now (Blizzard data older than the retention window has been deleted).</p>}
    </>
  );
}
