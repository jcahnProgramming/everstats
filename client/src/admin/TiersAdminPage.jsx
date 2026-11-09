import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TIER_LETTERS } from '../../../server/stats/tiers.js';
import { categoryWeights, weightsProblem } from '../../../server/tiers/engine.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { TierBadge } from '../components/Tier.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../format.js';

/**
 * /admin/tiers (0.6.0), linked only from /admin; its API sits behind the admin 404 gate.
 *
 *   Settings   the five letter shares (must add to 100), the ruleset minimum and the two half rules. "Preview" shows
 *              how many characters per ruleset would land in each letter with the values in the form, computed from
 *              the stored values and the live decisions without saving anything; "Save" stores them (each change is
 *              an admin event) and a full grading follows within a minute.
 *   Weights    (0.8.0) each overall category's weight: the square-root formula, read live from what counts, unless a
 *              percent is pinned; the unpinned ones share the rest by the formula. Pins are part of the same form, so
 *              they too need a Preview before Save, and each change is logged like the other settings.
 *   What counts read-only, from the Discovery decisions as they are now: per category, which statistics count, which
 *              are bad, farmable, duplicate-excluded, and which are undecided (and so count as nothing), each linking
 *              back to its decision on the Discovery page. Decisions that look inconsistent are listed first.
 *   Gradings   the last full gradings and any pending request.
 */
const FIELDS = [
  { key: 'minPopulation', label: 'Ruleset minimum (tier-eligible characters)', min: 1 },
  { key: 'categoryHalf', label: 'Category rule: share of its graded statistics above zero (%)', min: 1, max: 100 },
  { key: 'overallHalf', label: 'Overall rule: share of overall categories with a letter (%)', min: 1, max: 100 },
];

export function TiersAdminPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setState(await api('/api/admin/tiers'));
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
  if (state === undefined) return <div className="wrap page-pad">{problem ? <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div> : <span className="t2 small" role="status">Loading…</span>}</div>;
  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12">
        <Link className="btn ghost sm" to="/admin"><Icon name="arrow-left" size="sm" />Admin</Link>
        <h1 className="h1 admin-title">Tiers</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <Link className="btn sm" to="/admin/discovery"><Icon name="search" size="sm" />Discovery</Link>
        <button type="button" className="btn ghost sm" onClick={load}><Icon name="refresh" size="sm" />Refresh</button>
      </div>
      <SettingsPanel state={state} onSaved={setState} />
      <GradingsPanel state={state} onChanged={setState} />
      <WhatCounts state={state} />
    </div>
  );
}

function SettingsPanel({ state, onSaved }) {
  const toast = useToasts();
  const initial = useMemo(() => ({
    ...Object.fromEntries(TIER_LETTERS.map((l) => [l, String(state.settings.shares[l])])),
    ...Object.fromEntries(FIELDS.map((f) => [f.key, String(state.settings[f.key])])),
    ...Object.fromEntries(state.weights.map((w) => [`w:${w.key}`, w.pinned !== null ? String(w.pinned) : ''])),
  }), [state.settings, state.weights]);
  const [form, setForm] = useState(initial);
  const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    setForm(initial);
  }, [initial]);
  // Pins kept for categories that aren't in the overall tier right now stay as they are (they're ignored until it is).
  const pins = () => {
    const out = Object.fromEntries(Object.entries(state.settings.weights ?? {}).filter(([k]) => !state.weights.some((w) => w.key === k)));
    for (const w of state.weights) {
      const v = form[`w:${w.key}`];
      if (v !== undefined && String(v).trim() !== '') out[w.key] = Number(v);
    }
    return out;
  };
  const body = () => ({
    shares: Object.fromEntries(TIER_LETTERS.map((l) => [l, Number(form[l])])),
    ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
    weights: pins(),
  });
  const plan = { categories: state.weights.map((w) => ({ key: w.key, label: w.label, inOverall: true, overallIds: new Array(w.statistics) })) };
  const pinBad = Object.values(pins()).some((v) => !Number.isFinite(v) || v < 0.1 || v > 99.9);
  const weightProblem = pinBad ? 'A pinned weight is a number between 0.1 and 99.9.' : weightsProblem(plan, pins());
  const liveWeights = weightProblem ? null : categoryWeights(plan, { weighting: 'sqrt', weights: pins() });
  const sum = TIER_LETTERS.reduce((n, l) => n + (Number(form[l]) || 0), 0);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setPreview(null);
  };
  const runPreview = async () => {
    setBusy('preview');
    setProblem(null);
    try {
      setPreview((await api('/api/admin/tiers/preview', { method: 'POST', body: body() })).preview);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  const save = async () => {
    setBusy('save');
    setProblem(null);
    try {
      onSaved(await api('/api/admin/tiers/settings', { method: 'PUT', body: body() }));
      toast.ok('Tier settings saved', 'Every ruleset is graded again within a minute.');
      setPreview(null);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="tier-settings-h">
      <h2 className="h2 h2-panel" id="tier-settings-h">Settings</h2>
      <div className="stack gap-8">
        <span className="eyebrow">Letter shares (%), best first</span>
        <div className="row gap-12 tier-share-row">
          {TIER_LETTERS.map((l) => (
            <div key={l} className="row gap-8 tier-share">
              <TierBadge letter={l} size="sm" />
              <Field label={`${l} share`} inputClassName="num" inputMode="numeric" value={form[l]} onChange={set(l)} />
            </div>
          ))}
        </div>
        <span className={`xsmall ${sum === 100 ? 'muted' : 'err-text'}`} role={sum === 100 ? undefined : 'alert'}>Adds up to {sum}{sum === 100 ? '' : ': the five shares must add up to 100'}.</span>
      </div>
      <div className="grid-auto col-md gap-14">
        {FIELDS.map((f) => <Field key={f.key} label={f.label} inputClassName="num" inputMode="numeric" value={form[f.key]} onChange={set(f.key)} />)}
      </div>
      <div className="stack gap-8">
        <span className="eyebrow">Category weights in the overall tier</span>
        <span className="t2 small">Each category weighs √(its statistics counting toward overall), as a share of the total. Pin a percent to fix one; leave it blank to follow the formula. The unpinned ones share what is left, by the same formula, so everything adds up to 100%.</span>
        {state.weights.length === 0 ? <span className="muted small">No category counts toward the overall tier yet.</span> : (
          <div className="tblbox">
            <table className="tbl">
              <thead><tr><th scope="col">Category</th><th scope="col" className="r">Statistics</th><th scope="col" className="r">Formula</th><th scope="col">Pinned %</th><th scope="col" className="r">Weight used</th></tr></thead>
              <tbody>
                {state.weights.map((w, i) => (
                  <tr key={w.key}>
                    <td>{w.label}</td>
                    <td className="r">{formatNumber(w.statistics)}</td>
                    <td className="r">{(w.formula * 100).toFixed(1)}%</td>
                    <td><Field label={`${w.label} pinned weight`} className="weight-pin" inputClassName="num" inputMode="decimal" placeholder="formula" value={form[`w:${w.key}`]} onChange={set(`w:${w.key}`)} /></td>
                    <td className="r"><b className="strong-text">{liveWeights ? `${(liveWeights[i].weight * 100).toFixed(1)}%` : '–'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {weightProblem && <span className="xsmall err-text" role="alert">{weightProblem}</span>}
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10">
        <Button className="sm" loading={busy === 'preview'} disabled={busy !== null || sum !== 100 || Boolean(weightProblem)} onClick={runPreview}><Icon name="chart" size="sm" />Preview</Button>
        <Button className="sm gold" loading={busy === 'save'} disabled={busy !== null || !changed || sum !== 100 || Boolean(weightProblem) || !preview} onClick={save}>Save</Button>
        <span className="muted xsmall">{changed ? (preview ? 'Preview shown below: save to apply it.' : 'Preview first: Save stays off until you have seen what it changes.') : 'No changes.'}</span>
      </div>
      {preview && <Preview preview={preview} current={state.runs.find((r) => r.status === 'done')} />}
    </section>
  );
}

function Preview({ preview, current }) {
  const now = new Map((current?.summary?.rulesets ?? []).map((r) => [r.rulesetId, r.overall]));
  return (
    <div className="stack gap-10">
      <span className="eyebrow">Preview: overall letters per ruleset with these settings ({formatNumber(preview.counted)} counted statistics, computed in {formatNumber(preview.ms)} ms, nothing saved)</span>
      {preview.rulesets.length === 0 && <EmptyState kind="nodata" compact title="No ruleset has tracked characters yet" />}
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">Ruleset</th><th scope="col" className="r">Eligible</th>{TIER_LETTERS.map((l) => <th key={l} scope="col" className="r">{l}</th>)}<th scope="col" className="r">Unranked</th></tr></thead>
          <tbody>
            {preview.rulesets.map((r) => (
              <tr key={r.id}>
                <td>{r.name ?? `Ruleset ${r.id}`}</td>
                <td className="r">{formatNumber(r.population)}</td>
                {r.graded
                  ? [...TIER_LETTERS, 'unranked'].map((l) => (
                    <td key={l} className="r">
                      {formatNumber(r.overall[l])}
                      {now.get(r.id) && now.get(r.id)[l] !== r.overall[l] && <span className="muted xsmall"> (now {formatNumber(now.get(r.id)[l])})</span>}
                    </td>
                  ))
                  : <td colSpan={6} className="t2 small">Below the minimum: nobody graded</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.rulesets.filter((r) => r.graded).map((r) => (
        <details key={r.id} className="small">
          <summary>{r.name ?? `Ruleset ${r.id}`}: category letters</summary>
          <div className="tblbox">
            <table className="tbl">
              <thead><tr><th scope="col">Category</th>{TIER_LETTERS.map((l) => <th key={l} scope="col" className="r">{l}</th>)}<th scope="col" className="r">Unranked</th></tr></thead>
              <tbody>{r.categories.map((c) => <tr key={c.key}><td>{c.label}</td>{[...TIER_LETTERS, 'unranked'].map((l) => <td key={l} className="r">{formatNumber(c.letters[l])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

function GradingsPanel({ state, onChanged }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const regrade = async () => {
    setBusy(true);
    try {
      onChanged(await api('/api/admin/tiers/regrade', { method: 'POST', body: {} }));
      toast.ok('Grading requested', 'It runs within a minute.');
    } catch (err) {
      toast.err('Couldn’t request a grading', err.message);
    }
    setBusy(false);
  };
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="gradings-h">
      <div className="row gap-12"><h2 className="h2 h2-panel" id="gradings-h">Gradings</h2><span className="spacer" /><Button className="sm ghost" loading={busy} onClick={regrade}><Icon name="refresh" size="sm" />Grade everyone now</Button></div>
      <div className="listbox">
        {state.rulesets.map((r) => (
          <div key={r.id} className="listrow">
            <b>{r.name}</b>
            <span className="t2 small">{formatNumber(r.eligible)} tier-eligible now</span>
            <span className="spacer" />
            {r.graded ? <span className="tag ok">Graded {timeAgo(r.gradedAt)} · {formatNumber(r.gradedPopulation)}</span> : r.gradedAt ? <span className="tag warn">Below the minimum at {timeAgo(r.gradedAt)}</span> : <span className="tag">Not graded yet</span>}
          </div>
        ))}
      </div>
      {state.runs.length === 0 ? <span className="muted small">No grading has run yet. The worker runs the first within a minute of starting.</span> : (
        <div className="tblbox">
          <table className="tbl">
            <thead><tr><th scope="col">#</th><th scope="col">Status</th><th scope="col">Why</th><th scope="col">Asked</th><th scope="col" className="r">Took</th></tr></thead>
            <tbody>
              {state.runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.id}</td>
                  <td><span className={`tag ${r.status === 'done' ? 'ok' : r.status === 'failed' ? 'err' : r.status === 'running' ? 'warn' : ''}`}>{r.status === 'pending' ? 'waiting for a quiet moment' : r.status}</span>{r.problem && <span className="muted xsmall"> {r.problem}</span>}</td>
                  <td className="t2 small">{r.reasons.join(', ')}</td>
                  <td className="t2 small">{formatDateTime(r.requested_at)}</td>
                  <td className="r small">{r.ms !== null ? `${formatNumber(r.ms)} ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const discoveryLink = (id) => `/admin/discovery?stat=${id}`;

function StatList({ title, list, extra }) {
  if (!list.length) return null;
  return (
    <div className="stack gap-4">
      <span className="eyebrow">{title} · {list.length}</span>
      <ul className="plain stack gap-2 small">
        {list.map((s) => (
          <li key={s.id}><Link to={discoveryLink(s.id)}>{s.name}</Link> <span className="mono muted xsmall">id {s.id}</span>{extra ? <span className="muted xsmall"> · {extra(s)}</span> : null}</li>
        ))}
      </ul>
    </div>
  );
}

function WhatCounts({ state }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="counts-h">
      <h2 className="h2 h2-panel" id="counts-h">What counts</h2>
      <p className="t2 small">From your Discovery decisions as they are right now. A statistic counts only with an approved category AND an approved “counts toward”; anything undecided counts as nothing. Click a statistic to open its decision.</p>
      {state.issues.length > 0 && (
        <div className="note warn small stack gap-6" role="status">
          <b>{state.issues.length} decision{state.issues.length === 1 ? '' : 's'} that look inconsistent</b>
          <ul className="plain stack gap-4">
            {state.issues.map((i) => <li key={`${i.statisticId}-${i.problem}`}><Link to={discoveryLink(i.statisticId)}>{i.name}</Link> ({i.category}): {i.problem}</li>)}
          </ul>
        </div>
      )}
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">Category</th><th scope="col">Overall?</th><th scope="col" className="r">Counted</th><th scope="col" className="r">Bad</th><th scope="col" className="r">Name + number</th><th scope="col" className="r">Duplicate</th><th scope="col" className="r">Undecided</th></tr></thead>
          <tbody>
            {state.summary.map((c) => (
              <tr key={c.key}>
                <td>{c.label}{c.farmable && <span className="tag disc-decision">farmable</span>}</td>
                <td className="t2 small">{c.inOverall ? 'Yes' : c.farmable ? 'No: farmable' : c.counted ? 'No: nothing counts toward overall' : 'No: nothing counts'}</td>
                <td className="r">{c.counted}{c.counted !== c.overall && c.inOverall ? <span className="muted xsmall"> ({c.overall} overall)</span> : null}</td>
                <td className="r">{c.bad}</td>
                <td className="r">{c.named}</td>
                <td className="r">{c.duplicate}</td>
                <td className="r">{c.undecided}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stack gap-8">
        {state.categories.map((c) => (
          <div key={c.key} className="panel clip">
            <button type="button" className="cathead is-collapsed why-head" aria-expanded={open.has(c.key)} onClick={() => toggle(c.key)}>
              <span className="title"><span className="h3 cat-title">{c.label}</span><span className="muted xsmall">{c.counted.length} counted · {c.bad.length + c.named.length} leaderboard only · {c.duplicate.length} duplicate · {c.undecided.length} undecided</span></span>
              <span className="spacer" />
              <Icon name={open.has(c.key) ? 'chevron-up' : 'chevron-down'} size="sm" />
            </button>
            {open.has(c.key) && (
              <div className="pad-20 stack gap-12">
                <StatList title="Counts" list={c.counted} extra={(s) => (s.overall ? 'category + overall' : 'category only')} />
                <StatList title="Bad: leaderboard only" list={c.bad} />
                <StatList title="Name + number: leaderboard only" list={c.named} />
                <StatList title="Duplicate: graded through the other" list={c.duplicate} extra={(s) => `of ${s.ofName ?? `id ${s.of}`}`} />
                <StatList title="Undecided: doesn’t count" list={c.undecided} extra={(s) => s.reason} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
