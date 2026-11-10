import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Segmented, Tabs } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { Figure, Q, Responses, duration, ms, statusTag } from './DiscoveryPage.jsx';

/**
 * The endpoint probe on /admin/discovery (0.8.3, server/discovery/probe/): every endpoint in Blizzard's WoW API docs,
 * tried once against one game version (0.10.0: any version in the registry, enabled for players or not, in a region
 * Everstats covers), and what answered: realms and their types, the statistic catalog compared with Forever's, each
 * group with Forever's choice as a SUGGESTION (nothing is applied), every board rule A7 would make and every field it
 * skips, and the render check (the admin's eyes decide). Admin only like the rest of the page. Discovery only: nothing here
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
  const [versions, setVersions] = useState(null);
  const [version, setVersion] = useState(last?.version ?? null);
  const [region, setRegion] = useState(last?.region ?? null);
  const [name, setName] = useState(last?.primary?.name ?? DEFAULTS.name);
  const [surname, setSurname] = useState(last?.primary?.surname ?? DEFAULTS.surname);
  const [realm, setRealm] = useState(last?.primary?.realmSlug ?? '');
  const [guild, setGuild] = useState(last?.guild?.name ?? DEFAULTS.guild);
  const [mine, setMine] = useState(null); // the prefill answer
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/admin/discovery/probe-versions').then((r) => {
      if (!live) return;
      setVersions(r.versions);
      setVersion((v) => v ?? r.primary);
      setRegion((x) => x ?? r.versions.find((y) => y.id === r.primary)?.regions[0] ?? null);
    }, (err) => {
      if (live) setProblem(err.message);
    });
    return () => {
      live = false;
    };
  }, []);
  const v = versions?.find((x) => x.id === version) ?? null;
  const prefill = async () => {
    setBusy('prefill');
    setProblem(null);
    try {
      const r = await api(`/api/admin/discovery/probe-characters?version=${encodeURIComponent(version)}&region=${encodeURIComponent(region)}`);
      setMine(r);
      if (r.pick) {
        setName(r.pick.name);
        setSurname(r.pick.surname ?? '');
        setRealm(r.pick.realmSlug ?? '');
      }
      if (r.guild) setGuild(r.guild.name);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  const start = async (e) => {
    e.preventDefault();
    setBusy('start');
    setProblem(null);
    try {
      const body = v?.realms ? { version, region, name, realm, guild } : { version, region, name, surname, guild };
      const { run } = await api('/api/admin/discovery/probes', { method: 'POST', body });
      onQueued(run);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="probe-h">
      <h2 className="h2 h2-panel" id="probe-h">Endpoint probe</h2>
      <p className="t2 small">
        Tries every endpoint in Blizzard’s WoW API docs (retail and classic) against one game version, once, and records
        what answers: a few hundred requests at the discovery rate below (more on a version with many realms: every
        realm is asked once). Ids come from real answers; a path with no real id to try is skipped, with the reason.
        Versions players can’t see yet can be probed: nothing from a probe is stored outside its own records.
        {state.grant ? ' Your Battle.net authorization reads your character list and protected-character.' : ' Without a Battle.net authorization, your character list can’t be read and protected-character is skipped.'}
      </p>
      {versions && (
        <div className="stack gap-10">
          <Segmented label="Game version" options={versions.map((x) => ({ id: x.id, label: `${x.short}${x.enabledForPlayers ? '' : ' (off)'}` }))} value={version} onChange={(id) => { setVersion(id); setMine(null); setRegion(versions.find((x) => x.id === id)?.regions[0] ?? null); }} />
          {v && <Segmented label="Region" options={v.regions.map((id) => ({ id, label: id.toUpperCase() }))} value={region} onChange={(id) => { setRegion(id); setMine(null); }} />}
          {v && <span className="muted xsmall">{v.name}: {v.realms ? `characters live on realms; tiers and boards would be graded within each ${v.categoryLabel}` : `realmless; graded within each ${v.categoryLabel}`}{v.enabledForPlayers ? '' : '. Not shown to players yet.'}</span>}
        </div>
      )}
      <form className="stack gap-14" onSubmit={start}>
        <div className="row gap-10">
          <Button className="sm" loading={busy === 'prefill'} disabled={!v || !region || !state.grant} onClick={prefill} title={state.grant ? 'Read your Battle.net character list on this version (stores nothing)' : 'Authorize Battle.net on this page first'}><Icon name="refresh" size="sm" />Use my highest-level character</Button>
          {mine?.note && <span className="t2 small" role="status">{mine.note}</span>}
        </div>
        {mine?.characters?.length > 0 && (
          <span className="muted xsmall">Your characters on {v?.name}: {mine.characters.map((c) => `${[c.name, c.surname].filter(Boolean).join(' ')}${c.realmSlug ? ` (${c.realmSlug})` : ''} ${c.level ?? '?'}`).join(', ')}</span>
        )}
        <div className="grid-auto col-md gap-12">
          <Field label="Character: name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          {v?.realms
            ? <Field label="Realm" value={realm} onChange={(e) => setRealm(e.target.value)} autoComplete="off" />
            : <Field label="Surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />}
        </div>
        <Field label={v?.realms ? 'Guild (on the character’s realm)' : 'Guild'} value={guild} onChange={(e) => setGuild(e.target.value)} autoComplete="off" />
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        <div className="row gap-10">
          <Button type="submit" className="gold" loading={busy === 'start'} disabled={Boolean(active) || !state.configured || !v}><Icon name="play" size="sm" />Probe {v?.short ?? '…'}</Button>
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
    ...(s.realms ? [{ id: 'realms', label: 'Realms', count: s.realms.players ?? s.realms.asked }] : []),
    ...(s.groups ? [{ id: 'groups', label: 'Statistics & groups', count: s.groups.length }] : []),
    ...(s.boards ? [{ id: 'boards', label: 'Boards', count: s.boards.total }] : []),
    { id: 'areas', label: 'By area', count: s.entryCount },
    { id: 'responses', label: 'Raw responses', count: s.requests },
  ];
  const setRender = async (verdict) => {
    setBusy(`render-${verdict ?? 'clear'}`);
    try {
      setRun((await api(`/api/admin/discovery/runs/${runId}/render-check`, { method: 'POST', body: { verdict } })).run);
      toast.ok('Render check saved', verdict ? (verdict === 'right' ? 'Draws the right race.' : 'Draws the wrong race.') : 'Cleared.');
    } catch (err) {
      toast.err('Couldn’t save the render check', err.message);
    }
    setBusy(null);
  };
  return (
    <section className="panel clip stack gap-14" aria-labelledby="probe-detail-h">
      <div className="row gap-12 panel-head-row">
        <h2 className="h2 h2-panel" id="probe-detail-h">Probe #{run.id}</h2>
        <span className="muted small">{s.versionName ?? 'WoW Forever'}{s.region ? ` (${s.region.toUpperCase()})` : ''} · {s.primary ? [s.primary.name, s.primary.surname].filter(Boolean).join(' ') : '—'}{s.primary?.realmSlug ? ` (${s.primary.realmSlug})` : ''} · {s.guild?.name ?? '—'} · {run.status} {formatDateTime(run.finishedAt)} · analysed with v{s.analysedWith}</span>
        <span className="spacer" />
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.json`} download><Icon name="download" size="sm" />JSON</a>
        <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export.csv`} download><Icon name="download" size="sm" />CSV</a>
        {s.boards && <a className="btn sm" href={`/api/admin/discovery/runs/${run.id}/export-boards.csv`} download><Icon name="download" size="sm" />Boards CSV</a>}
        <Button className="sm ghost" loading={busy === 'reanalyse'} onClick={reanalyse} title="Rebuild the results and answers from the stored responses. Asks Blizzard nothing."><Icon name="refresh" size="sm" />Re-analyse</Button>
      </div>
      <div className="pad-x-20 stack gap-12">
        {s.primaryMissing && (
          <div className="note err small" role="status"><Icon name="error" /><span><b>The probe’s character didn’t answer.</b> {s.answers.find((a) => a.id === 'primary-character')?.text ?? 'Its profile answered no 200.'}</span></div>
        )}
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
        {tab === 'answers' && <><ProbeRender summary={s} busy={busy} onSet={setRender} /><ProbeAnswers summary={s} /></>}
        {tab === 'realms' && <ProbeRealms summary={s} />}
        {tab === 'groups' && <ProbeGroups summary={s} />}
        {tab === 'boards' && <ProbeBoards summary={s} />}
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
          {s.staticCheck && <div className="kv"><span className="t2">Static (used, after the check)</span><span className="mono small">{s.staticCheck.chosen ?? 'none'}</span></div>}
        </div>
        {s.staticCheck && (
          <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Namespace tried</th><th scope="col">Why</th><th scope="col">Answers</th><th scope="col" className="r">Items</th></tr></thead><tbody>
            {s.staticCheck.candidates.map((c) => (
              <tr key={c.ns}>
                <td className="mono xsmall" data-label="Namespace tried">{c.ns}{c.ns === s.staticCheck.chosen && <span className="tag ok">used</span>}</td>
                <td className="xsmall" data-label="Why">{c.why}</td>
                <td className="xsmall" data-label="Answers">{c.results.map((r) => `${r.entry.replace(/^data\./, '')} ${r.status ?? 'no answer'}`).join(', ')}</td>
                <td className="r" data-label="Items">{formatNumber(c.items)}</td>
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

/** The render beside the race Blizzard names: only the admin's eyes can say whether it draws it. */
function ProbeRender({ summary: s, busy, onSet }) {
  const r = s.render;
  if (!r) return null;
  return (
    <div className="stack gap-10 probe-answer">
      <div className="row gap-8"><span className={`tag ${VERDICT[r.verdict === 'right' ? 'yes' : r.verdict === 'wrong' ? 'no' : 'unknown'].tag}`}>{r.verdict === 'right' ? 'Right race' : r.verdict === 'wrong' ? 'Wrong race' : 'Not checked'}</span><span className="muted xsmall">Renders</span></div>
      <b className="small">Does the render draw {r.race ?? 'the race Blizzard names'}{r.gender ? ` (${r.gender})` : ''}?</b>
      {r.main ? <img src={r.main} alt={`Blizzard's render of the probed character (Blizzard says: ${r.race ?? 'race not named'})`} loading="lazy" style={{ maxWidth: 360, width: '100%', height: 'auto' }} /> : <span className="t2 small">{r.text}</span>}
      {r.main && (
        <div className="row gap-8">
          <Button className="sm" loading={busy === 'render-right'} onClick={() => onSet('right')}>Draws the right race</Button>
          <Button className="sm" loading={busy === 'render-wrong'} onClick={() => onSet('wrong')}>Wrong race</Button>
          {r.verdict && <Button className="sm ghost" loading={busy === 'render-clear'} onClick={() => onSet(null)}>Clear</Button>}
        </div>
      )}
      {Object.keys(r.urls ?? {}).length > 0 && <span className="muted xsmall mono">{Object.entries(r.urls).map(([k, u]) => `${k}: ${u}`).join('  ·  ')}</span>}
    </div>
  );
}

function ProbeRealms({ summary: s }) {
  const r = s.realms;
  return (
    <div className="stack gap-16">
      <span className="t2 small">{formatNumber(r.answered)} of {formatNumber(r.asked)} realms answered{r.capped ? ` (realm/index listed more; the first ${formatNumber(r.capped)} were asked)` : ''}{r.players !== undefined ? `: ${formatNumber(r.players)} player realms, ${formatNumber(r.excluded?.length ?? 0)} internal realms excluded${r.exclusionKnown ? '' : ' (connected-realm/index didn’t answer, so none could be told apart)'}` : ''}. {r.tournament ? `${formatNumber(r.tournament)} tournament realm(s).` : ''}</span>
      {r.rules && <span className="muted xsmall">{r.rules.players} {r.rules.locked}</span>}
      <div className="grid-auto col-md gap-12">
        <Figure label="By realm type" value={formatNumber(r.byType.length)} note={r.byType.map((t) => `${t.value} ×${t.realms}`).join(', ') || 'none'} />
        <Figure label="By category" value={formatNumber(r.byCategory.length)} note={r.byCategory.map((t) => `${t.value} ×${t.realms}`).join(', ') || 'none'} />
        {r.lockKnown > 0 && <Figure label="Locked" value={`${formatNumber(r.locked)} of ${formatNumber(r.lockKnown)}`} note={(r.lockByCategory ?? []).map((c) => `${c.category}: ${c.locked} locked, ${c.open} open`).join(' · ')} />}
      </div>
      <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Realm</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Time zone · locale</th><th scope="col">Other</th></tr></thead><tbody>
        {r.realms.filter((x) => !x.excluded).map((x) => (
          <tr key={x.slug}>
            <td className="small" data-label="Realm">{x.name ?? x.slug} <span className="muted mono xsmall">{x.slug}{x.id !== null && x.id !== undefined ? ` · ${x.id}` : ''}</span></td>
            <td className="small" data-label="Type">{x.answered ? (x.type ? `${x.type.type ?? '?'} (${x.type.name ?? '?'})` : '—') : <span className={`tag ${statusTag(x.status)}`}>{x.status ?? 'no answer'}</span>}</td>
            <td className="small" data-label="Category">{x.category ?? '—'}</td>
            <td className="xsmall" data-label="Time zone · locale">{[x.timezone, x.locale].filter(Boolean).join(' · ') || '—'}</td>
            <td className="xsmall" data-label="Other">{[x.locked === true ? 'locked' : x.locked === false ? 'open' : null, x.isTournament ? 'tournament' : null, ...Object.entries(x.extra ?? {}).map(([k, val]) => `${k}: ${val}`)].filter(Boolean).join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody></table></div>
      {r.excluded?.length > 0 && (
        <Q title={`Excluded: internal realms (${formatNumber(r.excluded.length)})`}>
          <span className="muted xsmall">On no realm list, no board, never crawled.</span>
          <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Realm</th><th scope="col">Blizzard category</th><th scope="col">Connected realm</th></tr></thead><tbody>
            {r.excluded.map((x) => (
              <tr key={x.slug}>
                <td className="small" data-label="Realm">{x.name ?? x.slug} <span className="muted mono xsmall">{x.slug}</span></td>
                <td className="small" data-label="Blizzard category">{x.category ?? '—'}</td>
                <td className="mono xsmall" data-label="Connected realm">{x.connectedRealmId ?? 'none named'} (not listed)</td>
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
    <div className="stack gap-24">
      {st ? (
        <Q title="The statistic catalog compared with Forever's">
          <div className="grid-auto col-md gap-12">
            <Figure label="Statistic ids here" value={formatNumber(st.probed)} note={`Forever has ${formatNumber(st.forever)}`} />
            <Figure label="Shared ids" value={formatNumber(st.shared)} note={`${formatNumber(st.sharedSameName)} same name · ${formatNumber(st.sharedRenamed.length)} renamed`} />
            <Figure label="New here / missing here" value={`${formatNumber(st.new.length)} / ${formatNumber(st.missing.length)}`} note="full lists in the JSON export" />
          </div>
          <span className="t2 small">Top categories only here: {st.categories.onlyHere.join(', ') || 'none'} · only on Forever: {st.categories.onlyForever.join(', ') || 'none'} · both: {st.categories.both.join(', ') || 'none'}.</span>
          <span className="muted xsmall">Nothing is copied: decisions are made per version on the Discovery page (0.11.0).</span>
        </Q>
      ) : <span className="t2 small">{s.primaryMissing ? 'Not measured: the probe’s character answered no profile, so there is no statistics answer to compare (not zero statistics).' : 'No achievement-statistics answer, so there is no catalog to compare.'}</span>}
      <Q title="Groups, with Forever's choice as a suggestion">
        {s.primaryMissing && <span className="t2 small">The statistic counts below are not measured: the probe’s character answered no profile. Only boards from data endpoints are counted.</span>}
        <span className="muted xsmall">A suggestion only: nothing is chosen for this version. A new version starts with every group undecided (no tiers) until you decide on the Discovery page. “Proposed” = a group Forever doesn’t have.</span>
        <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Group</th><th scope="col" className="r">Statistics</th><th scope="col" className="r">Ids matching Forever</th><th scope="col" className="r">Other boards</th><th scope="col">Suggestion</th></tr></thead><tbody>
          {s.groups.map((g) => (
            <tr key={g.label}>
              <td className="small" data-label="Group">{g.label}{g.proposed && <span className="tag probe-flag">proposed</span>}</td>
              <td className="r" data-label="Statistics">{formatNumber(g.statistics)}</td>
              <td className="r" data-label="Ids matching Forever">{formatNumber(g.matchForever)}</td>
              <td className="r" data-label="Other boards">{formatNumber(g.boards)}</td>
              <td className="small" data-label="Suggestion">{g.forever.text}<div className="muted xsmall">{g.forever.basis}</div></td>
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
    <div className="stack gap-24">
      {s.primaryMissing && <div className="note err small" role="status"><Icon name="error" /><span>Not measured: the probe’s character answered no profile, so the counts below are not zeros. Run the probe again with a character that answers.</span></div>}
      <span className="t2 small">Rule A7: every numeric value Blizzard returns is a board. {formatNumber(b.total)} boards from this character's (and guild's) answers. Other characters can have values this one hasn't, so the real count can be higher. The Boards CSV has every board, every skipped field and the realms.</span>
      <div className="grid-auto col-md gap-12">
        {b.groups.map((g) => <Figure key={g.group} label={g.group} value={formatNumber(g.boards)} note="boards" />)}
      </div>
      <Q title={`Skipped fields (${formatNumber(b.skipped.length)})`}>
        <span className="muted xsmall">Every field that isn't a board, with the rule that skipped it. Check this list for anything that should be one.</span>
        <div className="tblbox listbox"><table className="tbl probe-stack"><thead><tr><th scope="col">Feed</th><th scope="col">Field</th><th scope="col">Why not a board</th></tr></thead><tbody>
          {b.skipped.slice(0, shown).map((x) => <tr key={`${x.feed}|${x.path}|${x.rule}`}><td className="xsmall" data-label="Feed">{x.feed}</td><td className="mono xsmall" data-label="Field">{x.path}</td><td className="small" data-label="Why not a board">{x.reason}</td></tr>)}
        </tbody></table></div>
        {b.skipped.length > shown && <Button className="sm ghost" onClick={() => setShown(shown + 200)}>Show more</Button>}
      </Q>
      {b.overlaps?.length > 0 && <span className="muted xsmall">{formatNumber(b.overlaps.length)} PvP-summary field(s) are already collections family boards (pvp:…): listed once, as the family's.</span>}
    </div>
  );
}
