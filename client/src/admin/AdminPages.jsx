import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { KeyIcon } from '../chrome/icons.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { passkeyRegister, passkeySignIn, wasCancelled } from '../passkeyClient.js';
import '../pages/pages.css';

// The admin area. Not linked from anywhere; without an admin session /admin is the ordinary "Nothing here" page,
// because the API answers 404 exactly as for a path that doesn't exist.
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null);

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
  if (state === undefined) return problem ? <p className="notice notice-danger">{problem}</p> : null;

  return (
    <>
      <div className="page-head row-between">
        <h1>Admin</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await api('/api/admin/sign-out', { method: 'POST', body: {} }); navigate('/'); }}>Sign out of admin</button>
      </div>
      <KeysSection credentials={state.credentials} onSaved={load} />
      <SettingsSection settings={state.settings} onSaved={(settings) => setState((s) => ({ ...s, settings }))} />
      <CrawlerSection crawler={state.crawler} />
    </>
  );
}

function KeysSection({ credentials, onSaved }) {
  return (
    <section className="panel" aria-labelledby="keys-h">
      <div className="panel-head"><h2 id="keys-h">API keys</h2></div>
      <p className="muted">Keys are stored encrypted with the root key from .env and never sent back to a browser: you see whether one is set, and when. Keys in .env are used when none is stored here. Everstats never writes .env.</p>
      {credentials.map((c) => <KeyCard key={c.id} credential={c} onSaved={onSaved} />)}
    </section>
  );
}

const STATE_LABEL = {
  configured: (c) => (c.source === 'env' ? 'Set in .env' : `Set on ${fmt(c.setAt)}`),
  not_configured: () => 'Not configured',
  incomplete: () => 'Incomplete',
  cant_decrypt: () => "Can't decrypt",
};

function KeyCard({ credential: c, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({});
  const [problem, setProblem] = useState(null);
  const [test, setTest] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/credentials/${c.id}`, { method: 'PUT', body: values });
      setValues({});
      setEditing(false);
      setProblem(null);
      onSaved();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const remove = async () => {
    await api(`/api/admin/credentials/${c.id}`, { method: 'DELETE' });
    onSaved();
  };
  const runTest = async () => {
    setTest({ running: true });
    try {
      setTest((await api(`/api/admin/credentials/${c.id}/test`, { method: 'POST', body: {} })).result);
    } catch (err) {
      setTest({ ok: false, message: err.message });
    }
  };

  return (
    <div className="panel-sub stack">
      <div className="row-between">
        <div className="list-item-main">
          <strong>{c.label}</strong>
          <span className="faint">Unlocks: {c.unlocks}</span>
        </div>
        <span className={`chip ${c.state === 'configured' ? 'chip-success' : ''}`}>{STATE_LABEL[c.state](c)}</span>
      </div>
      {c.problem && <p className="notice notice-warning">{c.problem}</p>}
      {c.state === 'configured' && !editing && (
        <ul className="list">
          {c.fields.map((f) => (
            <li key={f.name} className="list-item"><span>{f.label}</span><span className="mono faint" aria-label="hidden">••••••••••••</span></li>
          ))}
        </ul>
      )}
      {editing ? (
        <form className="stack" onSubmit={save}>
          {c.fields.map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`${c.id}-${f.name}`}>{f.label} <span className="faint">(.env fallback: {f.env})</span></label>
              <input id={`${c.id}-${f.name}`} className="input mono" type="password" autoComplete="off" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
            </div>
          ))}
          <div className="row">
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setValues({}); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>{c.source === 'database' ? 'Replace' : 'Enter keys'}</button>
          {c.source === 'database' && <button type="button" className="btn btn-sm btn-ghost" onClick={remove}>Remove</button>}
          {c.test && c.state === 'configured' && <button type="button" className="btn btn-sm btn-ghost" onClick={runTest} title={c.test.does}>Test</button>}
        </div>
      )}
      {test && !test.running && <p className={`notice ${test.ok ? 'notice-success' : 'notice-danger'}`}>{test.message}</p>}
      {problem && <p className="notice notice-danger">{problem}</p>}
      <details>
        <summary className="faint">Where to get these</summary>
        <ol className="release-items">
          {c.obtain.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <a href={c.obtain.url} target="_blank" rel="noopener noreferrer">{c.obtain.url}</a>
      </details>
    </div>
  );
}

function SettingsSection({ settings, onSaved }) {
  return (
    <section className="panel" aria-labelledby="as-h">
      <div className="panel-head"><h2 id="as-h">Grading</h2></div>
      {settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={onSaved} />)}
    </section>
  );
}

function SettingRow({ setting: s, onSaved }) {
  const [value, setValue] = useState(String(s.value));
  const [problem, setProblem] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      onSaved((await api(`/api/admin/settings/${s.key}`, { method: 'PUT', body: { value: Number(value) } })).settings);
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <label htmlFor={s.key}>{s.label}</label>
        <div className="row">
          <input id={s.key} className="input input-code" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="btn btn-sm">Save</button>
        </div>
      </div>
      <p className="faint">{s.help} Default {s.default}.{s.updatedAt ? ` Changed ${fmt(s.updatedAt)}.` : ''}</p>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </form>
  );
}

function CrawlerSection({ crawler }) {
  return (
    <section className="panel" aria-labelledby="cr-h">
      <div className="panel-head"><h2 id="cr-h">Crawler</h2></div>
      {crawler.workers.length === 0 ? (
        <EmptyState kind="nodata" title="No worker has reported yet">
          <span>The worker writes a heartbeat every 30 seconds. If this stays empty, the worker container isn't running.</span>
        </EmptyState>
      ) : (
        <ul className="list">
          {crawler.workers.map((w) => (
            <li key={w.id} className="list-item">
              <span className="list-item-main">
                <span>{w.id} <span className={`chip ${w.state === 'not_responding' ? '' : 'chip-success'}`}>{w.state === 'not_responding' ? 'Not responding' : w.state}</span></span>
                <span className="faint">v{w.version} · started {fmt(w.startedAt)} · last heartbeat {fmt(w.lastTickAt)}</span>
              </span>
              <span className="faint">{w.jobs.length === 0 ? 'No jobs registered yet' : `${w.jobs.length} job(s)`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminSignInPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const go = async () => {
    try {
      await passkeySignIn('/api/admin/sign-in/options', '/api/admin/sign-in/verify');
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
  };
  return (
    <div className="stack narrow">
      <div className="page-head"><h1>Admin sign-in</h1></div>
      <div><button type="button" className="btn btn-primary" onClick={go}><KeyIcon size={18} /> Use admin passkey</button></div>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </div>
  );
}

export function AdminEnrollPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  // The invite is in the #fragment, so it never reached a server log. Read once, then cleared from the address bar.
  const [invite] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const go = async () => {
    try {
      await passkeyRegister('/api/admin/enroll/options', '/api/admin/enroll/verify', { optionsBody: { invite } });
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
  };
  if (!invite) return <NotFoundPage />;
  return (
    <div className="stack narrow">
      <div className="page-head"><h1>Register an admin passkey</h1></div>
      <p className="muted">This one-time link lets you register a passkey for the admin area.</p>
      <div><button type="button" className="btn btn-primary" onClick={go}><KeyIcon size={18} /> Register passkey</button></div>
      {problem && <p className="notice notice-danger">{problem}</p>}
    </div>
  );
}
