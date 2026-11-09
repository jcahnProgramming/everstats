import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { EmptyState, Fresh } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { AuthCard } from '../pages/SignInPages.jsx';
import { passkeyRegister, passkeySignIn, wasCancelled } from '../passkeyClient.js';
import { useCoverage } from '../useCoverage.js';

/**
 * The admin area (design/v1/pages/admin). Not linked from anywhere; without an admin session /admin is the ordinary
 * "Nothing here" page, because the API answers 404 exactly as for a path that doesn't exist.
 *
 * Different from the mockup, on purpose (CLAUDE.md rules win):
 *   - Keys show state, source and "set on" only: no masked value and no last four. Nothing about a key is sent here.
 *   - No admin link in the public top bar (the mockup has one "for the owner"): the admin isn't an account.
 *   - The crawler shows only what is measured: each worker's heartbeat and each job's last run. The mockup's
 *     Pause / Run now buttons and its run, queue, API-budget and error tiles describe a crawler that isn't built.
 *   - Per-ruleset grading progress needs rulesets, which come from Blizzard (not loaded yet), so it says so.
 * Added: Backups (nightly pg_dump) and Proxy addresses (where CF-Connecting-IP arrives from, for TRUSTED_PROXIES).
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

  if (state === null) return <NotFoundPage />;
  if (state === undefined) {
    return <div className="wrap page-pad">{problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}</div>;
  }

  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12">
        <h1 className="h1 admin-title">Admin</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={load}><Icon name="refresh" size="sm" />Refresh</button>
        <button type="button" className="btn ghost sm" onClick={async () => { await api('/api/admin/sign-out', { method: 'POST', body: {} }); navigate('/'); }}>Sign out of admin</button>
      </div>
      <KeysSection credentials={state.credentials} onSaved={load} />
      <div className="grid-auto col-xl gap-24 align-start-grid">
        <GradingSection settings={state.settings} onSaved={(settings) => setState((s) => ({ ...s, settings }))} />
        <CrawlerSection crawler={state.crawler} />
        <BackupsSection backups={state.backups} />
        <ProxiesSection proxies={state.proxies} />
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
      {settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={onSaved} />)}
      {coverage && coverage.rulesets === null && (
        <EmptyState kind="nocoverage" compact title="No rulesets loaded yet">
          <span>Each ruleset's progress toward the minimum shows here once rulesets come in from Blizzard.</span>
        </EmptyState>
      )}
    </section>
  );
}

function SettingRow({ setting: s, onSaved }) {
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

function CrawlerSection({ crawler }) {
  const worker = crawler.workers[0];
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="crawler-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="crawler-h">Crawler</h2>
        {worker
          ? <span className={`tag ${worker.state === 'not_responding' ? 'err' : 'ok'}`}>{worker.state === 'not_responding' ? 'Not responding' : worker.state === 'running' ? 'Running' : 'Idle'}</span>
          : <span className="tag">No worker yet</span>}
      </div>
      {crawler.workers.length === 0 ? (
        <EmptyState kind="nodata" compact title="No worker has reported yet">
          <span>The worker writes a heartbeat every 30 seconds. If this stays empty, the worker container isn't running.</span>
        </EmptyState>
      ) : crawler.workers.map((w) => (
        <div key={w.id} className="stack gap-10">
          <span className="muted xsmall">{w.id} · v{w.version} · started {formatDateTime(w.startedAt)} · last heartbeat <Fresh at={w.lastTickAt} staleAfterMs={3 * 60 * 1000} /></span>
          <div className="tblbox listbox">
            <table className="tbl">
              <thead><tr><th scope="col">Job</th><th scope="col">Last run</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {w.jobs.map((j) => (
                  <tr key={j.id}>
                    <td><b>{j.label}</b></td>
                    <td className="t2">{j.lastStartedAt ? timeAgo(j.lastStartedAt) : 'not yet'}</td>
                    <td><span className={j.lastOutcome === 'failed' ? 'down' : 't2'}>{j.lastOutcome === 'failed' ? 'Failed: ' : ''}{j.lastSummary ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <EmptyState kind="soon" compact title="Crawl runs, the look-up queue and the API budget">
        <span>They appear here once the crawler that tracks characters exists.</span>
      </EmptyState>
    </section>
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
      <span className="muted xsmall">By hand: <span className="mono">docker exec everstats-worker node server/tools/backup.js now</span>. Keeps the 14 newest plus the first of each month. Restoring: RESTORE.md.</span>
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
