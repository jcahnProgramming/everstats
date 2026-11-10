import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Segmented, Tabs, Toggle } from '../../components/Controls.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { Panel, errorWords, usePanel } from '../shell/refresh.jsx';
import { ActionButton, ActionStatus, Chip, Empty, PageHead, ScopeChip, ScopedLink, useAction, useHit } from '../shell/parts.jsx';
import { useScope, useShellInfo } from '../shell/scope.jsx';
import './gamedata.css';

/**
 * Discovery (0.10.3, design/v5-admin pages/discovery): three tab pages that follow the top bar's version + region.
 *   /admin/discovery/approvals   the combined catalog of every finished run, its suggestions and the owner's decisions
 *                                (keeps ?stat=ID deep links: the old /admin/discovery?stat=ID redirects here with them)
 *   /admin/discovery/runs        queue a discovery run, the run list and a run's details (answers, endpoints, catalog,
 *                                suggestions, raw responses, exports), Re-analyse / Re-analyse all, the Battle.net grant
 *   /admin/discovery/probe       queue / stop endpoint probes, their results and exports, and the endpoint probe matrix
 *                                across game versions (each version's newest finished probe, from stored summaries)
 * Moved from 0.4.0–0.10.0's DiscoveryPage + ProbeSection. The rules are unchanged (CLAUDE.md "Discovery", "Endpoint
 * probe"): only the UI moved. The design drew Runs and Probe as panels on Approvals; the owner wanted them as their own
 * tab pages. Tier GROUP decisions moved to Tiers (where the design draws them). 0.10.0's version pickers are gone: the
 * switcher chooses the version, and a version that is off ("Off · admin only") is viewable like any other.
 *
 * Every action shows working → done → result in place (useAction). Runs in flight are followed on a short own clock
 * (3 s) ONLY while one is queued or running; otherwise the page is refreshed by the shell like every other.
 */
const TABS = [
  { to: '/admin/discovery/approvals', label: 'Approvals' },
  { to: '/admin/discovery/runs', label: 'Runs' },
  { to: '/admin/discovery/probe', label: 'Endpoint probe' },
];
const AUTH_ERRORS = {
  cancelled: 'Battle.net authorization was cancelled.',
  state_mismatch: 'That authorization didn’t match the one this page started. Try again.',
  not_configured: 'The Blizzard keys aren’t configured.',
  provider_failed: 'Battle.net didn’t complete the authorization. Try again.',
};
const RUN_KIND = { queued: 'info', running: 'run', done: 'ok', failed: 'err', interrupted: 'warn', stopped: 'warn' };
const statusKind = (code) => (code === 'no answer' || code === null || code === undefined ? 'err' : Number(code) < 300 ? 'ok' : Number(code) === 404 ? 'warn' : 'err');
const ms = (v) => (Number.isFinite(v) ? `${formatNumber(v)} ms` : '—');
const duration = (v) => (Number.isFinite(v) ? (v < 120_000 ? `${Math.round(v / 1000)} s` : `${Math.round(v / 60_000)} min`) : '—');
const tallyText = (o) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${formatNumber(n)}`).join(' · ') || 'none';
const isProbe = (run) => run?.options?.kind === 'probe';

function DiscoveryHead({ approvals = null }) {
  return (
    <PageHead
      title="Discovery"
      chips={<ScopeChip />}
      desc="What Blizzard’s API really returns, from real characters: statistics to approve before they reach tiers, the runs that found them, and every endpoint probed per game version. Blizzard data here follows the 30-day rule; your decisions stay."
      tabs={TABS.map((t, i) => (i === 0 && approvals ? { ...t, count: approvals } : t))}
    />
  );
}

function RetentionNote() {
  return (
    <div className="note small"><Icon name="info" /><span>Blizzard’s API terms allow keeping its data for at most 30 days, so runs, their raw responses and the catalog built from them are deleted once they’re older than the retention window (Data retention). Your decisions stay; the Blizzard text quoted in their reasoning goes with the run. Exports you download are copies of Blizzard data too: delete them within 30 days.</span></div>
  );
}

/** A sub-view's own load (a run's catalog, its responses): loading, error with Retry, or the data. */
function useLoad(url) {
  const [state, setState] = useState({ data: undefined, error: null, n: 0 });
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: undefined, error: null, n: s.n }));
    api(url).then((data) => {
      if (live) setState((s) => ({ ...s, data, error: null }));
    }, (error) => {
      if (live) setState((s) => ({ ...s, data: undefined, error }));
    });
    return () => {
      live = false;
    };
  }, [url, state.n]);
  const retry = useCallback(() => setState((s) => ({ ...s, n: s.n + 1 })), []);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, retry, setData };
}

function Loaded({ load, label, children }) {
  if (load.error) {
    return (
      <div className="perr" role="alert"><Icon name="error" /><span><b>Couldn’t load {label}.</b> {errorWords(load.error)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={load.retry}><Icon name="refresh" size="sm" />Retry</button></div>
    );
  }
  if (load.data === undefined) return <div className="ghostrows" aria-hidden="true"><i /><i /><i /></div>;
  return children(load.data);
}

function Q({ title, children }) {
  return <div className="gd-q"><h3>{title}</h3>{children}</div>;
}

function Figure({ label, value, note }) {
  return <div className="kpi"><span className="l">{label}</span><span className="v">{value}</span><span className="d">{note}</span></div>;
}

// ===================================================================================================== Approvals
export function DiscoveryApprovalsPage() {
  const { version, versionName, apiQuery } = useScope();
  const info = useShellInfo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Battle.net's authorization returns to /admin/discovery?authorized=1 (or ?error=), which redirects here: the
  // authorization lives on Runs, so carry the answer on there.
  useEffect(() => {
    if (params.get('authorized') || params.get('error')) navigate(`/admin/discovery/runs?${params.toString()}`, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(params.get('stat'));
  const focusStat = Number.isSafeInteger(n) && n > 0 ? n : null;
  const unfocus = () => setParams((p) => {
    const out = new URLSearchParams(p);
    out.delete('stat');
    return out;
  });
  const cat = usePanel(`discovery-catalog:${version}`, () => api(`/api/admin/discovery/catalog?${apiQuery}`), [apiQuery]);
  useHit(cat.data);
  const pending = useMemo(() => (cat.data?.catalog ?? []).filter((s) => s.suggestions.some((x) => x.value !== null && !x.decision)).length, [cat.data]);
  const replace = (stat) => cat.setData((d) => ({ ...d, catalog: d.catalog.map((s) => (s.statisticId === stat.statisticId ? stat : s)) }));
  const isPrimary = version === (info.primary ?? 'forever');
  return (
    <>
      <DiscoveryHead approvals={pending || null} />
      <Panel panel={cat} title="Combined catalog" id="discovery-combined"
        actions={cat.data?.catalog?.length ? <a className="btn sm" href={`/api/admin/discovery/catalog/export.csv?version=${encodeURIComponent(version)}`} download><Icon name="download" size="sm" />Catalog CSV</a> : null}>
        {(d) => (d.combined ? (
          <dl className="kvs">
            <dt>Built from</dt><dd>runs {d.combined.runs.map((id) => `#${id}`).join(', ')} · {formatNumber(d.combined.characters)} characters</dd>
            <dt>Analysed</dt><dd>{formatDateTime(d.combined.analysedAt)} with v{d.combined.analysedWith}</dd>
            <dt>Rulesets sampled</dt><dd>{tallyText(d.combined.rulesets)}</dd>
            <dt>Factions sampled</dt><dd>{tallyText(d.combined.factions)}</dd>
            <dt>Statistics</dt><dd>{formatNumber(d.catalog.length)} ({formatNumber(d.catalog.filter((s) => s.fromProduction).length)} seen only by the production crawler)</dd>
          </dl>
        ) : isPrimary ? (
          <Empty icon="info" title="Not built yet" action={<Link className="btn sm" to="/admin/discovery/runs">Runs › Re-analyse all runs</Link>}>
            {d.catalog.length ? `${formatNumber(d.catalog.length)} statistics seen by the production crawler are listed below. ` : ''}Re-analyse all runs to combine every finished run’s statistics here, from the responses already stored.
          </Empty>
        ) : (
          <Empty icon="no-coverage" title={`No discovery runs on ${versionName}`}>
            Discovery runs read WoW Forever characters by name and surname, so the combined catalog is WoW Forever’s. {d.catalog.length ? `${formatNumber(d.catalog.length)} ${versionName} statistics seen by the crawler are listed below.` : `${versionName} statistics appear here once Everstats crawls them.`} The Endpoint probe compares this version’s statistics with Forever’s.
          </Empty>
        ))}
      </Panel>
      <Panel panel={cat} title="Waiting for approval" id="discovery-suggestions" flush sub={pending ? <Chip kind="info">{formatNumber(pending)} to decide</Chip> : null}
        footer={<span>Suggestions, not decisions: each says why, and nothing is applied until you approve it. Tier group decisions are on <ScopedLink to="/admin/tiers#tier-groups">Tiers</ScopedLink>.</span>}>
        {(d) => <Suggestions catalog={d.catalog} runId={null} version={version} focusStat={focusStat} onUnfocus={unfocus} onChanged={replace} />}
      </Panel>
      <Panel panel={cat} title="Catalog" id="discovery-catalog" flush>
        {(d) => <Catalog catalog={d.catalog} combined />}
      </Panel>
      <RetentionNote />
    </>
  );
}

// Must match server/discovery/analyze.js VALUE_TYPES (the server refuses anything else).
const VALUE_TYPES = ['count', 'name-and-number', 'highest-ever', 'rate', 'time', 'gold', 'distance', 'decimal', 'text'];
const typeLabel = (t) => ({ 'name-and-number': 'name + number' }[t] ?? t);
const catPath = (s) => s.categoryPath.map((c) => c.name).join(' › ');
const KIND_LABEL = { category: 'Category', grading: 'Counts toward', leaderboard: 'Leaderboard', duplicate: 'Duplicate' };
const GRADING_LABEL = { overall: 'its category tier and the overall tier', category: 'its category tier only (not the overall tier)', none: 'no tier: leaderboard only' };
const valueLabel = (s, nameOf) => {
  if (s.value === null) return 'Unknown';
  if (s.kind === 'category') return s.value;
  if (s.kind === 'grading') return GRADING_LABEL[s.value] ?? String(s.value);
  if (s.kind === 'duplicate') return `${s.stale ? 'approved' : s.evidence?.confidence === 'likely' ? 'likely' : 'possible'} duplicate of “${nameOf(s.value.of) ?? `id ${s.value.of}`}”`;
  return s.value ? 'Yes' : 'No';
};
const VIEWS = [
  { id: 'pending', label: 'To decide' },
  { id: 'duplicates', label: 'Possible duplicates' },
  { id: 'types', label: 'Guessed types' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'unknown', label: 'Unknown' },
  { id: 'all', label: 'All' },
];
const inView = (view) => (s) => {
  if (view === 'all') return true;
  if (view === 'types') return false; // that view shows each row's value type, not its suggestions
  if (view === 'duplicates') return s.kind === 'duplicate';
  if (view === 'unknown') return s.value === null;
  if (view === 'pending') return s.value !== null && !s.decision;
  return s.decision === view;
};

function TypeChip({ stat }) {
  return (
    <span className="gd-row">
      <span className="chip" title={stat.valueTypeBasis}>{typeLabel(stat.valueType)}</span>
      {stat.valueTypeGuessed ? <Chip kind="warn" title={stat.valueTypeBasis}>guessed</Chip> : stat.valueTypeSetBy === 'admin' ? <Chip kind="ok" title={stat.valueTypeBasis}>set by you</Chip> : null}
    </span>
  );
}

/**
 * Suggestions for a catalog (the combined one, runId null, or one run's). Decisions belong to the statistic, so the same
 * decision shows in every view. A row acted on stays in view (with its new state) until the view changes, so the
 * result of the click is seen where it was made.
 */
function Suggestions({ catalog, runId, version, focusStat = null, onUnfocus = null, onChanged }) {
  const [view, setView] = useState(focusStat ? 'all' : 'pending');
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(50);
  const [touched, setTouched] = useState(() => new Set());
  useEffect(() => {
    if (focusStat) setView('all');
  }, [focusStat]);
  const names = useMemo(() => new Map(catalog.map((s) => [s.statisticId, s.name])), [catalog]);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return catalog
      .filter((s) => focusStat === null || s.statisticId === focusStat)
      .filter((s) => !f || s.name?.toLowerCase().includes(f) || catPath(s).toLowerCase().includes(f) || String(s.statisticId) === f)
      .map((s) => ({ ...s, visible: touched.has(s.statisticId) && view !== 'types' ? s.suggestions : s.suggestions.filter(inView(view)) }))
      .filter((s) => touched.has(s.statisticId) || (view === 'types' ? s.valueTypeGuessed : s.visible.length));
  }, [catalog, view, focusStat, filter, touched]);
  const changeView = (v) => {
    setView(v);
    setShown(50);
    setTouched(new Set());
  };
  const changed = (stat) => {
    setTouched((t) => new Set(t).add(stat.statisticId));
    onChanged(stat);
  };
  return (
    <>
      {focusStat !== null && (
        <div className="tbar" role="status"><Icon name="filter" /><span className="gd-fill small">Showing statistic id {focusStat} only (from a link: Tiers › What counts, or the audit log).</span>{onUnfocus && <button type="button" className="btn sm ghost" onClick={onUnfocus}>Show every statistic</button>}</div>
      )}
      <div className="tbar">
        <input className="inp search" type="search" placeholder="Filter by name, category or id" aria-label="Filter suggestions" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(50); }} />
        <Segmented options={VIEWS} value={view} onChange={changeView} label="Which suggestions" />
        <span className="spacer" />
        <span className="cnt">{formatNumber(rows.length)} statistic{rows.length === 1 ? '' : 's'}</span>
      </div>
      {view === 'types' && <div className="tbar"><span className="gd-note">Every statistic whose value type is still a guess. Confirm it or choose another; your choice replaces the guess from then on.</span></div>}
      {rows.length === 0 ? <Empty icon="check-circle" title="Nothing in this view" /> : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th scope="col">Statistic</th><th scope="col">Seen</th><th scope="col">Suggestions and decisions</th></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((s) => <SuggestionRow key={s.statisticId} runId={runId} version={version} stat={s} nameOf={(id) => names.get(id)} showType={view === 'types' || view === 'all'} onChanged={changed} />)}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <div className="pager"><span>{formatNumber(shown)} of {formatNumber(rows.length)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={() => setShown((x) => x + 50)}>Show {formatNumber(Math.min(50, rows.length - shown))} more</button></div>}
    </>
  );
}

function SuggestionRow({ runId, version, stat, nameOf, showType, onChanged }) {
  const action = useAction();
  const [busyKey, setBusyKey] = useState(null);
  const decide = (kind, decision, value) => {
    setBusyKey(`${kind}|${decision}`);
    return action.run(async () => {
      const body = { ...(runId === null ? { combined: true } : { runId }), version, statisticId: stat.statisticId, kind, decision, ...(value !== undefined ? { value } : {}) };
      const { statistic } = await api('/api/admin/discovery/decisions', { method: 'PUT', body });
      onChanged(statistic);
      return statistic;
    }, {
      working: 'Saving…',
      done: () => `${kind === 'value_type' ? 'Value type' : KIND_LABEL[kind]} ${decision === 'cleared' ? 'undone' : decision}${decision === 'cleared' ? '' : ' · a grading follows'}`,
    }).finally(() => setBusyKey(null));
  };
  const btn = (key) => `btn sm${busyKey === key ? ' is-loading' : ''}`;
  return (
    <tr id={`stat-${stat.statisticId}`}>
      <td className="dtl" data-label="">
        <b>{stat.name ?? 'Name no longer available'}</b>
        <span className="sub mono">id {stat.statisticId}</span>
        <span className="sub">{catPath(stat) || 'no category'}</span>
      </td>
      <td className="t2" data-label="Seen">
        <span className="num">{formatNumber(stat.charactersNonzero)} non-zero · max {formatNumber(stat.maxValue)}</span>
        <span className="sub">{runId === null ? (stat.fromProduction ? 'production crawler only' : `runs ${stat.runs.map((id) => `#${id}`).join(' ')}`) : `${stat.charactersPresent} of ${stat.charactersSampled} have it`}</span>
      </td>
      <td data-label="Suggestions">
        <div className="gd-stack">
          {showType && <ValueTypeRow stat={stat} busyKey={busyKey} onSet={(value) => decide('value_type', 'approved', value)} onClear={() => decide('value_type', 'cleared')} />}
          {stat.visible.map((s) => (
            <div key={s.kind} className="gd-sug">
              <div className="gd-fill">
                <span className="small"><span className="muted">{KIND_LABEL[s.kind]}:</span> <b>{valueLabel(s, nameOf)}</b> {s.decision && <Chip kind={s.decision === 'approved' ? 'ok' : 'err'}>{s.decision}</Chip>} {s.stale && <Chip kind="warn">no longer supported</Chip>}</span>
                <span className="t2 xsmall">{s.reasoning}</span>
              </div>
              <div className="act">
                {s.value !== null && !s.decision && (
                  <>
                    <button type="button" className={btn(`${s.kind}|rejected`)} disabled={action.busy} onClick={() => decide(s.kind, 'rejected')}><Icon name="close" size="sm" />Reject</button>
                    <button type="button" className={`${btn(`${s.kind}|approved`)} gold`} disabled={action.busy} onClick={() => decide(s.kind, 'approved')}><Icon name="check" size="sm" />Approve</button>
                  </>
                )}
                {s.decision && <button type="button" className={`${btn(`${s.kind}|cleared`)} ghost`} disabled={action.busy} onClick={() => decide(s.kind, 'cleared')}>Undo</button>}
              </div>
            </div>
          ))}
          <ActionStatus action={action} />
        </div>
      </td>
    </tr>
  );
}

/** The statistic's value type: the analysis's guess, or the admin's choice, which persists across re-analyses. */
function ValueTypeRow({ stat, busyKey, onSet, onClear }) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(stat.valueType);
  return (
    <div className="gd-sug">
      <div className="gd-fill">
        <span className="small gd-row"><span className="muted">Value type:</span> <TypeChip stat={stat} /></span>
        <span className="t2 xsmall">{stat.valueTypeBasis}</span>
        {editing && (
          <div className="gd-stack">
            <Segmented options={VALUE_TYPES.map((t) => ({ id: t, label: typeLabel(t) }))} value={choice} onChange={setChoice} label={`Value type for ${stat.name}`} />
            <div className="gd-row">
              <button type="button" className={`btn sm${busyKey === 'value_type|approved' ? ' is-loading' : ''}`} onClick={async () => { await onSet(choice); setEditing(false); }}><Icon name="check" size="sm" />{choice === stat.valueType ? 'Confirm' : 'Save'}</button>
              <button type="button" className="btn sm ghost" onClick={() => { setChoice(stat.valueType); setEditing(false); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {!editing && (
        <div className="act">
          {stat.valueTypeGuessed && <button type="button" className={`btn sm${busyKey === 'value_type|approved' ? ' is-loading' : ''}`} onClick={() => onSet(stat.valueType)}><Icon name="check" size="sm" />Confirm</button>}
          <button type="button" className="btn sm ghost" onClick={() => { setChoice(stat.valueType); setEditing(true); }}>Change</button>
          {stat.valueTypeSetBy === 'admin' && <button type="button" className={`btn sm ghost${busyKey === 'value_type|cleared' ? ' is-loading' : ''}`} onClick={onClear}>Undo</button>}
        </div>
      )}
    </div>
  );
}

const SORTS = {
  id: (s) => s.statisticId,
  name: (s) => (s.name ?? '').toLowerCase(),
  category: (s) => catPath(s).toLowerCase(),
  type: (s) => s.valueType,
  present: (s) => s.charactersPresent,
  nonzero: (s) => s.charactersNonzero,
  max: (s) => s.maxValue ?? -Infinity,
};
const PAGE = 200;

function Catalog({ catalog, combined = false }) {
  const [sort, setSort] = useState({ key: 'category', dir: 1 });
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const key = SORTS[sort.key];
    return catalog
      .filter((s) => !f || (s.name ?? '').toLowerCase().includes(f) || catPath(s).toLowerCase().includes(f) || String(s.statisticId) === f)
      .sort((a, b) => (key(a) < key(b) ? -sort.dir : key(a) > key(b) ? sort.dir : a.statisticId - b.statisticId));
  }, [catalog, filter, sort]);
  if (catalog.length === 0) return <Empty icon="info" title="No statistics here">No catalog endpoint answered with anything shaped like a statistic.</Empty>;
  const th = (key, label, r = false) => (
    <th scope="col" className={r ? 'r' : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>{label}{sort.key === key && <Icon name={sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size="sm" />}</button>
    </th>
  );
  return (
    <>
      <div className="tbar">
        <input className="inp search" type="search" placeholder="Filter by name, category or id" aria-label="Filter the catalog" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }} />
        <span className="spacer" />
        <span className="cnt">{formatNumber(rows.length)} of {formatNumber(catalog.length)} statistics</span>
      </div>
      <div className="tbar"><span className="gd-note">A type marked “guessed” comes from the name, or is the default; correct it under Guessed types (hover a type for its basis). “Has it” counts sampled characters whose response listed the statistic; “Non-zero” those above zero.{combined ? ' A character sampled by more than one run counts once, with its newest values.' : ''}</span></div>
      <div className="dt-wrap">
        <table className="dt">
          <thead><tr>{th('id', 'Id')}{th('name', 'Statistic')}{th('category', 'Blizzard category')}{th('type', 'Type')}{combined && <th scope="col">Runs</th>}{th('present', 'Has it', true)}{th('nonzero', 'Non-zero', true)}<th scope="col" className="r">Min · median</th>{th('max', 'Max', true)}</tr></thead>
          <tbody>
            {rows.slice(0, shown).map((s) => (
              <tr key={s.statisticId}>
                <td className="mono" data-label="Id">{s.statisticId}</td>
                <td className="dtl" data-label=""><b>{s.name ?? 'Name no longer available'}</b></td>
                <td className="t2" data-label="Blizzard category">{catPath(s) || '—'}</td>
                <td data-label="Type"><TypeChip stat={s} /></td>
                {combined && <td className="mono" data-label="Runs">{s.fromProduction ? 'production' : s.runs.map((id) => `#${id}`).join(' ')}</td>}
                <td className="r num" data-label="Has it">{s.charactersPresent} / {s.charactersSampled}</td>
                <td className="r num" data-label="Non-zero">{s.charactersNonzero}</td>
                <td className="r num t2" data-label="Min · median">{formatNumber(s.minValue)} · {formatNumber(s.medianValue)}</td>
                <td className="r num" data-label="Max">{formatNumber(s.maxValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <div className="pager"><span>{formatNumber(shown)} of {formatNumber(rows.length)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={() => setShown((n) => n + PAGE)}>Show {formatNumber(Math.min(PAGE, rows.length - shown))} more</button></div>}
    </>
  );
}

// ===================================================================================================== Runs
/** The run list of one kind on this version + region, polled on a 3 s clock only while a run is in flight anywhere. */
function useRunList(kind) {
  const { version, region, apiQuery } = useScope();
  const [inFlight, setInFlight] = useState(false);
  const list = usePanel(`discovery-${kind}:${version}:${region}`, () => api(`/api/admin/discovery?${apiQuery}&kind=${kind}&limit=25`), [apiQuery, kind], { everyMs: inFlight ? 3000 : 0 });
  useEffect(() => {
    setInFlight(Boolean(list.data?.active));
  }, [list.data]);
  const [older, setOlder] = useState({ runs: [], next: undefined });
  useEffect(() => {
    setOlder({ runs: [], next: undefined });
  }, [apiQuery]);
  const next = older.next === undefined ? list.data?.nextBefore ?? null : older.next;
  const more = useAction();
  const loadOlder = () => more.run(async () => {
    const r = await api(`/api/admin/discovery?${apiQuery}&kind=${kind}&limit=25&before=${next}`);
    setOlder((o) => ({ runs: [...o.runs, ...r.runs], next: r.nextBefore }));
    return r;
  }, { working: 'Loading…', done: (r) => `${formatNumber(r.runs.length)} older run${r.runs.length === 1 ? '' : 's'} added` });
  const runs = [...(list.data?.runs ?? []), ...older.runs.filter((o) => !(list.data?.runs ?? []).some((r) => r.id === o.id))];
  return { list, runs, next, loadOlder, more, inFlight };
}

/** The selected run lives in the address (?run=ID), so a link or a reload opens it again. */
function useSelectedRun(runs) {
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('run'));
  const selected = Number.isSafeInteger(asked) && asked > 0 ? asked : runs[0]?.id ?? null;
  const select = (id) => setParams((p) => {
    const out = new URLSearchParams(p);
    out.set('run', String(id));
    return out;
  }, { replace: true });
  return [selected, select];
}

/** Says which run is in flight (one at a time across every version and kind) when it isn't one on this list. */
function ActiveElsewhere({ active, kind }) {
  const { version, region } = useScope();
  if (!active) return null;
  if (active.version === version && active.region === region && (isProbe(active) ? 'probe' : 'discovery') === kind) return null;
  return <Chip kind="run">{isProbe(active) ? 'Probe' : 'Run'} #{active.id} ({active.version}, {String(active.region).toUpperCase()}) is {active.status}: one run at a time</Chip>;
}

export function DiscoveryRunsPage() {
  const { version, versionName } = useScope();
  const info = useShellInfo();
  const isPrimary = version === (info.primary ?? 'forever');
  const [params, setParams] = useSearchParams();
  // Battle.net's answer after "Authorize": shown once, then taken out of the address.
  const [notice] = useState(() => {
    if (params.get('authorized') === '1') return { ok: true, text: 'Battle.net authorized for discovery.' };
    if (params.get('error')) return { ok: false, text: AUTH_ERRORS[params.get('error')] ?? 'Battle.net authorization didn’t complete.' };
    return null;
  });
  useEffect(() => {
    if (params.get('authorized') || params.get('error')) {
      setParams((p) => {
        const out = new URLSearchParams(p);
        out.delete('authorized');
        out.delete('error');
        return out;
      }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { list, runs, next, loadOlder, more } = useRunList('discovery');
  const [selected, select] = useSelectedRun(runs);
  const reanalyseAll = useAction();
  useHit(list.data);
  const listed = runs.find((r) => r.id === selected) ?? null;
  return (
    <>
      <DiscoveryHead />
      {notice && <div className={`note ${notice.ok ? 'ok' : 'err'} small`} role="status"><Icon name={notice.ok ? 'check' : 'error'} /><span>{notice.text}</span></div>}
      {list.data && !list.data.configured && (
        <div className="note warn small" role="alert"><Icon name="warning" /><span>The Blizzard API keys aren’t set. Enter them in <Link to="/admin/settings#keys">Settings › API keys</Link> first.</span></div>
      )}
      <div className="cols2">
        <AuthorizePanel list={list} />
        <RunFormPanel list={list} isPrimary={isPrimary} versionName={versionName} onQueued={(run) => { select(run.id); list.reload(); }} />
      </div>
      <Panel panel={list} title="Runs" id="discovery-runs" flush
        sub={<ActiveElsewhere active={list.data?.active} kind="discovery" />}
        live={list.data?.active ? `Following run #${list.data.active.id} · own 3 s clock` : null}
        actions={(
          <>
            <ActionStatus action={reanalyseAll} />
            <ActionButton action={reanalyseAll} className="btn sm ghost" icon="sync" working="Re-analysing every run…"
              title="Re-analyse every finished run (discovery runs and probes) with the current rules, from the stored responses, then rebuild the combined catalog. Asks Blizzard nothing."
              onRun={async () => {
                const r = await api('/api/admin/discovery/reanalyse', { method: 'POST', body: {} });
                list.reload();
                return r;
              }}
              done={(r) => `Re-analysed · combined ${formatNumber(r.combined?.runs?.length ?? 0)} run${r.combined?.runs?.length === 1 ? '' : 's'}, ${formatNumber(r.combined?.catalogSize ?? 0)} statistics · your decisions still apply`}>Re-analyse all runs</ActionButton>
          </>
        )}>
        {() => (runs.length === 0 ? (
          <Empty icon="discovery" title={isPrimary ? 'No discovery run yet' : `No discovery runs on ${versionName}`}>{isPrimary ? 'Enter the primary character above and press Run discovery.' : 'Discovery runs ask WoW Forever. Use the Endpoint probe for this version.'}</Empty>
        ) : (
          <>
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">Run</th><th scope="col">Asked</th><th scope="col">Status</th><th scope="col">Primary</th><th scope="col" className="r num">Requests</th><th scope="col" className="r num">Statistics</th><th scope="col" className="r">Took</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={r.status === 'failed' || r.status === 'interrupted' ? 'is-fail' : r.id === selected ? 'is-sel' : undefined}>
                      <td className="dtl mono" data-label=""><b>#{r.id}</b></td>
                      <td className="t2 nw" data-label="Asked">{formatDateTime(r.requestedAt)}</td>
                      <td data-label="Status"><Chip kind={RUN_KIND[r.status] ?? 'info'}>{r.status}</Chip></td>
                      <td data-label="Primary">{r.options?.primary ? `${r.options.primary.name} ${r.options.primary.surname}` : '—'}</td>
                      <td className="r num" data-label="Requests">{formatNumber(r.requests ?? r.progress?.requests)}</td>
                      <td className="r num" data-label="Statistics">{formatNumber(r.catalogSize)}</td>
                      <td className="r num t2" data-label="Took">{duration(r.wallMs)}</td>
                      <td data-label=""><div className="act"><button type="button" className="btn sm ghost" aria-pressed={r.id === selected} onClick={() => select(r.id)}>{r.id === selected ? 'Shown' : 'Show'}</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {next !== null && <div className="pager"><ActionStatus action={more} /><span className="spacer" /><ActionButton action={more} className="btn sm" onRun={loadOlder}>Older runs</ActionButton></div>}
          </>
        ))}
      </Panel>
      {selected && listed && <RunDetail key={selected} runId={selected} listed={listed} onChanged={list.reload} />}
      <RetentionNote />
    </>
  );
}

function AuthorizePanel({ list }) {
  const go = useAction();
  const forget = useAction();
  return (
    <Panel panel={list} title="Battle.net authorization" id="discovery-grant" sub={list.data ? <Chip kind={list.data.grant ? 'ok' : 'off'}>{list.data.grant ? 'Authorized' : 'Not authorized'}</Chip> : null}>
      {(d) => (
        <>
          <p className="t2 small">Reading your own characters (<span className="mono">/profile/user/wow</span>) needs a Battle.net token of yours. Your Everstats sign-in doesn’t keep one, so discovery asks for its own here. It is stored encrypted, used only by discovery runs and probes, never shown, and deleted when Battle.net expires it (about a day).</p>
          {d.grant && (
            <dl className="kvs">
              <dt>BattleTag</dt><dd>{d.grant.battletag || '—'}</dd>
              <dt>Authorized</dt><dd>{formatDateTime(d.grant.createdAt)}</dd>
              <dt>Expires</dt><dd>{formatDateTime(d.grant.expiresAt)}</dd>
              <dt>Scope</dt><dd className="mono2">{d.grant.scope || '—'}</dd>
            </dl>
          )}
          <div className="gd-row">
            <ActionButton action={go} className={`btn sm${d.grant ? '' : ' gold'}`} icon="provider-account" disabled={!d.configured} working="Opening Battle.net…"
              onRun={async () => {
                const { url } = await api('/api/admin/discovery/authorize', { method: 'POST', body: {} });
                window.location.assign(url);
                return url;
              }} done="Opening Battle.net…">{d.grant ? 'Authorize again' : 'Authorize with Battle.net'}</ActionButton>
            {d.grant && (
              <ActionButton action={forget} className="btn sm ghost" working="Forgetting…" onRun={async () => {
                await api('/api/admin/discovery/grant', { method: 'DELETE' });
                list.reload();
              }} done="Token forgotten">Forget token</ActionButton>
            )}
            <ActionStatus action={go.phase === 'failed' ? go : forget} />
          </div>
        </>
      )}
    </Panel>
  );
}

function RunFormPanel({ list, isPrimary, versionName, onQueued }) {
  const queue = useAction();
  const [form, setForm] = useState(null); // null until the list has loaded: then prefilled from the last run
  const d = list.data;
  useEffect(() => {
    if (d && form === null) {
      const last = d.runs.find((r) => !isProbe(r))?.options?.primary;
      setForm({ name: last?.name ?? '', surname: last?.surname ?? '', account: true, guild: true });
    }
  }, [d, form]);
  const f = form ?? { name: '', surname: '', account: true, guild: true };
  const set = (k) => (v) => setForm((x) => ({ ...(x ?? f), [k]: v }));
  const start = (e) => {
    e.preventDefault();
    queue.run(async () => {
      const { run } = await api('/api/admin/discovery/runs', { method: 'POST', body: f });
      onQueued(run);
      return run;
    }, { working: 'Queueing…', done: (run) => `Run #${run.id} queued · the worker starts it within about 30 s` });
  };
  return (
    <Panel panel={list} title="Run discovery" id="discovery-run-form">
      {(data) => (!isPrimary ? (
        <Empty icon="no-coverage" title={`Discovery runs ask WoW Forever only`}>They read Forever characters by name and surname, and their statistics become Forever’s catalog. To see what {versionName} answers, use the Endpoint probe.</Empty>
      ) : (
        <form className="gd-stack" onSubmit={start}>
          <div className="gd-row">
            <label className="field gd-fill"><span className="lab">Primary character: name</span><input className="inp" value={f.name} onChange={(e) => set('name')(e.target.value)} autoComplete="off" /></label>
            <label className="field gd-fill"><span className="lab">Surname</span><input className="inp" value={f.surname} onChange={(e) => set('surname')(e.target.value)} autoComplete="off" /></label>
          </div>
          <Toggle checked={f.account} onChange={set('account')}><span className="small">Every character on the authorized Battle.net account{!data.grant && f.account ? ' (not authorized: this step will be skipped, and the run will say so)' : ''}</span></Toggle>
          <Toggle checked={f.guild} onChange={set('guild')}><span className="small">The primary character’s guild, and its roster as more samples</span></Toggle>
          <div className="gd-row">
            <button type="submit" className={`btn gold${queue.busy ? ' is-loading' : ''}`} disabled={queue.busy || Boolean(data.active) || !data.configured}><Icon name="play" size="sm" />Run discovery</button>
            <ActionStatus action={queue} />
            {data.active && <span className="t2 small">{isProbe(data.active) ? 'Probe' : 'Run'} #{data.active.id} is {data.active.status === 'queued' ? 'waiting for the worker' : `running: ${data.active.progress?.phase ?? '…'}`}.</span>}
          </div>
          {data.settings.length > 0 && (
            <div className="setgroup">
              {data.settings.map((s) => (
                <div key={s.key} className="srow ro" id={`set-${s.key}`}>
                  <div className="k"><b>{s.label}</b><span>{s.help}</span><code>{s.key}</code></div>
                  <div className="v"><span className="num">{formatNumber(s.value)}</span><Link className="small" to={`/admin/settings#set-${s.key}`}>Change in Settings</Link></div>
                  <span className={`d${s.value === s.default ? '' : ' changed'}`}>{s.value === s.default ? `Default ${formatNumber(s.default)}` : `Changed · default ${formatNumber(s.default)}`}</span>
                </div>
              ))}
            </div>
          )}
        </form>
      ))}
    </Panel>
  );
}

/** One discovery run: progress while it runs, then its answers, endpoints, catalog, suggestions and raw responses. */
function RunDetail({ runId, listed, onChanged }) {
  const { version } = useScope();
  const detail = usePanel(`discovery-run:${runId}`, () => api(`/api/admin/discovery/runs/${runId}`), [runId, listed?.status]);
  const [tab, setTab] = useState('overview');
  const [round, setRound] = useState(0); // bumps after a re-analysis: the catalog tabs load afresh
  const reanalyse = useAction();
  const run = detail.data?.run;
  const status = listed?.status ?? run?.status;
  return (
    <Panel panel={detail} title={`Run #${runId}`} id="discovery-run-detail"
      sub={run?.summary ? <span className="muted xsmall">{run.options.primary.name} {run.options.primary.surname} · finished {formatDateTime(run.finishedAt)} · analysed {run.summary.analysedWith ? `with v${run.summary.analysedWith}` : 'by v0.3.0'}</span> : null}
      actions={run?.summary && !['queued', 'running'].includes(status) ? (
        <>
          <a className="btn sm" href={`/api/admin/discovery/runs/${runId}/export.json`} download><Icon name="download" size="sm" />JSON</a>
          <a className="btn sm" href={`/api/admin/discovery/runs/${runId}/export.csv`} download><Icon name="download" size="sm" />Catalog CSV</a>
          <ActionButton action={reanalyse} className="btn sm ghost" icon="sync" working="Re-analysing…" title="Rebuild the catalog, suggestions and answers with the current rules, from the stored responses. Asks Blizzard nothing."
            onRun={async () => {
              const r = await api(`/api/admin/discovery/runs/${runId}/reanalyse`, { method: 'POST', body: {} });
              detail.setData(r);
              setRound((x) => x + 1);
              onChanged();
              return r;
            }} done="Re-analysed · catalog, suggestions and answers follow the current rules, and the combined catalog with them">Re-analyse</ActionButton>
        </>
      ) : null}>
      {(d) => {
        const r = d.run;
        if (status === 'queued') return <Empty icon="clock" title={`Run #${r.id} is queued`}>The worker picks it up within about 30 seconds. This page follows it.</Empty>;
        if (status === 'running') {
          const p = listed?.progress ?? r.progress ?? {};
          return (
            <dl className="kvs" aria-live="polite">
              <dt>Now</dt><dd><Chip kind="run">{p.phase ?? '…'}</Chip></dd>
              <dt>Requests so far</dt><dd>{formatNumber(p.requests)}</dd>
              <dt>Characters fetched</dt><dd>{formatNumber(p.characters)} of {formatNumber(Math.min(r.options.maxCharacters, p.queued ?? 0))} found so far (cap {formatNumber(r.options.maxCharacters)})</dd>
              <dt>Last heartbeat</dt><dd>{timeAgo(listed?.heartbeatAt ?? r.heartbeatAt) ?? '—'}</dd>
            </dl>
          );
        }
        if (!r.summary) return <div className="perr" role="alert"><Icon name="error" /><span><b>Run #{r.id} {r.status}.</b> {r.problem ?? 'No reason was recorded.'}</span></div>;
        const tabs = [
          { id: 'overview', label: 'Answers' },
          { id: 'endpoints', label: 'Endpoints', count: r.summary.endpoints.length },
          { id: 'catalog', label: 'Catalog', count: r.summary.catalogSize },
          { id: 'suggestions', label: 'Suggestions' },
          { id: 'responses', label: 'Raw responses', count: r.summary.requests },
        ];
        return (
          <>
            <ActionStatus action={reanalyse} />
            <Tabs tabs={tabs} value={tab} onChange={setTab} label="Run details" idPrefix="disc" />
            <div role="tabpanel" id={`disc-panel-${tab}`} aria-labelledby={`disc-tab-${tab}`} className="gd-stack">
              {tab === 'overview' && <Answers run={r} />}
              {tab === 'endpoints' && <Endpoints summary={r.summary} />}
              {tab === 'catalog' && <RunCatalog key={round} runId={r.id} />}
              {tab === 'suggestions' && <RunSuggestions key={round} runId={r.id} version={version} />}
              {tab === 'responses' && <Responses runId={r.id} />}
            </div>
          </>
        );
      }}
    </Panel>
  );
}

function RunCatalog({ runId }) {
  const load = useLoad(`/api/admin/discovery/runs/${runId}/catalog`);
  return <Loaded load={load} label="the run’s catalog">{(d) => <Catalog catalog={d.catalog} />}</Loaded>;
}

function RunSuggestions({ runId, version }) {
  const load = useLoad(`/api/admin/discovery/runs/${runId}/catalog`);
  return (
    <Loaded load={load} label="the run’s suggestions">
      {(d) => <Suggestions catalog={d.catalog} runId={runId} version={version} onChanged={(stat) => load.setData((x) => ({ ...x, catalog: x.catalog.map((s) => (s.statisticId === stat.statisticId ? stat : s)) }))} />}
    </Loaded>
  );
}

function Answers({ run }) {
  const s = run.summary;
  const rate = Object.entries(s.rateHeaders);
  const primary = s.characters[0];
  return (
    <div className="gd-stack">
      <div className="kpis">
        <Figure label="Requests" value={formatNumber(s.requests)} note={`${formatNumber(s.retried)} retried · ${formatNumber(s.throttled)} answered 429`} />
        <Figure label="Characters fetched" value={formatNumber(s.characters.length)} note={`cap ${formatNumber(run.options.maxCharacters)}`} />
        <Figure label="Latency p50 / p95" value={`${ms(s.latency.p50Ms)} / ${ms(s.latency.p95Ms)}`} note={`mean ${ms(s.latency.meanMs)} · max ${ms(s.latency.maxMs)}`} />
        <Figure label="Wall time" value={duration(s.wallMs)} note={`${run.options.requestsPerSecond} requests a second allowed`} />
      </div>

      <Q title="Rulesets sampled (from each character's profile)">
        {s.rulesetsSampled
          ? <span className="small">{Object.entries(s.rulesetsSampled).map(([k, n]) => `${k}: ${n} character${n === 1 ? '' : 's'}`).join(' · ') || 'No character answered.'}</span>
          : <span className="t2 small">Not recorded by the analysis this run was made with. Re-analyse it to read each character's ruleset from its stored profile.</span>}
      </Q>

      <Q title="Rulesets (as Blizzard names them)">
        {s.rulesets.listed.length === 0 ? <span className="t2 small">The ruleset index answered {s.rulesets.indexStatus ?? 'nothing'} and listed none.</span> : (
          <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Id</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Fields</th></tr></thead><tbody>
            {s.rulesets.listed.map((r) => <tr key={`${r.id}|${r.name}`}><td className="mono" data-label="Id">{String(r.id)}</td><td className="dtl" data-label=""><b>{String(r.name ?? '—')}</b></td><td data-label="Type">{typeof r.type === 'object' ? JSON.stringify(r.type) : String(r.type ?? '—')}</td><td className="mono" data-label="Fields">{r.keys.join(', ')}</td></tr>)}
          </tbody></table></div>
        )}
      </Q>

      <Q title="Namespaces">
        <dl className="kvs">
          <dt>Dynamic</dt><dd className="mono2">{s.namespaces.dynamic}</dd>
          <dt>Profile</dt><dd className="mono2">{s.namespaces.profile}</dd>
          <dt>Static (detected)</dt><dd className="mono2">{s.namespaces.staticDetected ?? 'not detected'}</dd>
        </dl>
        <span className="gd-note">{s.namespaces.staticNote} Every namespace seen in a link: {Object.keys(s.namespaceLinks).join(', ') || 'none'}.</span>
      </Q>

      <Q title="Forever-only systems: Camping, Legacy, Housing, Skyborne">
        {s.foreverInCatalog.map((t) => {
          const hits = s.foreverTerms.find((x) => x.id === t.id)?.hits ?? [];
          return (
            <div key={t.id} className="gd-answer">
              <b>{t.label}</b>
              {t.statistics.length
                ? <span className="small">Statistics: {t.statistics.map((x) => `${x.name} (id ${x.id}, ${x.category || 'no category'})`).join('; ')}</span>
                : <span className="t2 small">No statistic’s name or category mentions it, across {formatNumber(Math.max(0, ...Object.values(s.catalogSamples)))} sampled statistics responses.</span>}
              <span className="gd-note">{hits.length ? `Mentioned ${hits.length} times elsewhere, e.g. ${hits.slice(0, 4).map((h) => `${h.endpoint}: “${h.value}”`).join(' · ')}` : 'Not mentioned in any other response.'}</span>
            </div>
          );
        })}
        {s.termHitsCapped && <span className="gd-note">The mention list stopped at its cap; the JSON export has every hit recorded.</span>}
      </Q>

      <Q title="How Blizzard addresses a character (slugs)">
        <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Tried</th><th scope="col">Path</th><th scope="col">Answer</th></tr></thead><tbody>
          <tr><td className="dtl" data-label="">name-surname, lower case (our slug)</td><td className="mono" data-label="Path">{primary.path}</td><td data-label="Answer"><Chip kind={statusKind(primary.status)}>{primary.status ?? 'no answer'}</Chip></td></tr>
          {s.slugs.probes.map((p) => <tr key={p.id}><td className="dtl" data-label="">{p.label}</td><td className="mono" data-label="Path">{p.path}</td><td data-label="Answer"><Chip kind={statusKind(p.status)}>{p.status ?? 'no answer'}</Chip>{p.name ? <span className="sub">{p.name}</span> : null}</td></tr>)}
        </tbody></table></div>
        <span className="small">
          Blizzard’s own links to {formatNumber(s.slugs.findings.seen)} characters: {s.slugs.findings.withMoreThanOneHyphen.length} with more than one hyphen
          {s.slugs.findings.withMoreThanOneHyphen.length ? ` (${s.slugs.findings.withMoreThanOneHyphen.slice(0, 5).join(', ')})` : ''}, {s.slugs.findings.withSpace.length} with a space, {s.slugs.findings.withApostrophe.length} with an apostrophe, {s.slugs.findings.withUppercase.length} with capitals, {s.slugs.findings.withNonAscii.length} with non-ASCII letters.
        </span>
        <span className="gd-note">Examples: {s.slugs.findings.examples.join(', ') || 'none'}</span>
      </Q>

      <Q title="The Battle.net account (/profile/user/wow)">
        {!s.account.asked ? <span className="t2 small">Not asked for in this run.</span> : !s.account.authorized ? <span className="t2 small">Skipped: Battle.net wasn’t authorized when the run started.</span> : (
          <dl className="kvs">
            <dt>Answer</dt><dd><Chip kind={statusKind(s.account.status)}>{s.account.status ?? 'no answer'}</Chip></dd>
            <dt>Characters listed</dt><dd>{formatNumber(s.account.characters.length)}</dd>
            <dt>Realm-based like retail?</dt><dd>{s.account.realmShaped === null ? `unknown from ${s.account.characters.length} samples` : s.account.realmShaped ? 'Yes: entries carry a realm' : 'No: no entry has a realm field'}</dd>
            {s.account.characters[0] && <><dt>Fields on each entry</dt><dd className="mono2">{s.account.characters[0].keys.join(', ')}</dd></>}
          </dl>
        )}
      </Q>

      <Q title="Freshness">
        {s.freshness.filter((f) => f.subject === primary.path).length === 0
          ? <span className="t2 small">The primary character’s profile has no timestamp-like field (unknown from 1 sample).</span>
          : <dl className="kvs">{s.freshness.filter((f) => f.subject === primary.path).map((f) => <FreshRow key={`${f.endpoint}|${f.field}`} f={f} />)}</dl>}
        <span className="gd-note">Compare these with when you last logged out of {run.options.primary.name}.</span>
      </Q>

      <Q title={`Character media for ${run.options.primary.name} ${run.options.primary.surname}`}>
        <span className="small">{s.primaryMedia.status === 200 ? `Available: ${(s.primaryMedia.assets ?? []).join(', ') || 'answered, with no assets listed'}` : `Not available: answered ${s.primaryMedia.status ?? 'nothing'}.`}</span>
      </Q>

      <Q title="Rate-limit headers">
        {rate.length === 0 ? <span className="t2 small">None of the {formatNumber(s.requests)} responses carried a header named like a rate limit or quota.</span> : (
          <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Header</th><th scope="col" className="r num">Seen</th><th scope="col">First</th><th scope="col">Last</th><th scope="col">Range</th></tr></thead><tbody>
            {rate.map(([k, h]) => <tr key={k}><td className="dtl mono" data-label="">{k}</td><td className="r num" data-label="Seen">{formatNumber(h.count)}</td><td className="mono" data-label="First">{h.first}</td><td className="mono" data-label="Last">{h.last}</td><td data-label="Range">{h.numericMin !== null ? `${formatNumber(h.numericMin)}–${formatNumber(h.numericMax)}` : h.values.slice(0, 3).join(' · ')}</td></tr>)}
          </tbody></table></div>
        )}
        <details className="small"><summary className="muted">Every response header name seen</summary><span className="mono2">{Object.entries(s.headerNames).map(([k, c]) => `${k} (${c})`).join(', ')}</span></details>
      </Q>

      <Q title="Guild">
        <span className="small">
          {!s.guild.inProfile ? 'The primary’s profile has no guild field.' : !s.guild.linked ? `In a guild${s.guild.name ? ` (${s.guild.name})` : ''}, but the profile gives no link to it.` : !s.guild.asked ? `${s.guild.name ?? 'A guild'} is linked; not fetched in this run.` : `${s.guild.name ?? 'Guild'}: profile answered ${s.guild.status ?? 'nothing'}, roster listed ${s.guild.members ?? 'no'} members.`}
        </span>
      </Q>

      <Q title="Characters sampled">
        <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Path</th><th scope="col">From</th><th scope="col">Profile</th><th scope="col">Name</th><th scope="col" className="r num">Level</th><th scope="col">Class</th><th scope="col">Race</th><th scope="col">Faction</th><th scope="col">Ruleset</th></tr></thead><tbody>
          {s.characters.map((c) => <tr key={c.path}><td className="dtl mono" data-label="">{c.path}</td><td data-label="From">{c.source}</td><td data-label="Profile"><Chip kind={statusKind(c.status)}>{c.status ?? 'no answer'}</Chip></td><td data-label="Name">{c.name ?? '—'}</td><td className="r num" data-label="Level">{c.level ?? '—'}</td><td data-label="Class">{c.className ?? '—'}</td><td data-label="Race">{c.race ?? '—'}</td><td data-label="Faction">{c.faction ?? '—'}</td><td data-label="Ruleset">{c.ruleset ? `${c.ruleset.name ?? '?'} (${c.ruleset.id ?? '?'})` : '—'}</td></tr>)}
        </tbody></table></div>
      </Q>
    </div>
  );
}

function FreshRow({ f }) {
  return <><dt className="mono2">{f.endpoint} · {f.field}</dt><dd>{f.iso ? `${formatDateTime(f.iso)} (fetched ${formatDateTime(f.fetchedAt)})` : String(f.raw)}</dd></>;
}

function Endpoints({ summary }) {
  const rows = [...summary.endpoints].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th scope="col">Endpoint</th><th scope="col">Answers</th><th scope="col" className="r num">Requests</th><th scope="col" className="r num">p50</th><th scope="col" className="r num">p95</th><th scope="col" className="r num">Mean size</th><th scope="col">Token</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="dtl mono" data-label="">{e.id}</td>
              <td data-label="Answers"><div className="gd-row">{Object.entries(e.statuses).map(([code, c]) => <Chip key={code} kind={statusKind(code)}>{code} × {c}</Chip>)}{Object.keys(e.errors).length > 0 && <span className="gd-note">{Object.keys(e.errors).join(', ')}</span>}</div></td>
              <td className="r num" data-label="Requests">{formatNumber(e.requests)}</td>
              <td className="r num" data-label="p50">{ms(e.p50Ms)}</td>
              <td className="r num" data-label="p95">{ms(e.p95Ms)}</td>
              <td className="r num" data-label="Mean size">{formatBytes(e.meanBytes) ?? '—'}</td>
              <td className="t2" data-label="Token">{e.auth.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAX_SHOWN_BODY = 200_000;

/** Every request a run made, in order, as Blizzard answered, 100 at a time; one body at a time below. */
function Responses({ runId }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(0);
  const [open, setOpen] = useState(null);
  const more = useAction();
  const load = useCallback((after) => more.run(async () => {
    const r = await api(`/api/admin/discovery/runs/${runId}/responses?limit=100&after=${after}`);
    setRows((cur) => (after === 0 ? r.responses : [...cur, ...r.responses]));
    setNext(r.nextAfter);
    return r;
  }, { working: 'Loading responses…', done: (r) => `${formatNumber(r.responses.length)} loaded` }), [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(0);
  }, [load]);
  return (
    <div className="gd-stack">
      <span className="gd-note">Every request this run made, in order, as Blizzard answered. Request headers (which carry the tokens) are never stored.</span>
      <div className="dt-wrap">
        <table className="dt">
          <thead><tr><th scope="col">#</th><th scope="col">Endpoint</th><th scope="col">Path</th><th scope="col">Answer</th><th scope="col" className="r num">Latency</th><th scope="col" className="r num">Size</th><th scope="col"><span className="sr-only">Body</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={open === r.id ? 'is-sel' : undefined}>
                <td className="dtl mono" data-label="">#{r.id}</td>
                <td className="mono" data-label="Endpoint">{r.endpoint}</td>
                <td className="mono gd-wrap" data-label="Path">{r.path}</td>
                <td data-label="Answer"><Chip kind={statusKind(r.status)}>{r.status ?? r.error ?? 'no answer'}</Chip>{r.attempts > 1 && <span className="sub">{r.attempts} tries</span>}</td>
                <td className="r num" data-label="Latency">{ms(r.latency_ms)}</td>
                <td className="r num" data-label="Size">{formatBytes(r.bytes) ?? '—'}</td>
                <td data-label=""><div className="act"><button type="button" className="btn sm ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'View'}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gd-row"><ActionStatus action={more} />{next !== null && <button type="button" className={`btn sm${more.busy ? ' is-loading' : ''}`} disabled={more.busy} onClick={() => load(next)}>Load 100 more</button>}</div>
      {open && <ResponseBody id={open} />}
    </div>
  );
}

function ResponseBody({ id }) {
  const load = useLoad(`/api/admin/discovery/responses/${id}`);
  const row = load.data?.response;
  const text = useMemo(() => {
    if (!row?.body) return null;
    if (row.body.length > 2_000_000) return row.body.slice(0, MAX_SHOWN_BODY);
    try {
      return JSON.stringify(JSON.parse(row.body), null, 2).slice(0, MAX_SHOWN_BODY);
    } catch {
      return row.body.slice(0, MAX_SHOWN_BODY);
    }
  }, [row]);
  return (
    <Loaded load={load} label={`response #${id}`}>
      {() => (
        <div className="ap">
          <div className="hd">
            <h3>#{row.id} · {row.endpoint}</h3>
            <span className="mono2 t2 gd-wrap">{row.path}{row.namespace ? `?namespace=${row.namespace}` : ''}</span>
            <span className="spacer" />
            <a className="btn sm" href={`/api/admin/discovery/responses/${row.id}?download=1`} download><Icon name="download" size="sm" />Raw body</a>
          </div>
          <div className="bd">
            <span className="gd-note">Fetched {formatDateTime(row.fetched_at)} with the {row.auth === 'user' ? 'Battle.net user' : 'app'} token · {row.content_type ?? 'no content type'}{row.truncated ? ' · cut at 8 MB when stored' : ''}{text && row.body.length > MAX_SHOWN_BODY ? ' · showing the first 200 KB here; the download is complete' : ''}</span>
            <details className="small"><summary className="muted">Response headers</summary><pre className="gd-pre">{JSON.stringify(row.headers, null, 2)}</pre></details>
            {text === null ? <span className="t2 small">No body{row.error ? `: ${row.error}` : ''}.</span> : <pre className="gd-pre">{text}</pre>}
          </div>
        </div>
      )}
    </Loaded>
  );
}

// ===================================================================================================== Endpoint probe
const DEFAULTS = { name: 'Path', surname: 'Vexley', guild: 'Post Nerf Clarity' };
const VERDICT = { yes: { kind: 'ok', label: 'Yes' }, no: { kind: 'warn', label: 'No' }, unknown: { kind: 'off', label: 'Unknown' } };
const OUTCOME = { answered: 'ok', 'not found': 'warn', other: 'err', skipped: 'off', 'not asked': 'off' };
const FLAG = { first: 'first probe', later: 'later expansion', classic: 'classic docs', guess: 'Forever guess' };
// {C} and {G} stand for the probed character's and guild's own paths; spelled out (a bare "C" read as nothing).
const short = (t) => String(t).replace('{C}', 'character').replace('{G}', 'guild').replace('/data/wow/', '');

export function DiscoveryProbePage() {
  const { version, region } = useScope();
  const { list, runs, next, loadOlder, more } = useRunList('probe');
  const [selected, select] = useSelectedRun(runs);
  const listed = runs.find((r) => r.id === selected) ?? null;
  useHit(list.data);
  return (
    <>
      <DiscoveryHead />
      {list.data && !list.data.configured && (
        <div className="note warn small" role="alert"><Icon name="warning" /><span>The Blizzard API keys aren’t set. Enter them in <Link to="/admin/settings#keys">Settings › API keys</Link> first.</span></div>
      )}
      <ProbeFormPanel key={`${version}:${region}`} list={list} onQueued={(run) => { select(run.id); list.reload(); }} />
      <Panel panel={list} title="Probes" id="discovery-probes" flush
        sub={<ActiveElsewhere active={list.data?.active} kind="probe" />}
        live={list.data?.active ? `Following run #${list.data.active.id} · own 3 s clock` : null}>
        {() => (runs.length === 0 ? <Empty icon="discovery" title="No probe of this version and region yet">Fill in a character above and press Probe.</Empty> : (
          <>
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">Probe</th><th scope="col">Asked</th><th scope="col">Status</th><th scope="col">Character</th><th scope="col" className="r num">Requests</th><th scope="col" className="r">Took</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={r.status === 'failed' || r.status === 'interrupted' ? 'is-fail' : r.id === selected ? 'is-sel' : undefined}>
                      <td className="dtl mono" data-label=""><b>#{r.id}</b></td>
                      <td className="t2 nw" data-label="Asked">{formatDateTime(r.requestedAt)}</td>
                      <td data-label="Status"><Chip kind={RUN_KIND[r.status] ?? 'info'}>{r.status}{r.stopRequestedAt && ['queued', 'running'].includes(r.status) ? ' · stopping' : ''}</Chip></td>
                      <td data-label="Character">{r.options?.primary ? [r.options.primary.name, r.options.primary.surname].filter(Boolean).join(' ') : '—'}{r.options?.primary?.realmSlug ? <span className="sub">{r.options.primary.realmSlug}</span> : null}</td>
                      <td className="r num" data-label="Requests">{formatNumber(r.requests ?? r.progress?.requests)}</td>
                      <td className="r num t2" data-label="Took">{duration(r.wallMs)}</td>
                      <td data-label=""><div className="act"><button type="button" className="btn sm ghost" aria-pressed={r.id === selected} onClick={() => select(r.id)}>{r.id === selected ? 'Shown' : 'Show'}</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {next !== null && <div className="pager"><ActionStatus action={more} /><span className="spacer" /><ActionButton action={more} className="btn sm" onRun={loadOlder}>Older probes</ActionButton></div>}
          </>
        ))}
      </Panel>
      {selected && listed && <ProbeDetail key={selected} runId={selected} listed={listed} onChanged={list.reload} />}
      <ProbeMatrix />
      <RetentionNote />
    </>
  );
}

function ProbeFormPanel({ list, onQueued }) {
  const { version, region, versionName } = useScope();
  const versions = usePanel('discovery-probe-versions', () => api('/api/admin/discovery/probe-versions'), []);
  const v = versions.data?.versions?.find((x) => x.id === version) ?? null;
  const regionOk = Boolean(v?.regions?.includes(region));
  const [form, setForm] = useState(null);
  const [mine, setMine] = useState(null); // the prefill answer
  const prefill = useAction();
  const queue = useAction();
  const d = list.data;
  useEffect(() => {
    if (d && form === null) {
      const last = d.runs.find((r) => isProbe(r))?.options;
      setForm({
        name: last?.primary?.name ?? DEFAULTS.name,
        surname: last?.primary?.surname ?? DEFAULTS.surname,
        realm: last?.primary?.realmSlug ?? '',
        guild: last?.guild?.name ?? DEFAULTS.guild,
      });
    }
  }, [d, form]);
  const f = form ?? { name: '', surname: '', realm: '', guild: '' };
  const set = (k) => (e) => setForm((x) => ({ ...(x ?? f), [k]: e.target.value }));
  const runPrefill = () => prefill.run(async () => {
    const r = await api(`/api/admin/discovery/probe-characters?version=${encodeURIComponent(version)}&region=${encodeURIComponent(region)}`);
    setMine(r);
    setForm((x) => ({
      ...(x ?? f),
      ...(r.pick ? { name: r.pick.name, surname: r.pick.surname ?? '', realm: r.pick.realmSlug ?? '' } : {}),
      ...(r.guild ? { guild: r.guild.name } : {}),
    }));
    return r;
  }, { working: 'Reading your character list…', done: (r) => (r.pick ? `Filled in ${[r.pick.name, r.pick.surname].filter(Boolean).join(' ')}` : 'Nothing to fill in (see the note)') });
  const start = (e) => {
    e.preventDefault();
    queue.run(async () => {
      const body = v?.realms ? { version, region, name: f.name, realm: f.realm, guild: f.guild } : { version, region, name: f.name, surname: f.surname, guild: f.guild };
      const { run } = await api('/api/admin/discovery/probes', { method: 'POST', body });
      onQueued(run);
      return run;
    }, { working: 'Queueing…', done: (run) => `Probe #${run.id} queued · the worker starts it within about 30 s` });
  };
  return (
    <Panel panel={list} title={`Probe ${versionName} · ${region.toUpperCase()}`} id="discovery-probe-form">
      {(data) => (
        <>
          <p className="t2 small">
            Tries every endpoint in Blizzard’s WoW API docs (retail and classic) against this game version, once, and records what answers: a few hundred requests at the discovery rate (more on a version with many realms: every realm is asked once). Ids come from real answers; a path with no real id to try is skipped, with the reason. Versions players can’t see yet can be probed: nothing from a probe is stored outside its own records.
            {data.grant ? ' Your Battle.net authorization reads your character list and protected-character.' : ' Without a Battle.net authorization (Runs), your character list can’t be read and protected-character is skipped.'}
          </p>
          {v && <span className="gd-note">{v.name}: {v.realms ? `characters live on realms; tiers and boards would be graded within each ${v.categoryLabel}` : `realmless; graded within each ${v.categoryLabel}`}{v.enabled ? '' : '. Not shown to players yet.'}</span>}
          {versions.data && !regionOk && <div className="note warn small" role="status"><Icon name="warning" /><span>Probes run only in a region Everstats covers for this version ({(v?.regions ?? []).map((x) => x.toUpperCase()).join(', ') || 'none'}). Switch the region in the top bar.</span></div>}
          <form className="gd-stack" onSubmit={start}>
            <div className="gd-row">
              <ActionButton action={prefill} className="btn sm" icon="user" disabled={!v || !regionOk || !data.grant} onRun={runPrefill}
                title={data.grant ? 'Read your Battle.net character list on this version (stores nothing)' : 'Authorize Battle.net on the Runs tab first'}>Use my highest-level character</ActionButton>
              <ActionStatus action={prefill} />
              {mine?.note && <span className="t2 small" role="status">{mine.note}</span>}
            </div>
            {mine?.characters?.length > 0 && (
              <span className="gd-note">Your characters on {v?.name}: {mine.characters.map((c) => `${[c.name, c.surname].filter(Boolean).join(' ')}${c.realmSlug ? ` (${c.realmSlug})` : ''} ${c.level ?? '?'}`).join(', ')}</span>
            )}
            <div className="gd-row">
              <label className="field gd-fill"><span className="lab">Character: name</span><input className="inp" value={f.name} onChange={set('name')} autoComplete="off" /></label>
              {v?.realms
                ? <label className="field gd-fill"><span className="lab">Realm</span><input className="inp" value={f.realm} onChange={set('realm')} autoComplete="off" /></label>
                : <label className="field gd-fill"><span className="lab">Surname</span><input className="inp" value={f.surname} onChange={set('surname')} autoComplete="off" /></label>}
              <label className="field gd-fill"><span className="lab">{v?.realms ? 'Guild (on the character’s realm)' : 'Guild'}</span><input className="inp" value={f.guild} onChange={set('guild')} autoComplete="off" /></label>
            </div>
            <div className="gd-row">
              <button type="submit" className={`btn gold${queue.busy ? ' is-loading' : ''}`} disabled={queue.busy || Boolean(data.active) || !data.configured || !v || !regionOk}><Icon name="play" size="sm" />Probe {v?.short ?? versionName}</button>
              <ActionStatus action={queue} />
              {data.active && <span className="t2 small">{isProbe(data.active) ? 'Probe' : 'Run'} #{data.active.id} hasn’t finished yet.</span>}
            </div>
          </form>
        </>
      )}
    </Panel>
  );
}

function ProbeDetail({ runId, listed, onChanged }) {
  const detail = usePanel(`discovery-probe:${runId}`, () => api(`/api/admin/discovery/runs/${runId}?skeletons=1`), [runId, listed?.status]);
  const [tab, setTab] = useState('answers');
  const stop = useAction();
  const reanalyse = useAction();
  const render = useAction();
  const run = detail.data?.run;
  const status = listed?.status ?? run?.status;
  const s = run?.summary;
  const active = status === 'queued' || status === 'running';
  const stopping = Boolean(listed?.stopRequestedAt ?? run?.stopRequestedAt);
  const setRender = (verdict) => render.run(async () => {
    detail.setData(await api(`/api/admin/discovery/runs/${runId}/render-check`, { method: 'POST', body: { verdict } }));
  }, { working: 'Saving…', done: verdict ? (verdict === 'right' ? 'Saved: draws the right race' : 'Saved: draws the wrong race') : 'Cleared' });
  return (
    <Panel panel={detail} title={`Probe #${runId}`} id="discovery-probe-detail"
      sub={s && !active ? <span className="muted xsmall">{s.versionName ?? 'WoW Forever'}{s.region ? ` (${s.region.toUpperCase()})` : ''} · {s.primary ? [s.primary.name, s.primary.surname].filter(Boolean).join(' ') : '—'}{s.primary?.realmSlug ? ` (${s.primary.realmSlug})` : ''} · {s.guild?.name ?? '—'} · {run.status} {formatDateTime(run.finishedAt)} · analysed with v{s.analysedWith}</span> : null}
      actions={active ? (
        <>
          <ActionStatus action={stop} />
          <ActionButton action={stop} className="btn sm" icon="close" disabled={stopping} working="Stopping…" onRun={async () => {
            await api(`/api/admin/discovery/runs/${runId}/stop`, { method: 'POST', body: {} });
            onChanged();
          }} done="Stopping · it stops before its next request and keeps what it has">{stopping ? 'Stopping…' : 'Stop'}</ActionButton>
        </>
      ) : s ? (
        <>
          <a className="btn sm" href={`/api/admin/discovery/runs/${runId}/export.json`} download><Icon name="download" size="sm" />JSON</a>
          <a className="btn sm" href={`/api/admin/discovery/runs/${runId}/export.csv`} download><Icon name="download" size="sm" />CSV</a>
          {s.boards && <a className="btn sm" href={`/api/admin/discovery/runs/${runId}/export-boards.csv`} download><Icon name="download" size="sm" />Boards CSV</a>}
          <ActionButton action={reanalyse} className="btn sm ghost" icon="sync" working="Re-analysing…" title="Rebuild the results and answers from the stored responses. Asks Blizzard nothing."
            onRun={async () => {
              await api(`/api/admin/discovery/runs/${runId}/reanalyse`, { method: 'POST', body: {} });
              detail.setData(await api(`/api/admin/discovery/runs/${runId}?skeletons=1`));
              onChanged();
            }} done="Re-analysed from the stored responses · Blizzard wasn’t asked anything">Re-analyse</ActionButton>
        </>
      ) : null}>
      {(d) => {
        const r = d.run;
        if (active) {
          const p = (listed ?? r).progress ?? {};
          if (status === 'queued') return <Empty icon="clock" title={`Probe #${r.id} is queued`}>The worker picks it up within about 30 seconds. This page follows it.</Empty>;
          return (
            <dl className="kvs" aria-live="polite">
              <dt>Now</dt><dd><Chip kind="run">{p.phase ?? '…'}</Chip></dd>
              <dt>Endpoints</dt><dd>{formatNumber(p.entriesDone)} of {formatNumber(p.entriesTotal)}</dd>
              <dt>Requests so far</dt><dd>{formatNumber(p.requests)}</dd>
              <dt>Answered 200 / skipped</dt><dd>{formatNumber(p.answered)} / {formatNumber(p.skipped)}</dd>
              <dt>Last heartbeat</dt><dd>{timeAgo((listed ?? r).heartbeatAt) ?? '—'}</dd>
            </dl>
          );
        }
        const sum = r.summary;
        if (!sum) return <div className="perr" role="alert"><Icon name="error" /><span><b>Probe #{r.id} {r.status}.</b> {r.problem ?? 'No reason was recorded.'}</span></div>;
        const answered = sum.areas.reduce((n, a) => n + a.answered, 0);
        const skipped = sum.areas.reduce((n, a) => n + a.skipped, 0);
        const tabs = [
          { id: 'answers', label: 'Answers' },
          ...(sum.realms ? [{ id: 'realms', label: 'Realms', count: sum.realms.players ?? sum.realms.asked }] : []),
          ...(sum.groups ? [{ id: 'groups', label: 'Statistics & groups', count: sum.groups.length }] : []),
          ...(sum.boards ? [{ id: 'boards', label: 'Boards', count: sum.boards.total }] : []),
          { id: 'areas', label: 'By area', count: sum.entryCount },
          { id: 'responses', label: 'Raw responses', count: sum.requests },
        ];
        return (
          <>
            <ActionStatus action={reanalyse} />
            {sum.primaryMissing && <div className="perr" role="status"><Icon name="error" /><span><b>The probe’s character didn’t answer.</b> {sum.answers.find((a) => a.id === 'primary-character')?.text ?? 'Its profile answered no 200.'}</span></div>}
            {sum.stopped && <div className="note warn small" role="status"><Icon name="warning" /><span>Stopped after {formatNumber(sum.stopped.afterRequests)} requests ({formatNumber(sum.stopped.afterEntries)} of {formatNumber(sum.entryCount)} endpoints). Endpoints after that are “not asked”, and answers that needed them say unknown.</span></div>}
            <div className="kpis">
              <Figure label="Requests" value={formatNumber(sum.requests)} note={`${formatNumber(sum.retried)} retried · ${formatNumber(sum.throttled)} answered 429`} />
              <Figure label="Took" value={duration(sum.wallMs)} note={`${r.options.requestsPerSecond} requests a second allowed`} />
              <Figure label="Endpoints answered 200" value={`${formatNumber(answered)} of ${formatNumber(sum.entryCount)}`} note={`${formatNumber(skipped)} skipped, with reasons`} />
              <Figure label="Latency p50 / p95" value={`${ms(sum.latency.p50Ms)} / ${ms(sum.latency.p95Ms)}`} note={`max ${ms(sum.latency.maxMs)}`} />
            </div>
            <Tabs tabs={tabs} value={tab} onChange={setTab} label="Probe results" idPrefix="probe" />
            <div className="gd-stack" role="tabpanel" id={`probe-panel-${tab}`} aria-labelledby={`probe-tab-${tab}`}>
              {tab === 'answers' && <><ProbeRender summary={sum} action={render} onSet={setRender} /><ProbeAnswers summary={sum} /></>}
              {tab === 'realms' && <ProbeRealms summary={sum} />}
              {tab === 'groups' && <ProbeGroups summary={sum} />}
              {tab === 'boards' && <ProbeBoards summary={sum} />}
              {tab === 'areas' && <ProbeAreas summary={sum} />}
              {tab === 'responses' && <Responses runId={r.id} />}
            </div>
          </>
        );
      }}
    </Panel>
  );
}

function ProbeAnswers({ summary: s }) {
  return (
    <div className="gd-stack">
      {s.answers.map((a) => (
        <div key={a.id} className="gd-answer">
          <div className="gd-row"><Chip kind={VERDICT[a.verdict].kind}>{VERDICT[a.verdict].label}</Chip><span className="gd-note">{a.module}</span></div>
          <b className="small">{a.question}</b>
          <span className="t2 small">{a.text}</span>
        </div>
      ))}
      <Q title="Answered, though we didn’t expect it">
        <span className="gd-note">A Forever guess, a path never probed before 0.8.3, or a system retail added in a later expansion, that answered 200.</span>
        {s.unexpected.length === 0 ? <span className="t2 small">Nothing.</span> : (
          <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Path</th><th scope="col">Why unexpected</th><th scope="col" className="r num">Items</th><th scope="col" className="r num">Size</th></tr></thead><tbody>
            {s.unexpected.map((u) => <tr key={u.id}><td className="dtl mono gd-wrap" data-label="">{u.path}</td><td data-label="Why unexpected">{u.flags.map((f) => FLAG[f]).join(', ')}</td><td className="r num" data-label="Items">{u.count === null ? '—' : formatNumber(u.count)}</td><td className="r num" data-label="Size">{formatBytes(u.bytes) ?? '—'}</td></tr>)}
          </tbody></table></div>
        )}
      </Q>
      <Q title="Forever words in the answers">
        {s.foreverTerms.map((t) => <span key={t.id} className="small"><span className="muted">{t.label}:</span> {t.total ? `${formatNumber(t.total)} place${t.total === 1 ? '' : 's'}, e.g. ${t.hits.slice(0, 3).map((h) => `“${h.value.slice(0, 50)}” (${h.endpoint.replace(/^ep\./, '')})`).join(', ')}` : 'nowhere'}</span>)}
      </Q>
      <Q title="Namespaces">
        <dl className="kvs">
          <dt>Profile</dt><dd className="mono2">{s.namespaces?.profile ?? '—'}</dd>
          <dt>Dynamic</dt><dd className="mono2">{s.namespaces?.dynamic ?? '—'}</dd>
          <dt>Static (detected from links)</dt><dd className="mono2">{s.namespaces?.staticDetected ?? 'none detected: static endpoints were skipped'}</dd>
          {s.staticCheck && <><dt>Static (used, after the check)</dt><dd className="mono2">{s.staticCheck.chosen ?? 'none'}</dd></>}
        </dl>
        {s.staticCheck && (
          <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Namespace tried</th><th scope="col">Why</th><th scope="col">Answers</th><th scope="col" className="r num">Items</th></tr></thead><tbody>
            {s.staticCheck.candidates.map((c) => (
              <tr key={c.ns}>
                <td className="dtl mono" data-label="">{c.ns} {c.ns === s.staticCheck.chosen && <Chip kind="ok">used</Chip>}</td>
                <td data-label="Why">{c.why}</td>
                <td data-label="Answers">{c.results.map((r) => `${r.entry.replace(/^data\./, '')} ${r.status ?? 'no answer'}`).join(', ')}</td>
                <td className="r num" data-label="Items">{formatNumber(c.items)}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Q>
    </div>
  );
}

function ProbeAreas({ summary: s }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="gd-stack">
      {s.areas.map((area) => {
        const list = s.entries.filter((e) => e.area === area.id);
        if (list.length === 0) return null;
        return (
          <div key={area.id} className="gd-stack">
            <div className="gd-row"><h3 className="small"><b>{area.label}</b></h3><span className="gd-note">{formatNumber(area.answered)} answered · {formatNumber(area.notFound)} 404 · {formatNumber(area.other)} other · {formatNumber(area.skipped)} skipped{area.notAsked ? ` · ${formatNumber(area.notAsked)} not asked` : ''}</span></div>
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">Endpoint</th><th scope="col">Tried</th><th scope="col">Answer</th><th scope="col" className="r num">Size</th><th scope="col" className="r num">Items</th><th scope="col"><span className="sr-only">Field outline</span></th></tr></thead>
                <tbody>
                  {list.flatMap((e) => {
                    const best = e.attempts.find((a) => a.responseId === e.best) ?? null;
                    const outline = best ? s.skeletons?.[best.responseId] : null;
                    const rows = [(
                      <tr key={e.id} className={open === e.id ? 'is-sel' : undefined}>
                        <td className="dtl mono gd-wrap" data-label="">{short(e.template)} {e.flags.map((f) => <span key={f} className="chip">{FLAG[f]}</span>)}</td>
                        <td data-label="Tried">
                          {e.skipped ? <span className="t2">Skipped: {e.skipped}</span> : e.attempts.length === 0 ? <span className="t2">Not asked (stopped first)</span> : e.attempts.map((a) => (
                            <div key={a.responseId} className="gd-wrap"><span className="mono2">{a.path}</span> <span className="gd-note">{a.namespace} · {a.basis}</span></div>
                          ))}
                        </td>
                        <td data-label="Answer"><div className="gd-row">{e.attempts.length ? e.attempts.map((a) => <Chip key={a.responseId} kind={statusKind(a.status)}>{a.status ?? a.error ?? 'no answer'}</Chip>) : <Chip kind={OUTCOME[e.outcome] ?? 'off'}>{e.outcome}</Chip>}</div></td>
                        <td className="r num" data-label="Size">{best ? formatBytes(best.bytes) ?? '—' : '—'}</td>
                        <td className="r num" data-label="Items">{best?.count === null || best?.count === undefined ? '—' : formatNumber(best.count)}</td>
                        <td data-label="">{outline && <div className="act"><button type="button" className="btn sm ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Fields'}</button></div>}</td>
                      </tr>
                    )];
                    if (open === e.id && outline) rows.push(<tr key={`${e.id}-outline`}><td colSpan={6} data-label=""><pre className="gd-pre">{Object.entries(outline).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre></td></tr>);
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {s.entries.length === 0 && <Empty icon="info" title="No endpoints recorded" />}
    </div>
  );
}

/** The render beside the race Blizzard names: only the admin's eyes can say whether it draws it. */
function ProbeRender({ summary: s, action, onSet }) {
  const r = s.render;
  if (!r) return null;
  return (
    <div className="gd-answer">
      <div className="gd-row"><Chip kind={r.verdict === 'right' ? 'ok' : r.verdict === 'wrong' ? 'warn' : 'off'}>{r.verdict === 'right' ? 'Right race' : r.verdict === 'wrong' ? 'Wrong race' : 'Not checked'}</Chip><span className="gd-note">Renders</span></div>
      <b className="small">Does the render draw {r.race ?? 'the race Blizzard names'}{r.gender ? ` (${r.gender})` : ''}?</b>
      {r.main ? <img className="gd-render" src={r.main} alt={`Blizzard's render of the probed character (Blizzard says: ${r.race ?? 'race not named'})`} loading="lazy" /> : <span className="t2 small">{r.text}</span>}
      {r.main && (
        <div className="gd-row">
          <button type="button" className="btn sm" disabled={action.busy} onClick={() => onSet('right')}>Draws the right race</button>
          <button type="button" className="btn sm" disabled={action.busy} onClick={() => onSet('wrong')}>Wrong race</button>
          {r.verdict && <button type="button" className="btn sm ghost" disabled={action.busy} onClick={() => onSet(null)}>Clear</button>}
          <ActionStatus action={action} />
        </div>
      )}
      {Object.keys(r.urls ?? {}).length > 0 && <span className="gd-note mono2 gd-wrap">{Object.entries(r.urls).map(([k, u]) => `${k}: ${u}`).join('  ·  ')}</span>}
    </div>
  );
}

function ProbeRealms({ summary: s }) {
  const r = s.realms;
  return (
    <div className="gd-stack">
      <span className="t2 small">{formatNumber(r.answered)} of {formatNumber(r.asked)} realms answered{r.capped ? ` (realm/index listed more; the first ${formatNumber(r.capped)} were asked)` : ''}{r.players !== undefined ? `: ${formatNumber(r.players)} player realms, ${formatNumber(r.excluded?.length ?? 0)} internal realms excluded${r.exclusionKnown ? '' : ' (connected-realm/index didn’t answer, so none could be told apart)'}` : ''}. {r.tournament ? `${formatNumber(r.tournament)} tournament realm(s).` : ''}</span>
      {r.rules && <span className="gd-note">{r.rules.players} {r.rules.locked}</span>}
      <div className="kpis">
        <Figure label="By realm type" value={formatNumber(r.byType.length)} note={r.byType.map((t) => `${t.value} ×${t.realms}`).join(', ') || 'none'} />
        <Figure label="By category" value={formatNumber(r.byCategory.length)} note={r.byCategory.map((t) => `${t.value} ×${t.realms}`).join(', ') || 'none'} />
        {r.lockKnown > 0 && <Figure label="Locked" value={`${formatNumber(r.locked)} of ${formatNumber(r.lockKnown)}`} note={(r.lockByCategory ?? []).map((c) => `${c.category}: ${c.locked} locked, ${c.open} open`).join(' · ')} />}
      </div>
      <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Realm</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Time zone · locale</th><th scope="col">Other</th></tr></thead><tbody>
        {r.realms.filter((x) => !x.excluded).map((x) => (
          <tr key={x.slug}>
            <td className="dtl" data-label="">{x.name ?? x.slug} <span className="sub mono">{x.slug}{x.id !== null && x.id !== undefined ? ` · ${x.id}` : ''}</span></td>
            <td data-label="Type">{x.answered ? (x.type ? `${x.type.type ?? '?'} (${x.type.name ?? '?'})` : '—') : <Chip kind={statusKind(x.status)}>{x.status ?? 'no answer'}</Chip>}</td>
            <td data-label="Category">{x.category ?? '—'}</td>
            <td data-label="Time zone · locale">{[x.timezone, x.locale].filter(Boolean).join(' · ') || '—'}</td>
            <td data-label="Other">{[x.locked === true ? 'locked' : x.locked === false ? 'open' : null, x.isTournament ? 'tournament' : null, ...Object.entries(x.extra ?? {}).map(([k, val]) => `${k}: ${val}`)].filter(Boolean).join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody></table></div>
      {r.excluded?.length > 0 && (
        <Q title={`Excluded: internal realms (${formatNumber(r.excluded.length)})`}>
          <span className="gd-note">On no realm list, no board, never crawled.</span>
          <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Realm</th><th scope="col">Blizzard category</th><th scope="col">Connected realm</th></tr></thead><tbody>
            {r.excluded.map((x) => (
              <tr key={x.slug}>
                <td className="dtl" data-label="">{x.name ?? x.slug} <span className="sub mono">{x.slug}</span></td>
                <td data-label="Blizzard category">{x.category ?? '—'}</td>
                <td className="mono" data-label="Connected realm">{x.connectedRealmId ?? 'none named'} (not listed)</td>
              </tr>
            ))}
          </tbody></table></div>
        </Q>
      )}
    </div>
  );
}

function ProbeGroups({ summary: s }) {
  const st = s.statistics;
  return (
    <div className="gd-stack">
      {st ? (
        <Q title="The statistic catalog compared with Forever's">
          <div className="kpis">
            <Figure label="Statistic ids here" value={formatNumber(st.probed)} note={`Forever has ${formatNumber(st.forever)}`} />
            <Figure label="Shared ids" value={formatNumber(st.shared)} note={`${formatNumber(st.sharedSameName)} same name · ${formatNumber(st.sharedRenamed.length)} renamed`} />
            <Figure label="New here / missing here" value={`${formatNumber(st.new.length)} / ${formatNumber(st.missing.length)}`} note="full lists in the JSON export" />
          </div>
          <span className="t2 small">Top categories only here: {st.categories.onlyHere.join(', ') || 'none'} · only on Forever: {st.categories.onlyForever.join(', ') || 'none'} · both: {st.categories.both.join(', ') || 'none'}.</span>
          <span className="gd-note">Nothing is copied: group decisions are made per version on <ScopedLink to="/admin/tiers#tier-groups">Tiers</ScopedLink>.</span>
        </Q>
      ) : <span className="t2 small">{s.primaryMissing ? 'Not measured: the probe’s character answered no profile, so there is no statistics answer to compare (not zero statistics).' : 'No achievement-statistics answer, so there is no catalog to compare.'}</span>}
      <Q title="Groups, with Forever's choice as a suggestion">
        {s.primaryMissing && <span className="t2 small">The statistic counts below are not measured: the probe’s character answered no profile. Only boards from data endpoints are counted.</span>}
        <span className="gd-note">A suggestion only: nothing is chosen for this version. A new version starts with every group undecided (no tiers) until you decide on Tiers. “Proposed” = a group Forever doesn’t have.</span>
        <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Group</th><th scope="col" className="r num">Statistics</th><th scope="col" className="r num">Ids matching Forever</th><th scope="col" className="r num">Other boards</th><th scope="col">Suggestion</th></tr></thead><tbody>
          {s.groups.map((g) => (
            <tr key={g.label}>
              <td className="dtl" data-label=""><b>{g.label}</b> {g.proposed && <span className="chip">proposed</span>}</td>
              <td className="r num" data-label="Statistics">{formatNumber(g.statistics)}</td>
              <td className="r num" data-label="Ids matching Forever">{formatNumber(g.matchForever)}</td>
              <td className="r num" data-label="Other boards">{formatNumber(g.boards)}</td>
              <td data-label="Suggestion">{g.forever.text}<span className="sub">{g.forever.basis}</span></td>
            </tr>
          ))}
        </tbody></table></div>
      </Q>
    </div>
  );
}

function ProbeBoards({ summary: s }) {
  const b = s.boards;
  const [shown, setShown] = useState(100);
  return (
    <div className="gd-stack">
      {s.primaryMissing && <div className="perr" role="status"><Icon name="error" /><span>Not measured: the probe’s character answered no profile, so the counts below are not zeros. Run the probe again with a character that answers.</span></div>}
      <span className="t2 small">Rule A7: every numeric value Blizzard returns is a board. {formatNumber(b.total)} boards from this character's (and guild's) answers. Other characters can have values this one hasn't, so the real count can be higher. The Boards CSV has every board, every skipped field and the realms.</span>
      <div className="kpis">{b.groups.map((g) => <Figure key={g.group} label={g.group} value={formatNumber(g.boards)} note="boards" />)}</div>
      <Q title={`Skipped fields (${formatNumber(b.skipped.length)})`}>
        <span className="gd-note">Every field that isn't a board, with the rule that skipped it. Check this list for anything that should be one.</span>
        <div className="dt-wrap"><table className="dt"><thead><tr><th scope="col">Feed</th><th scope="col">Field</th><th scope="col">Why not a board</th></tr></thead><tbody>
          {b.skipped.slice(0, shown).map((x) => <tr key={`${x.feed}|${x.path}|${x.rule}`}><td className="dtl" data-label="">{x.feed}</td><td className="mono gd-wrap" data-label="Field">{x.path}</td><td data-label="Why not a board">{x.reason}</td></tr>)}
        </tbody></table></div>
        {b.skipped.length > shown && <div className="pager"><span>{formatNumber(shown)} of {formatNumber(b.skipped.length)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={() => setShown(shown + 200)}>Show more</button></div>}
      </Q>
      {b.overlaps?.length > 0 && <span className="gd-note">{formatNumber(b.overlaps.length)} PvP-summary field(s) are already collections family boards (pvp:…): listed once, as the family's.</span>}
    </div>
  );
}

const MATRIX_VIEWS = [
  { id: 'all', label: 'Every endpoint' },
  { id: 'differ', label: 'Where versions differ' },
  { id: 'answered', label: 'Answered somewhere' },
];

/**
 * The endpoint probe matrix (design v5 "Added beyond the brief"): every endpoint against every game version, each cell
 * the answer of that version's NEWEST finished probe in this region. Read from stored probe summaries only.
 */
function ProbeMatrix() {
  const { region } = useScope();
  const m = usePanel(`probe-matrix:${region}`, () => api(`/api/admin/discovery/probe-matrix?region=${encodeURIComponent(region)}`), [region]);
  const [view, setView] = useState('differ');
  const [filter, setFilter] = useState('');
  return (
    <Panel panel={m} title={`Endpoint probe matrix · ${region.toUpperCase()}`} id="discovery-probe-matrix" flush
      footer="Each column is that version’s newest finished probe in this region; a version never probed here has no column data. Probe a version to fill its column. Nothing here asks Blizzard anything.">
      {(d) => {
        const probed = d.versions.filter((v) => v.run);
        if (!probed.length) return <Empty icon="grid" title="No finished probe in this region yet">Run a probe (above) on each version to compare them here.</Empty>;
        const f = filter.trim().toLowerCase();
        const outcomes = (r) => probed.map((v) => r.cells[v.id]?.outcome ?? 'none');
        const rows = d.rows.filter((r) => {
          if (f && !r.template.toLowerCase().includes(f) && !r.id.toLowerCase().includes(f)) return false;
          if (view === 'differ') return new Set(outcomes(r)).size > 1;
          if (view === 'answered') return outcomes(r).includes('answered');
          return true;
        });
        const areaLabel = new Map(d.areas.map((a) => [a.id, a.label]));
        let lastArea = null;
        return (
          <>
            <div className="tbar">
              <input className="inp search" type="search" placeholder="Filter by path" aria-label="Filter endpoints" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <Segmented options={MATRIX_VIEWS} value={view} onChange={setView} label="Which endpoints" />
              <span className="spacer" />
              <span className="cnt">{formatNumber(rows.length)} of {formatNumber(d.rows.length)} endpoints</span>
            </div>
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">Endpoint</th>{d.versions.map((v) => <th key={v.id} scope="col" className="c">{v.short}{v.run ? '' : ' (no probe)'}</th>)}</tr></thead>
                <tbody>
                  {rows.flatMap((r) => {
                    const out = [];
                    if (r.area !== lastArea) {
                      lastArea = r.area;
                      out.push(<tr key={`area-${r.area}`} className="gd-area"><td colSpan={d.versions.length + 1} data-label="">{areaLabel.get(r.area) ?? r.area}</td></tr>);
                    }
                    out.push(
                      <tr key={r.id}>
                        <td className="dtl mono gd-wrap" data-label="">{short(r.template)}</td>
                        {d.versions.map((v) => {
                          const c = r.cells[v.id];
                          return (
                            <td key={v.id} className="gd-cell" data-label={v.short}>
                              {!v.run ? <span className="muted">—</span> : !c ? <span className="muted" title="Not in this probe’s list">n/a</span>
                                : <Chip kind={OUTCOME[c.outcome] ?? 'off'} title={c.skipped ?? undefined}>{c.outcome === 'answered' || c.outcome === 'not found' || c.outcome === 'other' ? (c.status ?? c.outcome) : c.outcome}</Chip>}
                            </td>
                          );
                        })}
                      </tr>,
                    );
                    return out;
                  })}
                </tbody>
              </table>
            </div>
            <div className="tbar"><span className="gd-note">Probes: {probed.map((v) => `${v.short} #${v.run.id} (${formatDateTime(v.run.finishedAt)}${v.run.status === 'stopped' ? ', stopped early' : ''})`).join(' · ')}</span></div>
          </>
        );
      }}
    </Panel>
  );
}
