import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Toggle } from '../components/Controls.jsx';
import { EmptyState, Fresh } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { AuthCard } from '../pages/SignInPages.jsx';
import { passkeyRegister, passkeySignIn, wasCancelled } from '../passkeyClient.js';
import { useCoverage } from '../useCoverage.js';
import { PlayersSection, ReservedSection } from './PlayersSection.jsx';
import { RetentionSection } from './RetentionSection.jsx';
import { ActivitySection } from './ActivitySection.jsx';
import { CardsSection } from './CardsSection.jsx';

/**
 * The admin area (design/v1/pages/admin). Not linked from anywhere. Without an admin session, /admin sends the browser
 * to /admin/sign-in (owner's decision, 0.4.0); the admin API itself still answers a plain 404 to anyone without one.
 *
 * Different from the mockup, on purpose (CLAUDE.md rules win):
 *   - Keys show state, source and "set on" only: no masked value and no last four. Nothing about a key is sent here.
 *   - No admin link in the public top bar (the mockup has one "for the owner"): the admin isn't an account.
 *   - The crawler shows only what is measured: the queue by priority, the worker's own count of its requests over the
 *     last 60 minutes (in memory, so it restarts at 0 with the worker), every Blizzard request in the current UTC hour
 *     (crawler_hours, sign-in reads included; 0.7.1: really the current hour, not the newest stored one), characters checked and fetched today, the last error, back-offs, and Pause. No
 *     "Run now": the crawl never stops, and a person's lookup always goes first.
 *   - Per-ruleset grading progress needs rulesets, which come from Blizzard (not loaded yet), so it says so.
 * Added: Backups (nightly pg_dump), Proxy addresses (where CF-Connecting-IP arrives from, for TRUSTED_PROXIES) and
 * links to Discovery (DiscoveryPage.jsx), the Blizzard API discovery pass, and Tiers (TiersAdminPage.jsx, 0.6.0).
 */
export function AdminPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setState(await api('/api/admin/state'));
    } catch (err) {
      if (err.status === 404) setState(null);
      else setProblem(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state === null) navigate('/admin/sign-in', { replace: true });
  }, [state, navigate]);
  if (state === null) return null;
  if (state === undefined) {
    return <div className="wrap page-pad">{problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}</div>;
  }

  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12">
        <h1 className="h1 admin-title">Admin</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <Link className="btn sm" to="/admin/accounts"><Icon name="user" size="sm" />Accounts</Link>
        <Link className="btn sm" to="/admin/reports"><Icon name="warning" size="sm" />Reports{state.openReports > 0 ? ` · ${state.openReports}` : ''}</Link>
        <Link className="btn sm" to="/admin/feedback"><Icon name="provider-chat" size="sm" />Feedback</Link>
        <Link className="btn sm" to="/admin/badges"><Icon name="check" size="sm" />Badges</Link>
        <Link className="btn sm" to="/admin/guild-badges"><Icon name="guild" size="sm" />Guild badges</Link>
        <Link className="btn sm" to="/admin/guild-links"><Icon name="guild" size="sm" />Guild links</Link>
        <Link className="btn sm" to="/admin/tiers"><Icon name="chart" size="sm" />Tiers</Link>
        <Link className="btn sm" to="/admin/discovery"><Icon name="search" size="sm" />Discovery</Link>
        <button type="button" className="btn ghost sm" onClick={load}><Icon name="refresh" size="sm" />Refresh</button>
        <button type="button" className="btn ghost sm" onClick={async () => { await api('/api/admin/sign-out', { method: 'POST', body: {} }); navigate('/'); }}>Sign out of admin</button>
      </div>
      {state.creatorAlerts > 0 && (
        <div className="note warn small" role="status"><Icon name="warning" /><span className="flex-fill">{state.creatorAlerts === 1 ? 'A verified creator changed a handle' : `${state.creatorAlerts} verified creators changed a handle`}: its Verified mark is already off; the badge stays until you decide.</span><Link className="btn sm" to="/admin/badges#creators">Check</Link></div>
      )}
      <ActivitySection />
      <KeysSection credentials={state.credentials} onSaved={load} />
      <div className="grid-auto col-xl gap-24 align-start-grid">
        <GradingSection settings={state.settings} onSaved={(settings) => setState((s) => ({ ...s, settings }))} />
        <CrawlerSection crawler={state.crawler} settings={state.settings} onSaved={(settings) => setState((st) => ({ ...st, settings }))} onRefresh={load} />
        <BetaSection beta={state.beta} settings={state.settings} onBeta={(beta) => setState((st) => ({ ...st, beta }))} onSaved={(settings) => setState((st) => ({ ...st, settings }))} />
        <RetentionSection retention={state.retention} setting={state.settings.find((st) => st.key === 'retention.window')} onSaved={load} />
        <RendersSection settings={state.settings} onSaved={(settings) => setState((st) => ({ ...st, settings }))} />
        <CardsSection settings={state.settings} onSaved={(settings) => setState((st) => ({ ...st, settings }))} />
        <BackupsSection backups={state.backups} />
        <ProxiesSection proxies={state.proxies} />
        <PlayersSection />
        <ReservedSection />
      </div>
    </div>
  );
}

const STATE_TAG = {
  configured: (c) => ({ cls: 'ok', text: c.source === 'env' ? 'Set in .env' : 'Set' }),
  not_configured: () => ({ cls: '', text: 'Not configured' }),
  incomplete: () => ({ cls: 'warn', text: 'Incomplete' }),
  cant_decrypt: () => ({ cls: 'err', text: "Can't decrypt" }),
};

function KeysSection({ credentials, onSaved }) {
  const [open, setOpen] = useState(null);
  return (
    <section className="panel clip" aria-labelledby="keys-h">
      <div className="row gap-12 panel-head-row">
        <h2 className="h2 h2-panel" id="keys-h">API keys</h2>
        <span className="muted small">Stored encrypted with the root key from .env, and never sent back to a browser: you see whether a key is set, where from, and when. Keys in .env are used when none is stored here. Everstats never writes .env.</span>
      </div>
      <div className="tblbox">
        <table className="tbl admin-keys">
          <thead><tr><th scope="col">Key</th><th scope="col">State</th><th scope="col">Set on</th><th scope="col" className="r">Actions</th></tr></thead>
          <tbody>
            {credentials.map((c) => (
              <KeyRow key={c.id} credential={c} open={open === c.id} onOpen={() => setOpen(open === c.id ? null : c.id)} onSaved={() => { setOpen(null); onSaved(); }} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeyRow({ credential: c, open, onOpen, onSaved }) {
  const toast = useToasts();
  const [values, setValues] = useState({});
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(null);
  const tag = STATE_TAG[c.state](c);

  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    try {
      await api(`/api/admin/credentials/${c.id}`, { method: 'PUT', body: values });
      setValues({});
      setProblem(null);
      toast.ok(`${c.label} saved`);
      onSaved();
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  const remove = async () => {
    setBusy('remove');
    try {
      await api(`/api/admin/credentials/${c.id}`, { method: 'DELETE' });
      toast.ok(`${c.label} removed`, c.fields.some((f) => f.env) ? 'Any .env fallback applies again.' : undefined);
      onSaved();
    } catch (err) {
      toast.err(`Couldn't remove ${c.label}`, err.message);
    }
    setBusy(null);
  };
  const runTest = async () => {
    setBusy('test');
    try {
      const { result } = await api(`/api/admin/credentials/${c.id}/test`, { method: 'POST', body: {} });
      (result.ok ? toast.ok : toast.err)(`${c.label}: ${result.ok ? 'works' : 'failed'}`, result.message);
    } catch (err) {
      toast.err(`${c.label}: test failed`, err.message);
    }
    setBusy(null);
  };

  return (
    <>
      <tr>
        <td>
          <div className="stack">
            <b>{c.label}</b>
            <span className="muted xsmall">Unlocks: {c.unlocks}</span>
            <span className="muted mono env-names">{c.fields.map((f) => f.env).join(' · ')}</span>
          </div>
        </td>
        <td><span className={`tag ${tag.cls}`}>{tag.text}</span>{c.problem && <div className="help err">{c.problem}</div>}</td>
        <td className="t2">{c.source === 'database' ? formatDateTime(c.setAt) : c.source === 'env' ? '.env' : '—'}</td>
        <td className="r">
          <div className="row gap-6 actions-cell">
            {c.test && c.state === 'configured' && <Button className="sm" loading={busy === 'test'} onClick={runTest} title={c.test.does}>Test</Button>}
            <button type="button" className="btn sm ghost" aria-expanded={open} onClick={onOpen}>{c.source === 'database' ? 'Replace' : 'Enter keys'}</button>
            {c.source === 'database' && <Button className="sm danger" loading={busy === 'remove'} onClick={remove}>Remove</Button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="key-edit">
          <td colSpan={4}>
            <form className="stack gap-14" onSubmit={save}>
              <div className="grid-auto col-md gap-12">
                {c.fields.map((f) => (
                  <Field key={f.name} label={`${f.label} (.env fallback: ${f.env})`} inputClassName="mono" type="password" autoComplete="off" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                ))}
              </div>
              {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
              <div className="row gap-8">
                <Button type="submit" className="gold sm" loading={busy === 'save'}>Save</Button>
                <button type="button" className="btn ghost sm" onClick={onOpen}>Cancel</button>
              </div>
              <details className="small">
                <summary className="muted">Where to get these</summary>
                <ol className="t2 tips">{c.obtain.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                <a href={c.obtain.url} target="_blank" rel="noopener noreferrer">{c.obtain.url} <Icon name="external" size="sm" /></a>
              </details>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function GradingSection({ settings, onSaved }) {
  const { coverage } = useCoverage();
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="grading-h">
      <h2 className="h2 h2-panel" id="grading-h">Grading</h2>
      <span className="t2 small">Tier settings (letter shares, the ruleset minimum, the half rules) and what counts toward tiers are on <Link to="/admin/tiers">Tiers</Link>, with a preview before anything is saved.</span>
      {settings.filter((s) => s.section === 'grading').map((s) => <SettingRow key={s.key} setting={s} onSaved={onSaved} />)}
      {coverage && coverage.rulesets === null && (
        <EmptyState kind="nocoverage" compact title="No rulesets loaded yet">
          <span>Each ruleset's progress toward the minimum shows here once rulesets come in from Blizzard.</span>
        </EmptyState>
      )}
    </section>
  );
}

export function SettingRow({ setting: s, onSaved }) {
  if (s.type === 'boolean') return <BooleanSetting setting={s} onSaved={onSaved} />;
  if (s.type === 'text') return <TextSetting setting={s} onSaved={onSaved} />;
  return <IntegerSetting setting={s} onSaved={onSaved} />;
}

function BooleanSetting({ setting: s, onSaved }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const flip = async (value) => {
    setBusy(true);
    try {
      onSaved((await api(`/api/admin/settings/${s.key}`, { method: 'PUT', body: { value } })).settings);
      toast.ok('Saved', `${s.label}: ${value ? 'on' : 'off'}`);
    } catch (err) {
      toast.err("Couldn't save", err.message);
    }
    setBusy(false);
  };
  return (
    <div className="stack gap-6">
      <Toggle checked={s.value} disabled={busy} onChange={flip}>{s.label}</Toggle>
      <span className="muted xsmall">{s.help}{s.updatedAt ? ` Changed ${formatDateTime(s.updatedAt)}.` : ''}</span>
    </div>
  );
}

/** A one-line plain-text setting (0.8.1: the note shown while Blizzard renders are off). */
function TextSetting({ setting: s, onSaved }) {
  const toast = useToasts();
  const [value, setValue] = useState(s.value ?? '');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved((await api(`/api/admin/settings/${s.key}`, { method: 'PUT', body: { value } })).settings);
      setProblem(null);
      toast.ok('Saved', s.label);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <form className="stack gap-8" onSubmit={save}>
      <div className="row gap-12 align-end">
        <Field label={s.label} className="grow-col" value={value} maxLength={s.max} onChange={(e) => setValue(e.target.value)} error={problem} />
        <Button type="submit" className="gold" loading={busy}>Save</Button>
      </div>
      <span className="muted xsmall">{s.help} {value.length} / {s.max}.{s.updatedAt ? ` Changed ${formatDateTime(s.updatedAt)}.` : ''}</span>
    </form>
  );
}

/** 0.8.1: "Show Blizzard renders" and its note (server/characters/renders.js). */
function RendersSection({ settings, onSaved }) {
  const on = settings.find((s) => s.key === 'renders.show')?.value !== false;
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="renders-h">
      <div className="row gap-10"><h2 className="h2 h2-panel" id="renders-h">Character renders</h2><span className={`tag ${on ? 'ok' : 'warn'}`}>{on ? 'Showing Blizzard’s renders' : 'Paused: crest everywhere'}</span></div>
      {settings.filter((s) => s.section === 'renders').map((s) => <SettingRow key={s.key} setting={s} onSaved={onSaved} />)}
    </section>
  );
}

function IntegerSetting({ setting: s, onSaved }) {
  const toast = useToasts();
  const [value, setValue] = useState(String(s.value));
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved((await api(`/api/admin/settings/${s.key}`, { method: 'PUT', body: { value: Number(value) } })).settings);
      setProblem(null);
      toast.ok('Saved', `${s.label}: ${formatNumber(Number(value))}`);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <form className="stack gap-8" onSubmit={save}>
      <div className="row gap-12 align-end">
        <Field label={s.label} className="grow-col" inputClassName="num" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} error={problem} />
        <Button type="submit" className="gold" loading={busy}>Save</Button>
      </div>
      <span className="muted xsmall">{s.help} Default {formatNumber(s.default)}.{s.updatedAt ? ` Changed ${formatDateTime(s.updatedAt)}.` : ''}</span>
    </form>
  );
}

const PRIORITY_NAMES = { 1: 'Someone waiting (lookups, sign-ins)', 2: 'Auto-fetch after sign-in', 3: 'Daily refresh', 4: 'Guild rosters' };

function CrawlerSection({ crawler, settings, onSaved, onRefresh }) {
  const worker = crawler.workers[0];
  const c = crawler.crawler;
  const tag = !c ? { cls: '', text: 'Not started' }
    : c.state === 'not_responding' ? { cls: 'err', text: 'Not responding' }
      : c.state === 'not_configured' ? { cls: 'warn', text: 'No Blizzard keys' }
        : c.state === 'paused' ? { cls: 'warn', text: 'Background paused' }
          : c.state === 'running' ? { cls: 'ok', text: 'Running' } : { cls: 'ok', text: 'Idle' };
  const thisHour = crawler.thisHour;
  const startedAt = c?.startedAt ? Date.parse(c.startedAt) : null;
  const sinceStart = startedAt && Date.now() - startedAt < 60 * 60 * 1000;
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="crawler-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="crawler-h">Crawler</h2>
        <span className={`tag ${tag.cls}`}>{tag.text}</span>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={onRefresh}><Icon name="refresh" size="sm" />Refresh</button>
      </div>
      {!c ? (
        <EmptyState kind="nodata" compact title="The crawler hasn't reported yet">
          <span>It writes its status every few seconds from the worker container. If this stays empty, the worker isn't running.</span>
        </EmptyState>
      ) : (
        <>
          <div className="grid-auto col-xs gap-10">
            <div className="raised pad-12 stack gap-2"><span className="eyebrow">{sinceStart ? 'Crawler requests since the worker started' : 'Crawler requests, last 60 min'}</span><b className="big-num">{formatNumber(c.requestsLastHour)}</b><span className="muted xsmall">{sinceStart ? `started ${timeAgo(c.startedAt)} (counted in the worker; resets on restart) · ` : 'counted in the worker · '}{formatNumber(c.errorsLastHour)} failed · {c.perSecond}/s budget</span></div>
            <div className="raised pad-12 stack gap-2"><span className="eyebrow">Checked today</span><b className="big-num">{formatNumber(crawler.today.checked)}</b><span className="muted xsmall">{formatNumber(crawler.today.fetched)} fully fetched (UTC day)</span></div>
            <div className="raised pad-12 stack gap-2"><span className="eyebrow">Tracked</span><b className="big-num">{formatNumber(crawler.today.tracked)}</b><span className="muted xsmall">{formatNumber(crawler.today.known)} known in all</span></div>
            <div className="raised pad-12 stack gap-2"><span className="eyebrow">All Blizzard requests, {new Date(thisHour.hour).toISOString().slice(11, 13)}:00 UTC – now</span><b className="big-num">{formatNumber(thisHour.requests)}</b><span className="muted xsmall">this UTC hour, from the hourly log (sign-in reads included) · {formatNumber(thisHour.throttled)} throttled (429)</span></div>
          </div>
          <div className="tblbox listbox">
            <table className="tbl">
              <thead><tr><th scope="col">Queue</th><th scope="col" className="r">Waiting</th><th scope="col" className="r">Running</th></tr></thead>
              <tbody>
                {[1, 2, 3, 4].map((p) => (
                  <tr key={p}><td>{p} · {PRIORITY_NAMES[p]}</td><td className="r">{formatNumber(crawler.queue[p].queued)}</td><td className="r">{formatNumber(crawler.queue[p].running)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="muted xsmall">Status written {timeAgo(c.updatedAt)}.</span>
          {c.lastError ? (
            <div className="note warn small"><Icon name="warning" /><span>Last error {timeAgo(c.lastError.at)}: {c.lastError.endpoint} {c.lastError.status !== null ? `HTTP ${c.lastError.status}` : (c.lastError.error ?? '')}</span></div>
          ) : <span className="muted xsmall">No Blizzard error since the worker started.</span>}
          {c.backoffs?.length > 0 && <span className="small t2">Backing off: {c.backoffs.map((b) => `${b.endpoint} until ${formatDateTime(b.until)}`).join(', ')}</span>}
        </>
      )}
      {settings.filter((st) => st.section === 'crawler').map((st) => <SettingRow key={st.key} setting={st} onSaved={onSaved} />)}
      {worker && (
        <details className="stack gap-10">
          <summary className="small">Worker jobs</summary>
          <span className="muted xsmall">{worker.id} · v{worker.version} · started {formatDateTime(worker.startedAt)} · last heartbeat <Fresh at={worker.lastTickAt} staleAfterMs={3 * 60 * 1000} /></span>
          <div className="tblbox listbox">
            <table className="tbl">
              <thead><tr><th scope="col">Job</th><th scope="col">Last run</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {worker.jobs.map((j) => (
                  <tr key={j.id}>
                    <td><b>{j.label}</b></td>
                    <td className="t2">{j.lastStartedAt ? timeAgo(j.lastStartedAt) : 'not yet'}</td>
                    <td><span className={j.lastOutcome === 'failed' ? 'down' : 't2'}>{j.lastOutcome === 'failed' ? 'Failed: ' : ''}{j.lastSummary ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/** The beta window (open / close, with its dates) and the perks the /beta page lists. */
function BetaSection({ beta, settings, onBeta, onSaved }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const perks = settings.find((st) => st.key === 'beta.perks');
  const flip = async () => {
    setBusy(true);
    try {
      const r = await api('/api/admin/beta', { method: 'POST', body: { open: !beta.open } });
      onBeta(r.beta);
      toast.ok(r.beta.open ? 'Beta opened' : 'Beta closed', r.beta.open ? 'Accounts created from now on are beta members.' : 'Accounts created from now on are not beta members. Existing members keep it.');
    } catch (err) {
      toast.err("Couldn't change the beta", err.message);
    }
    setBusy(false);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="beta-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="beta-h">Beta</h2>
        <span className={`tag ${beta.open ? 'ok' : ''}`}>{beta.open ? 'Open' : 'Closed'}</span>
      </div>
      <div className="kv"><span className="t2">Opened</span><span>{beta.openedAt ? formatDateTime(beta.openedAt) : 'never'}</span></div>
      {!beta.open && <div className="kv"><span className="t2">Closed</span><span>{beta.closedAt ? formatDateTime(beta.closedAt) : '—'}</span></div>}
      <p className="t2 small">While it's open: the banner and the header badge show, and every account created is a beta member, permanently. Closing hides both and switches /beta to its "thanks" version. Reopening later never makes accounts created while it was closed into members.</p>
      <Button className={beta.open ? 'danger self-start' : 'gold self-start'} loading={busy} onClick={flip}>{beta.open ? 'Close the beta' : 'Open the beta'}</Button>
      {perks && <PerksEditor setting={perks} onSaved={onSaved} />}
    </section>
  );
}

function PerksEditor({ setting, onSaved }) {
  const toast = useToasts();
  const [items, setItems] = useState(setting.value);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const set = (i, k, v) => setItems((list) => list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    setBusy(true);
    try {
      onSaved((await api('/api/admin/settings/beta.perks', { method: 'PUT', body: { value: items } })).settings);
      setProblem(null);
      toast.ok('Perks saved', 'The /beta page shows them now.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <div className="stack gap-10">
      <span className="eyebrow">{setting.label}</span>
      {items.map((p, i) => (
        <div key={i} className="raised pad-12 stack gap-8">
          <Field label="Title" value={p.title} maxLength={60} onChange={(e) => set(i, 'title', e.target.value)} />
          <Field label="Description" value={p.description} maxLength={300} onChange={(e) => set(i, 'description', e.target.value)} />
          <button type="button" className="btn ghost sm self-start" onClick={() => setItems((list) => list.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row gap-8">
        <button type="button" className="btn sm" disabled={items.length >= 12} onClick={() => setItems((list) => [...list, { title: '', description: '' }])}><Icon name="plus" size="sm" />Add a perk</button>
        <Button className="gold sm" loading={busy} onClick={save}>Save perks</Button>
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
    </div>
  );
}

function BackupsSection({ backups: b }) {
  const status = b.running ? { cls: '', text: 'Running now' } : b.failing ? { cls: 'err', text: 'Last attempt failed' } : b.lastSuccessAt ? { cls: 'ok', text: 'OK' } : { cls: 'warn', text: 'None yet' };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="backups-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="backups-h">Backups</h2>
        <span className={`tag ${status.cls}`}>{status.text}</span>
      </div>
      <div className="stack">
        <div className="kv"><span className="t2">Last good backup</span><span className="strong">{b.lastSuccessAt ? <Fresh at={b.lastSuccessAt} staleAfterMs={30 * 60 * 60 * 1000} /> : 'Never'}</span></div>
        <div className="kv"><span className="t2">Its size</span><span className="strong">{b.lastSuccessBytes !== null ? formatBytes(b.lastSuccessBytes) : '—'}</span></div>
        <div className="kv"><span className="t2">File</span><span className="mono small">{b.lastSuccessFile ?? '—'}</span></div>
        {b.lastFailureAt && <div className="kv"><span className="t2">Last failure</span><span className="small">{formatDateTime(b.lastFailureAt)}</span></div>}
      </div>
      {b.failing && b.lastFailure && <div className="note err small" role="alert"><Icon name="error" /><span>{b.lastFailure}</span></div>}
      {b.recent.length === 0 ? (
        <EmptyState kind="nodata" compact title="No backup has run yet">
          <span>The worker takes one straight away when there are none, then one after 04:00 UTC each night. If BACKUP_DIR isn't set, the Crawler panel's backup job says so.</span>
        </EmptyState>
      ) : (
        <div className="tblbox listbox">
          <table className="tbl">
            <thead><tr><th scope="col">Started</th><th scope="col">Kind</th><th scope="col" className="r">Size</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {b.recent.map((r) => (
                <tr key={r.startedAt}>
                  <td className="t2">{formatDateTime(r.startedAt)}</td>
                  <td className="t2">{r.trigger === 'manual' ? 'By hand' : 'Nightly'}</td>
                  <td className="r">{r.bytes !== null ? formatBytes(r.bytes) : '—'}</td>
                  <td><span className={r.outcome === 'failed' ? 'down' : r.outcome === 'ok' ? 'up' : 't2'}>{r.outcome === 'ok' ? 'Verified' : r.outcome === 'failed' ? 'Failed' : 'Running'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="muted xsmall">By hand: <span className="mono">docker exec everstats-worker node server/tools/backup.js now</span>. Backups hold only Everstats’ own data (no Blizzard data since 0.5.0), so the newest 14 nightly backups are kept, plus the first backup of each month. A backup from before 0.5.0 still holds Blizzard data and is deleted 3 days after it was taken. Restoring: RESTORE.md.</span>
    </section>
  );
}

function ProxiesSection({ proxies }) {
  const { trustedProxies, sources } = proxies;
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="proxies-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="proxies-h">Proxy addresses</h2>
        <span className={`tag ${trustedProxies ? 'ok' : 'warn'}`}>{trustedProxies ? 'TRUSTED_PROXIES set' : 'TRUSTED_PROXIES not set'}</span>
      </div>
      <p className="t2 small">
        Where requests carrying Cloudflare's CF-Connecting-IP header have come from since the web container started:
        the address of the connection, never the visitor's. The one cloudflared uses goes in TRUSTED_PROXIES in .env,
        so nobody on the LAN can fake the header to dodge a rate limit.
      </p>
      {proxies.check?.state === 'outside' && <div className="note err small" role="alert"><Icon name="error" /><span>None of TRUSTED_PROXIES is inside this container's own network ({proxies.check.networks.join(', ') || 'none found'}). CF-Connecting-IP is being ignored, so every tunnel visitor shares one rate-limit bucket. Set it to the network's gateway (EVERSTATS_SUBNET_PREFIX in docker-compose.yml, .1).</span></div>}
      {!trustedProxies && <div className="note warn small"><Icon name="warning" /><span>Set this before announcing the beta: character lookups spend the Blizzard budget, and their per-network limit only holds when the visitor's network is read from a trusted proxy.</span></div>}
      {trustedProxies && <div className="kv"><span className="t2">TRUSTED_PROXIES</span><span className="mono small">{trustedProxies.join(', ')}</span></div>}
      {sources.length === 0 ? (
        <EmptyState kind="nodata" compact title="None seen since this container started">
          <span>Open the site once through everstats.app (the tunnel), then refresh this page.</span>
        </EmptyState>
      ) : (
        <div className="tblbox listbox">
          <table className="tbl">
            <thead><tr><th scope="col">Connection from</th><th scope="col">Header</th><th scope="col" className="r">Requests</th><th scope="col">Last seen</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={`${s.address}|${s.honoured}`}>
                  <td className="mono">{s.address ?? 'unknown'}</td>
                  <td><span className={`tag ${s.honoured ? 'ok' : 'warn'}`}>{s.honoured ? 'Honoured' : 'Ignored'}</span></td>
                  <td className="r">{formatNumber(s.requests)}</td>
                  <td className="t2">{timeAgo(s.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="muted xsmall">Also in the log: <span className="mono">{'docker logs everstats 2>&1 | grep CF-Connecting-IP'}</span></span>
    </section>
  );
}

export function AdminSignInPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await passkeySignIn('/api/admin/sign-in/options', '/api/admin/sign-in/verify');
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <AuthCard>
      <h1 className="h1 h1-auth center-text">Admin sign-in</h1>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <Button className="gold lg" loading={busy} onClick={go}><Icon name="passkey" size="md" />Use admin passkey</Button>
    </AuthCard>
  );
}

export function AdminEnrollPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  // The invite is in the #fragment, so it never reached a server log. Read once, then cleared from the address bar.
  const [invite] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await passkeyRegister('/api/admin/enroll/options', '/api/admin/enroll/verify', { optionsBody: { invite } });
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setBusy(false);
  };
  if (!invite) return <NotFoundPage />;
  return (
    <AuthCard>
      <h1 className="h1 h1-auth center-text">Register an admin passkey</h1>
      <p className="t2 small center-text">This one-time link lets you register a passkey for the admin area.</p>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <Button className="gold lg" loading={busy} onClick={go}><Icon name="passkey" size="md" />Register passkey</Button>
    </AuthCard>
  );
}
