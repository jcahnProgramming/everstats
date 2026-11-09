import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Tabs } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { Figure, Q, Responses, duration, ms, statusTag } from './DiscoveryPage.jsx';

/**
 * The endpoint probe on /admin/discovery (0.8.3, server/discovery/probe/): every endpoint in Blizzard's WoW API docs,
 * tried once against WoW Forever, and what answered. Admin only like the rest of the page. Discovery only: nothing here
 * builds a feature; a 404 is shown as a 404 and a skip says why.
 */
const DEFAULTS = { name: 'Path', surname: 'Vexley', guild: 'Post Nerf Clarity' };
const VERDICT = { yes: { tag: 'ok', label: 'Yes' }, no: { tag: 'warn', label: 'No' }, unknown: { tag: '', label: 'Unknown' } };
const OUTCOME = { answered: 'ok', 'not found': 'warn', other: 'err', skipped: '', 'not asked': '' };
const FLAG = { first: 'first probe', later: 'later expansion', classic: 'classic docs', guess: 'Forever guess' };
// 0.9.0: {C} and {G} stand for the probed character's and guild's own paths; spelled out (a bare "C" read as nothing).
const short = (t) => String(t).replace('{C}', 'character').replace('{G}', 'guild').replace('/data/wow/', '');

export function ProbePanel({ state, active, onQueued }) {
  const last = state.runs.find((r) => r.options?.kind === 'probe')?.options;
  const [name, setName] = useState(last?.primary?.name ?? DEFAULTS.name);
  const [surname, setSurname] = useState(last?.primary?.surname ?? DEFAULTS.surname);
  const [guild, setGuild] = useState(last?.guild?.name ?? DEFAULTS.guild);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { run } = await api('/api/admin/discovery/probes', { method: 'POST', body: { name, surname, guild } });
      onQueued(run);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="probe-h">
      <h2 className="h2 h2-panel" id="probe-h">Endpoint probe</h2>
      <p className="t2 small">
        Tries every endpoint in Blizzard’s WoW API docs (retail and classic) against Forever, once, and records what
        answers: a few hundred requests at the discovery rate below. Ids come from real answers; a path with no real id
        to try is skipped, with the reason.
        {state.grant ? ' protected-character uses your Battle.net authorization.' : ' Without a Battle.net authorization, protected-character is skipped.'}
      </p>
      <form className="stack gap-14" onSubmit={start}>
        <div className="grid-auto col-md gap-12">
          <Field label="Character: name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Field label="Surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
        </div>
        <Field label="Guild" value={guild} onChange={(e) => setGuild(e.target.value)} autoComplete="off" />
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        <div className="row gap-10">
          <Button type="submit" className="gold" loading={busy} disabled={Boolean(active) || !state.configured}><Icon name="play" size="sm" />Run the probe</Button>
          {active && <span className="t2 small">Run #{active.id} hasn’t finished yet.</span>}
        </div>
      </form>
    </section>
  );
}

export function ProbeDetail({ runId, listed, onChanged }) {
  const toast = useToasts();
  const [run, setRun] = useState(null);
  const [problem, setProblem] = useState(null);
  const [tab, setTab] = useState('answers');
  const [busy, setBusy] = useState(null);
  const listedStatus = listed?.status;
  useEffect(() => {
    let live = true;
    api(`/api/admin/discovery/runs/${runId}?skeletons=1`).then((r) => {
      if (live) setRun(r.run);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, [runId, listedStatus]);

  const stop = async () => {
    setBusy('stop');
    try {
      await api(`/api/admin/discovery/runs/${runId}/stop`, { method: 'POST', body: {} });
      toast.ok(`Stopping probe #${runId}`, 'It stops before its next request and keeps what it has.');
      onChanged();
    } catch (err) {
      toast.err('Couldn’t stop the probe', err.message);
    }
    setBusy(null);
  };
  const reanalyse = async () => {
    setBusy('reanalyse');
    try {
      setRun((await api(`/api/admin/discovery/runs/${runId}/reanalyse`, { method: 'POST', body: {} })).run);
      const r = await api(`/api/admin/discovery/runs/${runId}?skeletons=1`);
      setRun(r.run);
      toast.ok(`Probe #${runId} re-analysed`, 'From the stored responses: Blizzard wasn’t asked anything.');
    } catch (err) {
      toast.err('Couldn’t re-analyse', err.message);
    }
    setBusy(null);
  };

  if (problem) return <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>;
  if (!run) return null;
  const status = listed?.status ?? run.status;
  if (status === 'queued' || status === 'running') {
    const p = (listed ?? run).progress ?? {};
    const stopping = Boolean(listed?.stopRequestedAt ?? run.stopRequestedAt);
    return (
      <section className="panel pad-20 stack gap-12" aria-live="polite" aria-labelledby="probe-run-h">
        <div className="row gap-12">
          <h2 className="h2 h2-panel" id="probe-run-h">Probe #{run.id} {status === 'queued' ? 'is queued' : 'is running'}</h2>
          <span className="spacer" />
          <Button className="sm" loading={busy === 'stop'} disabled={stopping} onClick={stop}><Icon name="close" size="sm" />{stopping ? 'Stopping…' : 'Stop'}</Button>
        </div>
        {status === 'queued' ? <span className="t2 small">The worker picks it up within about 30 seconds. This page follows it.</span> : (
          <>
            <div className="kv"><span className="t2">Now</span><span className="mono small">{p.phase ?? '…'}</span></div>
            <div className="kv"><span className="t2">Endpoints</span><span>{formatNumber(p.entriesDone)} of {formatNumber(p.entriesTotal)}</span></div>
            <div className="kv"><span className="t2">Requests so far</span><span>{formatNumber(p.requests)}</span></div>
            <div className="kv"><span className="t2">Answered 200 / skipped</span><span>{formatNumber(p.answered)} / {formatNumber(p.skipped)}</span></div>
            <div className="kv"><span className="t2">Last heartbeat</span><span className="small">{timeAgo((listed ?? run).heartbeatAt) ?? '—'}</span></div>
          </>
        )}
      </section>
    );
  }
  const s = run.summary;
  if (!s) {
    return <div className="note err" role="alert"><Icon name="error" /><div className="stack gap-4"><b>Probe #{run.id} {run.status}</b><span className="small">{run.problem ?? 'No reason was recorded.'}</span></div></div>;
  }
  const answered = s.areas.reduce((n, a) => n + a.answered, 0);
  const skipped = s.areas.reduce((n, a) => n + a.skipped, 0);
  const tabs = [
    { id: 'answers', label: 'Answers' },
    { id: 'areas', label: 'By area', count: s.entryCount },
    { id: 'responses', label: 'Raw responses', count: s.requests },
  ];
  return (
    <section className="panel clip stack gap-14" aria-labelledby="probe-detail-h">
      <div className="row gap-12 panel-head-row">
        <h2 className="h2 h2-panel" id="probe-detail-h">Probe #{run.id}</h2>
        <span className="muted small">{s.primary ? `${s.primary.name} ${s.primary.surname}` : '—'} · {s.guild?.name ?? '—'} · {run.status} {formatDateTime(run.finishedAt)} · analysed with v{s.analysedWith}</span>
        <span className="spacer" />
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.json`} download><Icon name="download" size="sm" />JSON</a>
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.csv`} download><Icon name="download" size="sm" />CSV</a>
        <Button className="sm ghost" loading={busy === 'reanalyse'} onClick={reanalyse} title="Rebuild the results and answers from the stored responses. Asks Blizzard nothing."><Icon name="refresh" size="sm" />Re-analyse</Button>
      </div>
      <div className="pad-x-20 stack gap-12">
        {s.stopped && <div className="note warn small" role="status"><Icon name="warning" /><span>Stopped after {formatNumber(s.stopped.afterRequests)} requests ({formatNumber(s.stopped.afterEntries)} of {formatNumber(s.entryCount)} endpoints). Endpoints after that are “not asked”, and answers that needed them say unknown.</span></div>}
        <div className="grid-auto col-md gap-12">
          <Figure label="Requests" value={formatNumber(s.requests)} note={`${formatNumber(s.retried)} retried · ${formatNumber(s.throttled)} answered 429`} />
          <Figure label="Took" value={duration(s.wallMs)} note={`${run.options.requestsPerSecond} requests a second allowed`} />
          <Figure label="Endpoints answered 200" value={`${formatNumber(answered)} of ${formatNumber(s.entryCount)}`} note={`${formatNumber(skipped)} skipped, with reasons`} />
          <Figure label="Latency p50 / p95" value={`${ms(s.latency.p50Ms)} / ${ms(s.latency.p95Ms)}`} note={`max ${ms(s.latency.maxMs)}`} />
        </div>
      </div>
      <div className="pad-x-20"><Tabs tabs={tabs} value={tab} onChange={setTab} label="Probe results" idPrefix="probe" /></div>
      <div className="pad-20" role="tabpanel" id={`probe-panel-${tab}`} aria-labelledby={`probe-tab-${tab}`}>
        {tab === 'answers' && <ProbeAnswers summary={s} />}
        {tab === 'areas' && <ProbeAreas summary={s} />}
        {tab === 'responses' && <Responses runId={run.id} />}
      </div>
    </section>
  );
}

function ProbeAnswers({ summary: s }) {
  return (
    <div className="stack gap-24">
      <div className="stack gap-12">
        {s.answers.map((a) => (
          <div key={a.id} className="stack gap-4 probe-answer">
            <div className="row gap-8">
              <span className={`tag ${VERDICT[a.verdict].tag}`}>{VERDICT[a.verdict].label}</span>
              <span className="muted xsmall">{a.module}</span>
            </div>
            <b className="small">{a.question}</b>
            <span className="t2 small">{a.text}</span>
          </div>
        ))}
      </div>
      <Q title="Answered, though we didn’t expect it">
        <span className="muted xsmall">A Forever guess, a path never probed before 0.8.3, or a system retail added in a later expansion, that answered 200.</span>
        {s.unexpected.length === 0 ? <span className="t2 small">Nothing.</span> : (
          <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Path</th><th scope="col">Why unexpected</th><th scope="col" className="r">Items</th><th scope="col" className="r">Size</th></tr></thead><tbody>
            {s.unexpected.map((u) => <tr key={u.id}><td className="mono xsmall" data-label="Path">{u.path}</td><td className="small" data-label="Why unexpected">{u.flags.map((f) => FLAG[f]).join(', ')}</td><td className="r" data-label="Items">{u.count === null ? '—' : formatNumber(u.count)}</td><td className="r" data-label="Size">{formatBytes(u.bytes) ?? '—'}</td></tr>)}
          </tbody></table></div>
        )}
      </Q>
      <Q title="Forever words in the answers">
        {s.foreverTerms.map((t) => <span key={t.id} className="small"><span className="muted">{t.label}:</span> {t.total ? `${formatNumber(t.total)} place${t.total === 1 ? '' : 's'}, e.g. ${t.hits.slice(0, 3).map((h) => `“${h.value.slice(0, 50)}” (${h.endpoint.replace(/^ep\./, '')})`).join(', ')}` : 'nowhere'}</span>)}
      </Q>
      <Q title="Namespaces">
        <div className="stack">
          <div className="kv"><span className="t2">Profile</span><span className="mono small">{s.namespaces?.profile ?? '—'}</span></div>
          <div className="kv"><span className="t2">Dynamic</span><span className="mono small">{s.namespaces?.dynamic ?? '—'}</span></div>
          <div className="kv"><span className="t2">Static (detected from links)</span><span className="mono small">{s.namespaces?.staticDetected ?? 'none detected: static endpoints were skipped'}</span></div>
        </div>
      </Q>
    </div>
  );
}

function ProbeAreas({ summary: s }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="stack gap-24">
      {s.areas.map((area) => {
        const list = s.entries.filter((e) => e.area === area.id);
        if (list.length === 0) return null;
        return (
          <div key={area.id} className="stack gap-8">
            <div className="row gap-10">
              <h3 className="h3">{area.label}</h3>
              <span className="muted xsmall">{formatNumber(area.answered)} answered · {formatNumber(area.notFound)} 404 · {formatNumber(area.other)} other · {formatNumber(area.skipped)} skipped{area.notAsked ? ` · ${formatNumber(area.notAsked)} not asked` : ''}</span>
            </div>
            <div className="tblbox listbox">
              <table className="tbl disc-catalog probe-stack">
                <thead><tr><th scope="col">Endpoint</th><th scope="col">Tried</th><th scope="col">Answer</th><th scope="col" className="r">Size</th><th scope="col" className="r">Items</th><th scope="col"><span className="sr-only">Field outline</span></th></tr></thead>
                <tbody>
                  {list.flatMap((e) => {
                    const best = e.attempts.find((a) => a.responseId === e.best) ?? null;
                    const outline = best ? s.skeletons?.[best.responseId] : null;
                    const rows = [(
                      <tr key={e.id} className={open === e.id ? 'me' : undefined}>
                        <td className="mono xsmall" data-label="Endpoint">{short(e.template)}{e.flags.map((f) => <span key={f} className="tag probe-flag">{FLAG[f]}</span>)}</td>
                        <td className="xsmall" data-label="Tried">
                          {e.skipped ? <span className="t2">Skipped: {e.skipped}</span> : e.attempts.length === 0 ? <span className="t2">Not asked (stopped first)</span> : e.attempts.map((a) => (
                            <div key={a.responseId}><span className="mono">{a.path}</span> <span className="muted">{a.namespace} · {a.basis}</span></div>
                          ))}
                        </td>
                        <td data-label="Answer"><div className="row gap-4">{e.attempts.length ? e.attempts.map((a) => <span key={a.responseId} className={`tag ${statusTag(a.status)}`}>{a.status ?? a.error ?? 'no answer'}</span>) : <span className={`tag ${OUTCOME[e.outcome]}`}>{e.outcome}</span>}</div></td>
                        <td className="r" data-label="Size">{best ? formatBytes(best.bytes) ?? '—' : '—'}</td>
                        <td className="r" data-label="Items">{best?.count === null || best?.count === undefined ? '—' : `${formatNumber(best.count)}`}</td>
                        <td className="r probe-fields">{outline && <button type="button" className="btn sm ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Fields'}</button>}</td>
                      </tr>
                    )];
                    if (open === e.id && outline) {
                      rows.push(<tr key={`${e.id}-outline`}><td colSpan={6}><pre className="disc-pre">{Object.entries(outline).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre></td></tr>);
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {s.entries.length === 0 && <EmptyState kind="nodata" compact title="No endpoints recorded" />}
    </div>
  );
}
