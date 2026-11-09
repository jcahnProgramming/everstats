import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Segmented, Tabs, Toggle } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { SettingRow } from './AdminPages.jsx';

/**
 * /admin/discovery: the Blizzard API discovery pass (server/discovery/). Admin only, like the rest of /admin: without
 * an admin session the API answers 404 and this is the ordinary "Nothing here" page. Linked only from the admin page.
 *
 * What it shows is what the run measured. Suggestions are labelled as suggestions, each with its reasoning; nothing
 * the admin approves here becomes a leaderboard or tier category yet (that's built later from approved rows).
 * The design (v1) has no discovery page: it is built from the admin page's own parts (panels, tables, tags, kv rows).
 */
const AUTH_ERRORS = {
  cancelled: 'Battle.net authorization was cancelled.',
  state_mismatch: 'That authorization didn’t match the one this page started. Try again.',
  not_configured: 'The Blizzard keys aren’t configured.',
  provider_failed: 'Battle.net didn’t complete the authorization. Try again.',
};
const ACTIVE = ['queued', 'running'];
const RUN_TAG = { queued: '', running: 'gold', done: 'ok', failed: 'err', interrupted: 'warn' };
const statusTag = (code) => (code === 'no answer' || code === null ? 'err' : Number(code) < 300 ? 'ok' : Number(code) === 404 ? 'warn' : 'err');
const ms = (v) => (Number.isFinite(v) ? `${formatNumber(v)} ms` : '—');
const duration = (v) => (Number.isFinite(v) ? (v < 120_000 ? `${Math.round(v / 1000)} s` : `${Math.round(v / 60_000)} min`) : '—');

export function DiscoveryPage() {
  const toast = useToasts();
  const [state, setState] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const [selected, setSelected] = useState(null);
  const [combinedVersion, setCombinedVersion] = useState(0); // bumps after any re-analysis: every catalog view reloads
  // 0.6.0: /admin/discovery?stat=ID (from Tiers → What counts) opens the combined suggestions on that statistic.
  const [focusStat, setFocusStat] = useState(() => {
    const n = Number(new URLSearchParams(window.location.search).get('stat'));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  });
  const [notice] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('authorized') === '1') return { ok: true, text: 'Battle.net authorized for discovery.' };
    if (q.get('error')) return { ok: false, text: AUTH_ERRORS[q.get('error')] ?? 'Battle.net authorization didn’t complete.' };
    return null;
  });
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api('/api/admin/discovery');
      setState(s);
      setSelected((cur) => cur ?? s.runs[0]?.id ?? null);
    } catch (err) {
      if (err.status === 404) setState(null);
      else setProblem(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const active = state?.runs.find((r) => ACTIVE.includes(r.status));
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(load, 3000);
    return () => {
      clearInterval(id);
    };
  }, [active, load]);

  if (state === null) return <NotFoundPage />;
  if (state === undefined) {
    return <div className="wrap page-pad">{problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}</div>;
  }

  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12">
        <h1 className="h1 admin-title" tabIndex={-1}>Discovery</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={load}><Icon name="refresh" size="sm" />Refresh</button>
        <Link className="btn ghost sm" to="/admin"><Icon name="arrow-left" size="sm" />Admin</Link>
      </div>
      <p className="t2 narrow-text">
        Asks Blizzard’s WoW Forever API what it really returns, from real characters, with the keys in the key manager.
        Every answer is kept as it came, 404s included, and turned into a statistics catalog with suggestions for you to
        approve or reject. Approving doesn’t build anything yet: leaderboards and tiers are built later, from approved rows.
      </p>
      <div className="note small"><Icon name="info" /><span>Blizzard’s API terms allow keeping its data for at most 30 days, so runs, their raw responses and the catalog built from them are deleted once they’re older than the retention window (Admin → Data retention). Your decisions stay; the Blizzard text quoted in their reasoning goes with the run. Exports you download are copies of Blizzard data too: delete them within 30 days.</span></div>
      {notice && <div className={`note ${notice.ok ? 'ok' : 'err'} small`} role="status"><Icon name={notice.ok ? 'check' : 'error'} /><span>{notice.text}</span></div>}
      {!state.configured && (
        <div className="note warn small" role="alert"><Icon name="warning" /><span>The Blizzard API keys aren’t set. Enter them in the <Link to="/admin">admin key manager</Link> first.</span></div>
      )}
      <div className="grid-auto col-xl gap-24 align-start-grid">
        <AuthorizePanel grant={state.grant} configured={state.configured} onChanged={load} />
        <RunPanel state={state} active={active} onQueued={(run) => { setSelected(run.id); load(); toast.ok(`Run #${run.id} queued`, 'The worker starts it within about 30 seconds.'); }} onSettings={load} />
      </div>
      <CombinedSection key={`combined-${combinedVersion}-${state.runs.filter((r) => r.status === 'done').length}`} hasRuns={state.runs.some((r) => r.status === 'done')} onReanalysed={() => { setCombinedVersion((v) => v + 1); load(); }} focusStat={focusStat} onUnfocus={() => setFocusStat(null)} />
      <RunsSection runs={state.runs} selected={selected} onSelect={setSelected} />
      {selected && <RunDetail key={selected} runId={selected} listedStatus={state.runs.find((r) => r.id === selected)?.status} outerVersion={combinedVersion} onReanalysed={() => setCombinedVersion((v) => v + 1)} />}
    </div>
  );
}

const tallyText = (o) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${formatNumber(n)}`).join(' · ') || 'none';

/** Every finished run's statistics in one catalog: what the admin approves from. */
function CombinedSection({ hasRuns, onReanalysed, focusStat = null, onUnfocus }) {
  const toast = useToasts();
  const [combined, setCombined] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const [tab, setTab] = useState('suggestions');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api('/api/admin/discovery/catalog').then((r) => {
      if (live) setCombined(r.combined);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, []);
  const reanalyse = async () => {
    setBusy(true);
    try {
      const r = await api('/api/admin/discovery/reanalyse', { method: 'POST', body: {} });
      toast.ok('Every run re-analysed', `${r.combined.runs.length} run${r.combined.runs.length === 1 ? '' : 's'}, ${formatNumber(r.combined.catalogSize)} statistics. Your decisions still apply.`);
      onReanalysed();
    } catch (err) {
      toast.err('Couldn’t re-analyse', err.message);
      setBusy(false);
    }
  };
  if (!hasRuns) return null;
  const button = <Button className="sm ghost" loading={busy} onClick={reanalyse} title="Re-analyse every finished run with the current rules, from the stored responses, then rebuild this catalog. Asks Blizzard nothing."><Icon name="refresh" size="sm" />Re-analyse all runs</Button>;
  return (
    <section className="panel clip stack" aria-labelledby="combined-h">
      <div className="row gap-12 panel-head-row">
        <h2 className="h2 h2-panel" id="combined-h">All runs combined</h2>
        {combined && <span className="muted small">runs {combined.runs.map((id) => `#${id}`).join(', ')} · {formatNumber(combined.characters)} characters · analysed {formatDateTime(combined.analysedAt)} with v{combined.analysedWith}</span>}
        <span className="spacer" />
        {combined && <a className="btn sm" href="/api/admin/discovery/catalog/export.csv" download><Icon name="download" size="sm" />Catalog CSV</a>}
        {button}
      </div>
      {problem && <div className="pad-20"><div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div></div>}
      {combined === null && (
        <div className="pad-20">
          <EmptyState kind="nodata" compact title="Not built yet">
            <span>Re-analyse all runs (top right) to combine every finished run’s statistics here, from the responses already stored.</span>
          </EmptyState>
        </div>
      )}
      {combined && (
        <>
          <div className="pad-x-20 stack gap-4">
            <span className="small"><span className="muted">Rulesets sampled:</span> {tallyText(combined.rulesets)}</span>
            <span className="small"><span className="muted">Factions sampled:</span> {tallyText(combined.factions)}</span>
          </div>
          <div className="pad-x-20"><Tabs tabs={[{ id: 'suggestions', label: 'Suggestions' }, { id: 'catalog', label: 'Catalog', count: combined.catalogSize }]} value={tab} onChange={setTab} label="Combined catalog" idPrefix="comb" /></div>
          <div className="pad-20" role="tabpanel" id={`comb-panel-${tab}`} aria-labelledby={`comb-tab-${tab}`}>
            {tab === 'catalog' ? <Catalog runId={null} /> : <Suggestions runId={null} focusStat={focusStat} onUnfocus={onUnfocus} />}
          </div>
        </>
      )}
    </section>
  );
}

function AuthorizePanel({ grant, configured, onChanged }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(null);
  const authorize = async () => {
    setBusy('go');
    try {
      const { url } = await api('/api/admin/discovery/authorize', { method: 'POST', body: {} });
      window.location.assign(url);
    } catch (err) {
      toast.err('Couldn’t start Battle.net authorization', err.message);
      setBusy(null);
    }
  };
  const forget = async () => {
    setBusy('forget');
    try {
      await api('/api/admin/discovery/grant', { method: 'DELETE' });
      toast.ok('Battle.net token forgotten');
      onChanged();
    } catch (err) {
      toast.err('Couldn’t forget the token', err.message);
    }
    setBusy(null);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="auth-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="auth-h">Battle.net account</h2>
        <span className={`tag ${grant ? 'ok' : ''}`}>{grant ? 'Authorized' : 'Not authorized'}</span>
      </div>
      <p className="t2 small">
        Reading your own Forever characters (<span className="mono">/profile/user/wow</span>) needs a Battle.net token
        of yours. Your Everstats sign-in doesn’t keep one, so discovery asks for its own here. It is stored encrypted,
        used only by discovery runs, never shown, and deleted when Battle.net expires it (about a day).
      </p>
      {grant && (
        <div className="stack">
          <div className="kv"><span className="t2">BattleTag</span><span className="strong">{grant.battletag || '—'}</span></div>
          <div className="kv"><span className="t2">Authorized</span><span className="small">{formatDateTime(grant.createdAt)}</span></div>
          <div className="kv"><span className="t2">Expires</span><span className="small">{formatDateTime(grant.expiresAt)}</span></div>
          <div className="kv"><span className="t2">Scope</span><span className="mono small">{grant.scope || '—'}</span></div>
        </div>
      )}
      <div className="row gap-8">
        <Button className={grant ? 'sm' : 'gold sm'} loading={busy === 'go'} disabled={!configured} onClick={authorize}><Icon name="provider-account" size="sm" />{grant ? 'Authorize again' : 'Authorize with Battle.net'}</Button>
        {grant && <Button className="sm ghost" loading={busy === 'forget'} onClick={forget}>Forget token</Button>}
      </div>
    </section>
  );
}

function RunPanel({ state, active, onQueued, onSettings }) {
  const last = state.runs[0]?.options?.primary;
  const [name, setName] = useState(last?.name ?? '');
  const [surname, setSurname] = useState(last?.surname ?? '');
  const [account, setAccount] = useState(true);
  const [guild, setGuild] = useState(true);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { run } = await api('/api/admin/discovery/runs', { method: 'POST', body: { name, surname, account, guild } });
      onQueued(run);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="run-h">
      <h2 className="h2 h2-panel" id="run-h">Run discovery</h2>
      <form className="stack gap-14" onSubmit={start}>
        <div className="grid-auto col-md gap-12">
          <Field label="Primary character: name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Field label="Surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
        </div>
        <Toggle checked={account} onChange={setAccount}>
          <span className="small">Every character on the authorized Battle.net account{!state.grant && account ? ' (not authorized: this step will be skipped, and the run will say so)' : ''}</span>
        </Toggle>
        <Toggle checked={guild} onChange={setGuild}><span className="small">The primary character’s guild, and its roster as more samples</span></Toggle>
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        <div className="row gap-10">
          <Button type="submit" className="gold" loading={busy} disabled={Boolean(active) || !state.configured}><Icon name="play" size="sm" />Run discovery</Button>
          {active && <span className="t2 small">Run #{active.id} is {active.status === 'queued' ? 'waiting for the worker' : `running: ${active.progress?.phase ?? '…'}`}.</span>}
        </div>
      </form>
      {state.settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={onSettings} />)}
    </section>
  );
}

function RunsSection({ runs, selected, onSelect }) {
  return (
    <section className="panel clip" aria-labelledby="runs-h">
      <div className="row gap-12 panel-head-row"><h2 className="h2 h2-panel" id="runs-h">Runs</h2></div>
      {runs.length === 0 ? (
        <div className="pad-20"><EmptyState kind="nodata" compact title="No discovery run yet"><span>Enter the primary character above and press Run discovery.</span></EmptyState></div>
      ) : (
        <div className="tblbox">
          <table className="tbl">
            <thead><tr><th scope="col">Run</th><th scope="col">Asked</th><th scope="col">Status</th><th scope="col">Primary</th><th scope="col" className="r">Requests</th><th scope="col" className="r">Statistics</th><th scope="col" className="r">Took</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={r.id === selected ? 'me' : undefined}>
                  <td className="strong">#{r.id}</td>
                  <td className="t2">{formatDateTime(r.requestedAt)}</td>
                  <td><span className={`tag ${RUN_TAG[r.status]}`}>{r.status}</span></td>
                  <td>{r.options?.primary ? `${r.options.primary.name} ${r.options.primary.surname}` : '—'}</td>
                  <td className="r">{formatNumber(r.requests ?? r.progress?.requests)}</td>
                  <td className="r">{formatNumber(r.catalogSize)}</td>
                  <td className="r t2">{duration(r.wallMs)}</td>
                  <td className="r"><button type="button" className="btn sm ghost" aria-pressed={r.id === selected} onClick={() => onSelect(r.id)}>{r.id === selected ? 'Shown' : 'Show'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunDetail({ runId, listedStatus, outerVersion, onReanalysed }) {
  const [run, setRun] = useState(null);
  const [problem, setProblem] = useState(null);
  const [tab, setTab] = useState('overview');
  const [reanalysing, setReanalysing] = useState(false);
  const [version, setVersion] = useState(0); // bumps after a re-analysis, so the catalog tabs load afresh
  const toast = useToasts();
  const reanalyse = async () => {
    setReanalysing(true);
    try {
      setRun((await api(`/api/admin/discovery/runs/${runId}/reanalyse`, { method: 'POST', body: {} })).run);
      setVersion((v) => v + 1);
      toast.ok(`Run #${runId} re-analysed`, 'Catalog, suggestions and answers now follow the current rules, and the combined catalog with them. Your decisions still apply.');
      onReanalysed?.();
    } catch (err) {
      toast.err('Couldn’t re-analyse', err.message);
    }
    setReanalysing(false);
  };
  useEffect(() => {
    let live = true;
    api(`/api/admin/discovery/runs/${runId}`).then((r) => {
      if (live) setRun(r.run);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, [runId, listedStatus, outerVersion]);

  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!run) return null;
  if (run.status === 'queued') {
    return <EmptyState kind="nodata" title={`Run #${run.id} is queued`}><span>The worker picks it up within about 30 seconds. This page follows it.</span></EmptyState>;
  }
  if (run.status === 'running') {
    const p = run.progress ?? {};
    return (
      <section className="panel pad-20 stack gap-12" aria-live="polite">
        <h2 className="h2 h2-panel">Run #{run.id} is running</h2>
        <div className="kv"><span className="t2">Now</span><span className="strong">{p.phase ?? '…'}</span></div>
        <div className="kv"><span className="t2">Requests so far</span><span>{formatNumber(p.requests)}</span></div>
        <div className="kv"><span className="t2">Characters fetched</span><span>{formatNumber(p.characters)} of {formatNumber(Math.min(run.options.maxCharacters, p.queued ?? 0))} found so far (cap {formatNumber(run.options.maxCharacters)})</span></div>
        <div className="kv"><span className="t2">Last heartbeat</span><span className="small">{timeAgo(run.heartbeatAt) ?? '—'}</span></div>
      </section>
    );
  }
  if (!run.summary) {
    return <div className="note err" role="alert"><Icon name="error" /><div className="stack gap-4"><b>Run #{run.id} {run.status}</b><span className="small">{run.problem ?? 'No reason was recorded.'}</span></div></div>;
  }
  const tabs = [
    { id: 'overview', label: 'Answers' },
    { id: 'endpoints', label: 'Endpoints', count: run.summary.endpoints.length },
    { id: 'catalog', label: 'Catalog', count: run.summary.catalogSize },
    { id: 'suggestions', label: 'Suggestions' },
    { id: 'responses', label: 'Raw responses', count: run.summary.requests },
  ];
  return (
    <section className="panel clip stack" aria-labelledby="detail-h">
      <div className="row gap-12 panel-head-row">
        <h2 className="h2 h2-panel" id="detail-h">Run #{run.id}</h2>
        <span className="muted small">{run.options.primary.name} {run.options.primary.surname} · finished {formatDateTime(run.finishedAt)} · analysed {run.summary.analysedWith ? `with v${run.summary.analysedWith}` : 'by v0.3.0'}</span>
        <span className="spacer" />
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.json`} download><Icon name="download" size="sm" />JSON</a>
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.csv`} download><Icon name="download" size="sm" />Catalog CSV</a>
        <Button className="sm ghost" loading={reanalysing} onClick={reanalyse} title="Rebuild the catalog, suggestions and answers with the current rules, from the stored responses. Asks Blizzard nothing."><Icon name="refresh" size="sm" />Re-analyse</Button>
      </div>
      <div className="pad-x-20"><Tabs tabs={tabs} value={tab} onChange={setTab} label="Run details" idPrefix="disc" /></div>
      <div className="pad-20" role="tabpanel" id={`disc-panel-${tab}`} aria-labelledby={`disc-tab-${tab}`}>
        {tab === 'overview' && <Answers run={run} />}
        {tab === 'endpoints' && <Endpoints summary={run.summary} />}
        {tab === 'catalog' && <Catalog key={`${version}-${outerVersion}`} runId={run.id} />}
        {tab === 'suggestions' && <Suggestions key={`${version}-${outerVersion}`} runId={run.id} />}
        {tab === 'responses' && <Responses runId={run.id} />}
      </div>
    </section>
  );
}

function Q({ title, children }) {
  return (
    <div className="stack gap-8 disc-q">
      <h3 className="h3">{title}</h3>
      {children}
    </div>
  );
}

function Answers({ run }) {
  const s = run.summary;
  const n = s.characters.length;
  const rate = Object.entries(s.rateHeaders);
  const primary = s.characters[0];
  return (
    <div className="stack gap-24">
      <div className="grid-auto col-md gap-12">
        <Figure label="Requests" value={formatNumber(s.requests)} note={`${formatNumber(s.retried)} retried · ${formatNumber(s.throttled)} answered 429`} />
        <Figure label="Characters fetched" value={formatNumber(n)} note={`cap ${formatNumber(run.options.maxCharacters)}`} />
        <Figure label="Latency p50 / p95" value={`${ms(s.latency.p50Ms)} / ${ms(s.latency.p95Ms)}`} note={`mean ${ms(s.latency.meanMs)} · max ${ms(s.latency.maxMs)}`} />
        <Figure label="Wall time" value={duration(s.wallMs)} note={`${run.options.requestsPerSecond} requests a second allowed`} />
      </div>

      <Q title="Rulesets sampled (from each character's profile)">
        {s.rulesetsSampled
          ? <span className="small">{Object.entries(s.rulesetsSampled).map(([k, n]) => `${k}: ${n} character${n === 1 ? '' : 's'}`).join(' · ') || 'No character answered.'}</span>
          : <span className="t2 small">Not recorded by the analysis this run was made with. Re-analyse it (top right) to read each character's ruleset from its stored profile.</span>}
      </Q>

      <Q title="Rulesets (as Blizzard names them)">
        {s.rulesets.listed.length === 0 ? <span className="t2 small">The ruleset index answered {s.rulesets.indexStatus ?? 'nothing'} and listed none.</span> : (
          <div className="tblbox listbox"><table className="tbl"><thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Fields</th></tr></thead><tbody>
            {s.rulesets.listed.map((r) => <tr key={`${r.id}|${r.name}`}><td className="mono">{String(r.id)}</td><td className="strong">{String(r.name ?? '—')}</td><td>{typeof r.type === 'object' ? JSON.stringify(r.type) : String(r.type ?? '—')}</td><td className="mono xsmall">{r.keys.join(', ')}</td></tr>)}
          </tbody></table></div>
        )}
      </Q>

      <Q title="Namespaces">
        <div className="stack">
          <div className="kv"><span className="t2">Dynamic</span><span className="mono small">{s.namespaces.dynamic}</span></div>
          <div className="kv"><span className="t2">Profile</span><span className="mono small">{s.namespaces.profile}</span></div>
          <div className="kv"><span className="t2">Static (detected)</span><span className="mono small">{s.namespaces.staticDetected ?? 'not detected'}</span></div>
        </div>
        <span className="muted xsmall">{s.namespaces.staticNote} Every namespace seen in a link: {Object.keys(s.namespaceLinks).join(', ') || 'none'}.</span>
      </Q>

      <Q title="Forever-only systems: Camping, Legacy, Housing, Skyborne">
        {s.foreverInCatalog.map((t) => {
          const hits = s.foreverTerms.find((x) => x.id === t.id)?.hits ?? [];
          return (
            <div key={t.id} className="stack gap-4">
              <b>{t.label}</b>
              {t.statistics.length
                ? <span className="small">Statistics: {t.statistics.map((x) => `${x.name} (id ${x.id}, ${x.category || 'no category'})`).join('; ')}</span>
                : <span className="t2 small">No statistic’s name or category mentions it, across {formatNumber(Math.max(0, ...Object.values(s.catalogSamples)))} sampled statistics responses.</span>}
              <span className="muted xsmall">{hits.length ? `Mentioned ${hits.length} times elsewhere, e.g. ${hits.slice(0, 4).map((h) => `${h.endpoint}: “${h.value}”`).join(' · ')}` : 'Not mentioned in any other response.'}</span>
            </div>
          );
        })}
        {s.termHitsCapped && <span className="muted xsmall">The mention list stopped at its cap; the JSON export has every hit recorded.</span>}
      </Q>

      <Q title="How Blizzard addresses a character (slugs)">
        <div className="tblbox listbox"><table className="tbl"><thead><tr><th scope="col">Tried</th><th scope="col">Path</th><th scope="col">Answer</th></tr></thead><tbody>
          <tr><td>name-surname, lower case (our slug)</td><td className="mono xsmall">{primary.path}</td><td><span className={`tag ${statusTag(primary.status)}`}>{primary.status ?? 'no answer'}</span></td></tr>
          {s.slugs.probes.map((p) => <tr key={p.id}><td>{p.label}</td><td className="mono xsmall">{p.path}</td><td><span className={`tag ${statusTag(p.status)}`}>{p.status ?? 'no answer'}</span>{p.name ? <span className="t2 small"> {p.name}</span> : null}</td></tr>)}
        </tbody></table></div>
        <span className="small">
          Blizzard’s own links to {formatNumber(s.slugs.findings.seen)} characters: {s.slugs.findings.withMoreThanOneHyphen.length} with more than one hyphen
          {s.slugs.findings.withMoreThanOneHyphen.length ? ` (${s.slugs.findings.withMoreThanOneHyphen.slice(0, 5).join(', ')})` : ''}, {s.slugs.findings.withSpace.length} with a space, {s.slugs.findings.withApostrophe.length} with an apostrophe, {s.slugs.findings.withUppercase.length} with capitals, {s.slugs.findings.withNonAscii.length} with non-ASCII letters.
        </span>
        <span className="muted xsmall">Examples: {s.slugs.findings.examples.join(', ') || 'none'}</span>
      </Q>

      <Q title="The Battle.net account (/profile/user/wow)">
        {!s.account.asked ? <span className="t2 small">Not asked for in this run.</span> : !s.account.authorized ? <span className="t2 small">Skipped: Battle.net wasn’t authorized when the run started.</span> : (
          <div className="stack gap-6">
            <div className="kv"><span className="t2">Answer</span><span className={`tag ${statusTag(s.account.status)}`}>{s.account.status ?? 'no answer'}</span></div>
            <div className="kv"><span className="t2">Characters listed</span><span>{formatNumber(s.account.characters.length)}</span></div>
            <div className="kv"><span className="t2">Realm-based like retail?</span><span>{s.account.realmShaped === null ? `unknown from ${s.account.characters.length} samples` : s.account.realmShaped ? 'Yes: entries carry a realm' : 'No: no entry has a realm field'}</span></div>
            {s.account.characters[0] && <span className="muted xsmall">Fields on each entry: {s.account.characters[0].keys.join(', ')}</span>}
          </div>
        )}
      </Q>

      <Q title="Freshness">
        {s.freshness.filter((f) => f.subject === primary.path).length === 0
          ? <span className="t2 small">The primary character’s profile has no timestamp-like field (unknown from 1 sample).</span>
          : s.freshness.filter((f) => f.subject === primary.path).map((f) => <div key={`${f.endpoint}|${f.field}`} className="kv"><span className="mono small">{f.endpoint} · {f.field}</span><span className="small">{f.iso ? `${formatDateTime(f.iso)} (fetched ${formatDateTime(f.fetchedAt)})` : String(f.raw)}</span></div>)}
        <span className="muted xsmall">Compare these with when you last logged out of {run.options.primary.name}.</span>
      </Q>

      <Q title={`Character media for ${run.options.primary.name} ${run.options.primary.surname}`}>
        <span className="small">{s.primaryMedia.status === 200 ? `Available: ${(s.primaryMedia.assets ?? []).join(', ') || 'answered, with no assets listed'}` : `Not available: answered ${s.primaryMedia.status ?? 'nothing'}.`}</span>
      </Q>

      <Q title="Rate-limit headers">
        {rate.length === 0 ? <span className="t2 small">None of the {formatNumber(s.requests)} responses carried a header named like a rate limit or quota.</span> : (
          <div className="tblbox listbox"><table className="tbl"><thead><tr><th scope="col">Header</th><th scope="col" className="r">Seen</th><th scope="col">First</th><th scope="col">Last</th><th scope="col">Range</th></tr></thead><tbody>
            {rate.map(([k, h]) => <tr key={k}><td className="mono small">{k}</td><td className="r">{formatNumber(h.count)}</td><td className="mono small">{h.first}</td><td className="mono small">{h.last}</td><td className="small">{h.numericMin !== null ? `${formatNumber(h.numericMin)}–${formatNumber(h.numericMax)}` : h.values.slice(0, 3).join(' · ')}</td></tr>)}
          </tbody></table></div>
        )}
        <details className="small"><summary className="muted">Every response header name seen</summary><span className="mono xsmall">{Object.entries(s.headerNames).map(([k, c]) => `${k} (${c})`).join(', ')}</span></details>
      </Q>

      <Q title="Guild">
        <span className="small">
          {!s.guild.inProfile ? 'The primary’s profile has no guild field.' : !s.guild.linked ? `In a guild${s.guild.name ? ` (${s.guild.name})` : ''}, but the profile gives no link to it.` : !s.guild.asked ? `${s.guild.name ?? 'A guild'} is linked; not fetched in this run.` : `${s.guild.name ?? 'Guild'}: profile answered ${s.guild.status ?? 'nothing'}, roster listed ${s.guild.members ?? 'no'} members.`}
        </span>
      </Q>

      <Q title="Characters sampled">
        <div className="tblbox listbox"><table className="tbl"><thead><tr><th scope="col">Path</th><th scope="col">From</th><th scope="col">Profile</th><th scope="col">Name</th><th scope="col" className="r">Level</th><th scope="col">Class</th><th scope="col">Race</th><th scope="col">Faction</th><th scope="col">Ruleset</th></tr></thead><tbody>
          {s.characters.map((c) => <tr key={c.path}><td className="mono xsmall">{c.path}</td><td>{c.source}</td><td><span className={`tag ${statusTag(c.status)}`}>{c.status ?? 'no answer'}</span></td><td>{c.name ?? '—'}</td><td className="r">{c.level ?? '—'}</td><td>{c.className ?? '—'}</td><td>{c.race ?? '—'}</td><td>{c.faction ?? '—'}</td><td>{c.ruleset ? `${c.ruleset.name ?? '?'} (${c.ruleset.id ?? '?'})` : '—'}</td></tr>)}
        </tbody></table></div>
      </Q>
    </div>
  );
}

function Figure({ label, value, note }) {
  return (
    <div className="panel pad-16 stack gap-4 disc-figure">
      <span className="muted xsmall">{label}</span>
      <span className="strong disc-figure-value">{value}</span>
      <span className="t2 xsmall">{note}</span>
    </div>
  );
}

function Endpoints({ summary }) {
  const rows = [...summary.endpoints].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="tblbox listbox">
      <table className="tbl">
        <thead><tr><th scope="col">Endpoint</th><th scope="col">Answers</th><th scope="col" className="r">Requests</th><th scope="col" className="r">p50</th><th scope="col" className="r">p95</th><th scope="col" className="r">Mean size</th><th scope="col">Token</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="mono small">{e.id}</td>
              <td><div className="row gap-4">{Object.entries(e.statuses).map(([code, c]) => <span key={code} className={`tag ${statusTag(code)}`}>{code} × {c}</span>)}{Object.keys(e.errors).length > 0 && <span className="muted xsmall">{Object.keys(e.errors).join(', ')}</span>}</div></td>
              <td className="r">{formatNumber(e.requests)}</td>
              <td className="r">{ms(e.p50Ms)}</td>
              <td className="r">{ms(e.p95Ms)}</td>
              <td className="r">{formatBytes(e.meanBytes) ?? '—'}</td>
              <td className="t2 small">{e.auth.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A catalog to show: one run's (runId), or the combined catalog of every finished run (runId null). Decisions are the
// statistic's, so the same decision shows in both; the request just says which view to send back.
const catalogUrl = (runId) => (runId === null ? '/api/admin/discovery/catalog' : `/api/admin/discovery/runs/${runId}/catalog`);
const decisionScope = (runId) => (runId === null ? { combined: true } : { runId });

function useCatalog(runId) {
  const [catalog, setCatalog] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    let live = true;
    api(catalogUrl(runId)).then((r) => {
      if (live) setCatalog(r.catalog);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, [runId]);
  const replace = useCallback((stat) => setCatalog((cur) => cur.map((s) => (s.statisticId === stat.statisticId ? stat : s))), []);
  return { catalog, problem, replace };
}

// Must match server/discovery/analyze.js VALUE_TYPES (the server refuses anything else).
const VALUE_TYPES = ['count', 'name-and-number', 'highest-ever', 'rate', 'time', 'gold', 'distance', 'decimal', 'text'];
const TYPE_LABEL = { 'name-and-number': 'name + number' };
const typeLabel = (t) => TYPE_LABEL[t] ?? t;

function TypeTag({ stat }) {
  return (
    <span className="row gap-4 nowrap">
      <span className="tag" title={stat.valueTypeBasis}>{typeLabel(stat.valueType)}</span>
      {stat.valueTypeGuessed ? <span className="tag warn" title={stat.valueTypeBasis}>guessed</span> : stat.valueTypeSetBy === 'admin' ? <span className="tag ok" title={stat.valueTypeBasis}>set by you</span> : null}
    </span>
  );
}
const catPath = (s) => s.categoryPath.map((c) => c.name).join(' › ');
const SORTS = {
  id: (s) => s.statisticId,
  name: (s) => s.name.toLowerCase(),
  category: (s) => catPath(s).toLowerCase(),
  type: (s) => s.valueType,
  present: (s) => s.charactersPresent,
  nonzero: (s) => s.charactersNonzero,
  max: (s) => s.maxValue ?? -Infinity,
};
const PAGE = 200;

function Catalog({ runId }) {
  const { catalog, problem } = useCatalog(runId);
  const [sort, setSort] = useState({ key: 'category', dir: 1 });
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    if (!catalog) return [];
    const f = filter.trim().toLowerCase();
    const key = SORTS[sort.key];
    return catalog
      .filter((s) => !f || s.name.toLowerCase().includes(f) || catPath(s).toLowerCase().includes(f) || String(s.statisticId) === f)
      .sort((a, b) => (key(a) < key(b) ? -sort.dir : key(a) > key(b) ? sort.dir : a.statisticId - b.statisticId));
  }, [catalog, filter, sort]);
  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!catalog) return <span className="t2 small" role="status">Loading the catalog…</span>;
  if (catalog.length === 0) return <EmptyState kind="nodata" compact title="No statistics in this run"><span>No catalog endpoint answered with anything shaped like a statistic. The Endpoints tab shows what each one answered.</span></EmptyState>;
  const th = (key, label, r = false) => (
    <th scope="col" className={r ? 'r' : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>{label}{sort.key === key && <Icon name={sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size="sm" />}</button>
    </th>
  );
  return (
    <div className="stack gap-14">
      <div className="row gap-12">
        <Field label="Filter by name, category or ID" className="grow-col" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }} autoComplete="off" />
        <span className="t2 small">{formatNumber(rows.length)} of {formatNumber(catalog.length)} statistics</span>
      </div>
      <span className="muted xsmall">
        A type marked “guessed” comes from the name, or is the default; correct it under Suggestions → Guessed types (hover a type for its basis).
        “Has it” counts sampled characters whose response listed the statistic; “Non-zero” those with a value above zero.
        {runId === null && ' A character sampled by more than one run counts once, with its newest values.'}
      </span>
      <div className="tblbox listbox">
        <table className="tbl disc-catalog">
          <thead><tr>{th('id', 'ID')}{th('name', 'Statistic')}{th('category', 'Blizzard category')}{th('type', 'Type')}{runId === null && <th scope="col">Runs</th>}{th('present', 'Has it', true)}{th('nonzero', 'Non-zero', true)}<th scope="col" className="r">Min · median</th>{th('max', 'Max', true)}</tr></thead>
          <tbody>
            {rows.slice(0, shown).map((s) => (
              <tr key={s.statisticId}>
                <td className="mono small">{s.statisticId}</td>
                <td className="strong">{s.name}</td>
                <td className="t2 small">{catPath(s) || '—'}</td>
                <td><TypeTag stat={s} /></td>
                {runId === null && <td className="mono xsmall">{s.fromProduction ? 'production' : s.runs.map((id) => `#${id}`).join(' ')}</td>}
                <td className="r">{s.charactersPresent} / {s.charactersSampled}</td>
                <td className="r">{s.charactersNonzero}</td>
                <td className="r t2">{formatNumber(s.minValue)} · {formatNumber(s.medianValue)}</td>
                <td className="r">{formatNumber(s.maxValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <button type="button" className="btn sm self-start" onClick={() => setShown((n) => n + PAGE)}>Show {formatNumber(Math.min(PAGE, rows.length - shown))} more</button>}
    </div>
  );
}

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

function Suggestions({ runId, focusStat = null, onUnfocus = null }) {
  const { catalog, problem, replace } = useCatalog(runId);
  const [view, setView] = useState(focusStat ? 'all' : 'pending');
  const [shown, setShown] = useState(50);
  const names = useMemo(() => new Map((catalog ?? []).map((s) => [s.statisticId, s.name])), [catalog]);
  const rows = useMemo(() => (catalog ?? [])
    .filter((s) => focusStat === null || s.statisticId === focusStat)
    .map((s) => ({ ...s, visible: s.suggestions.filter(inView(view)) }))
    .filter((s) => (view === 'types' ? s.valueTypeGuessed : s.visible.length)), [catalog, view, focusStat]);
  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!catalog) return <span className="t2 small" role="status">Loading suggestions…</span>;
  return (
    <div className="stack gap-14">
      <p className="t2 small">
        Suggestions, not decisions: each says why. Approve the ones you agree with; a rejected suggestion isn’t offered
        again (unless more samples change it). “Unknown” means the samples can’t settle it yet, so there’s nothing to approve.
        Nothing here becomes a leaderboard or tier category until those are built, from approved rows only.
        A possible duplicate stops counting toward tiers only once you approve the pairing. Your decisions belong to the
        statistic, so they show in every run and in the combined catalog, and survive re-analysis.
      </p>
      {focusStat !== null && (
        <div className="note small" role="status"><Icon name="filter" /><span className="grow">Showing statistic id {focusStat} only (from Tiers → What counts).</span>{onUnfocus && <button type="button" className="btn sm ghost" onClick={onUnfocus}>Show every statistic</button>}</div>
      )}
      <Segmented options={VIEWS} value={view} onChange={(v) => { setView(v); setShown(50); }} label="Which suggestions" />
      {view === 'types' && <span className="muted xsmall">Every statistic whose value type is still a guess. Confirm it or choose another; your choice replaces the guess from then on.</span>}
      {rows.length === 0 ? (
        <EmptyState kind="nodata" compact title="Nothing in this view" />
      ) : (
        <div className="listbox">
          {rows.slice(0, shown).map((s) => <SuggestionRow key={s.statisticId} runId={runId} stat={s} nameOf={(id) => names.get(id)} showType={view === 'types' || view === 'all'} onChanged={replace} />)}
        </div>
      )}
      {rows.length > shown && <button type="button" className="btn sm self-start" onClick={() => setShown((n) => n + 50)}>Show more ({formatNumber(rows.length - shown)} left)</button>}
    </div>
  );
}

function SuggestionRow({ runId, stat, nameOf, showType, onChanged }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(null);
  const decide = async (kind, decision, value) => {
    setBusy(`${kind}|${decision}`);
    try {
      const { statistic } = await api('/api/admin/discovery/decisions', { method: 'PUT', body: { ...decisionScope(runId), statisticId: stat.statisticId, kind, decision, ...(value !== undefined ? { value } : {}) } });
      onChanged(statistic);
    } catch (err) {
      toast.err('Couldn’t save that decision', err.message);
    }
    setBusy(null);
  };
  return (
    <div className="stack gap-10 pad-16">
      <div className="row gap-8">
        <b>{stat.name}</b>
        <span className="mono muted xsmall">id {stat.statisticId}</span>
        <span className="t2 xsmall">{catPath(stat) || 'no category'}</span>
        {runId === null && <span className="muted xsmall">{stat.fromProduction ? 'seen by the production crawler, in no discovery run' : `runs ${stat.runs.map((id) => `#${id}`).join(' ')}`}</span>}
      </div>
      {showType && <ValueTypeRow stat={stat} busy={busy} onSet={(value) => decide('value_type', 'approved', value)} onClear={() => decide('value_type', 'cleared')} />}
      {stat.visible.map((s) => (
        <div key={s.kind} className="row gap-12 align-start disc-sug">
          <div className="stack gap-4 grow">
            <span className="small"><span className="muted">{KIND_LABEL[s.kind]}:</span> <b>{valueLabel(s, nameOf)}</b>{s.decision && <span className={`tag ${s.decision === 'approved' ? 'ok' : 'err'} disc-decision`}>{s.decision}</span>}{s.stale && <span className="tag warn disc-decision">no longer supported</span>}</span>
            <span className="t2 xsmall">{s.reasoning}</span>
          </div>
          <div className="row gap-6">
            {s.value !== null && !s.decision && (
              <>
                <Button className="sm" loading={busy === `${s.kind}|approved`} onClick={() => decide(s.kind, 'approved')}><Icon name="check" size="sm" />Approve</Button>
                <Button className="sm ghost" loading={busy === `${s.kind}|rejected`} onClick={() => decide(s.kind, 'rejected')}><Icon name="close" size="sm" />Reject</Button>
              </>
            )}
            {s.decision && <Button className="sm ghost" loading={busy === `${s.kind}|cleared`} onClick={() => decide(s.kind, 'cleared')}>Undo</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The statistic's value type: the analysis's guess, or the admin's choice, which persists across re-analyses. */
function ValueTypeRow({ stat, busy, onSet, onClear }) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(stat.valueType);
  return (
    <div className="row gap-12 align-start disc-sug">
      <div className="stack gap-6 grow">
        <span className="small row gap-6"><span className="muted">Value type:</span> <TypeTag stat={stat} /></span>
        <span className="t2 xsmall">{stat.valueTypeBasis}</span>
        {editing && (
          <div className="stack gap-8">
            <Segmented options={VALUE_TYPES.map((t) => ({ id: t, label: typeLabel(t) }))} value={choice} onChange={setChoice} label={`Value type for ${stat.name}`} />
            <div className="row gap-6">
              <Button className="sm" loading={busy === 'value_type|approved'} onClick={async () => { await onSet(choice); setEditing(false); }}><Icon name="check" size="sm" />{choice === stat.valueType ? 'Confirm' : 'Save'}</Button>
              <Button className="sm ghost" onClick={() => { setChoice(stat.valueType); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
      {!editing && (
        <div className="row gap-6">
          {stat.valueTypeGuessed && <Button className="sm" loading={busy === 'value_type|approved'} onClick={() => onSet(stat.valueType)}><Icon name="check" size="sm" />Confirm</Button>}
          <Button className="sm ghost" onClick={() => { setChoice(stat.valueType); setEditing(true); }}>Change</Button>
          {stat.valueTypeSetBy === 'admin' && <Button className="sm ghost" loading={busy === 'value_type|cleared'} onClick={onClear}>Undo</Button>}
        </div>
      )}
    </div>
  );
}

const MAX_SHOWN_BODY = 200_000;

function Responses({ runId }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(0);
  const [problem, setProblem] = useState(null);
  const [open, setOpen] = useState(null);
  const more = useCallback(async (after) => {
    try {
      const r = await api(`/api/admin/discovery/runs/${runId}/responses?limit=100&after=${after}`);
      setRows((cur) => (after === 0 ? r.responses : [...cur, ...r.responses]));
      setNext(r.nextAfter);
    } catch (err) {
      setProblem(err.message);
    }
  }, [runId]);
  useEffect(() => {
    more(0);
  }, [more]);
  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  return (
    <div className="stack gap-14">
      <span className="muted xsmall">Every request this run made, in order, as Blizzard answered. Request headers (which carry the tokens) are never stored.</span>
      <div className="tblbox listbox">
        <table className="tbl">
          <thead><tr><th scope="col">#</th><th scope="col">Endpoint</th><th scope="col">Path</th><th scope="col">Answer</th><th scope="col" className="r">Latency</th><th scope="col" className="r">Size</th><th scope="col"><span className="sr-only">Body</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={open === r.id ? 'me' : undefined}>
                <td className="mono xsmall">{r.id}</td>
                <td className="mono xsmall">{r.endpoint}</td>
                <td className="mono xsmall">{r.path}</td>
                <td><span className={`tag ${statusTag(r.status)}`}>{r.status ?? r.error ?? 'no answer'}</span>{r.attempts > 1 && <span className="muted xsmall"> {r.attempts} tries</span>}</td>
                <td className="r">{ms(r.latency_ms)}</td>
                <td className="r">{formatBytes(r.bytes) ?? '—'}</td>
                <td className="r"><button type="button" className="btn sm ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'View'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next !== null && <button type="button" className="btn sm self-start" onClick={() => more(next)}>Load 100 more</button>}
      {open && <ResponseBody id={open} />}
    </div>
  );
}

function ResponseBody({ id }) {
  const [row, setRow] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/api/admin/discovery/responses/${id}`).then((r) => {
      if (live) setRow(r.response);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const text = useMemo(() => {
    if (!row?.body) return null;
    if (row.body.length > 2_000_000) return row.body.slice(0, MAX_SHOWN_BODY);
    try {
      return JSON.stringify(JSON.parse(row.body), null, 2).slice(0, MAX_SHOWN_BODY);
    } catch {
      return row.body.slice(0, MAX_SHOWN_BODY);
    }
  }, [row]);
  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!row) return <span className="t2 small" role="status">Loading response #{id}…</span>;
  return (
    <div className="panel pad-16 stack gap-10">
      <div className="row gap-10">
        <b>#{row.id} · {row.endpoint}</b>
        <span className="mono xsmall t2">{row.path}{row.namespace ? `?namespace=${row.namespace}` : ''}</span>
        <span className="spacer" />
        <a className="btn sm" href={`/api/admin/discovery/responses/${row.id}?download=1`} download><Icon name="download" size="sm" />Raw body</a>
      </div>
      <span className="muted xsmall">Fetched {formatDateTime(row.fetched_at)} with the {row.auth === 'user' ? 'Battle.net user' : 'app'} token · {row.content_type ?? 'no content type'}{row.truncated ? ' · cut at 8 MB when stored' : ''}{text && row.body.length > MAX_SHOWN_BODY ? ' · showing the first 200 KB here; the download is complete' : ''}</span>
      <details className="small"><summary className="muted">Response headers</summary><pre className="disc-pre">{JSON.stringify(row.headers, null, 2)}</pre></details>
      {text === null ? <span className="t2 small">No body{row.error ? `: ${row.error}` : ''}.</span> : <pre className="disc-pre">{text}</pre>}
    </div>
  );
}
