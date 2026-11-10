import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { MaintenanceNotice } from '../../chrome/MaintenanceBanner.jsx';
import { Field, Segmented } from '../../components/Controls.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { ActionButton, ActionStatus, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, useAction, useHit } from '../shell/parts.jsx';
import { useScope } from '../shell/scope.jsx';
import './release.css';

/**
 * Release tools (0.10.3, Site › Release tools, /admin/release): everything a deploy needs, so nothing needs a terminal.
 * Server: server/release/ (routes.js lists the endpoints).
 *
 *   Checklist     the guided Before deploy / After deploy run: each step is done from here (the server performs it),
 *                 its state and result shown in place, the run stored (release_runs) and every step in the Audit log
 *   Crawl         pause / resume: the SAME switch as Features › Background crawl
 *   Live version  the web process's version, CHANGELOG's newest and what the worker reports
 *   Tiers         regrade now, with live progress (queued → grading → done / failed)
 *   Snapshots     take a labelled snapshot of the version's numbers; compare any two
 *   Maintenance   the optional banner for players (#maintenance: settings search lands here)
 *
 * The v5 designs predate this page: it is built from their parts (panels, .dt tables, chips, ConfirmDialog, the
 * needs-you strip for the checklist's steps, .kvs, .kpi). Per version: the switcher's version + region scope the tiers
 * panel, snapshots and a new checklist run. A full grading always grades EVERY version (tiers/store.js gradeAll): the
 * page says so instead of pretending a regrade can target one.
 */
const POLL_MS = 3000;

const STATE_CHIP = {
  not_started: { kind: 'off', text: 'Not started' },
  working: { kind: 'run', text: 'Working' },
  done: { kind: 'ok', text: 'Done' },
  failed: { kind: 'err', text: 'Failed' },
};

/** Poll silently (no dimming) while `active`: a regrade waiting for the worker. */
function usePoll(active, load, apply) {
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load().then(apply).catch(() => {});
    }, POLL_MS);
    return () => {
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function ReleasePage() {
  const scope = useScope();
  const runs = usePanel('release-runs', () => api('/api/admin/release/runs'), []);
  const crawl = usePanel('release-crawl', () => api('/api/admin/release/crawl'), []);
  const live = usePanel('release-live', () => api('/api/admin/release/live'), []);
  const [watch, setWatch] = useState(null);
  const tiers = usePanel(`release-tiers`, () => api(`/api/admin/release/tiers?${scope.apiQuery}${watch ? `&run=${watch}` : ''}`), [scope.apiQuery, watch]);
  const snaps = usePanel('release-snapshots', () => api(`/api/admin/release/snapshots?${scope.apiQuery}&limit=30`), [scope.apiQuery]);
  const banner = usePanel('release-banner', () => api('/api/admin/release/banner'), []);
  useHit(runs.data && snaps.data && banner.data);

  // A step changed something another panel shows: refresh those panels too.
  const after = (what) => {
    if (what.includes('crawl')) crawl.reload();
    if (what.includes('tiers')) tiers.reload();
    if (what.includes('snapshots')) snaps.reload();
    if (what.includes('live')) live.reload();
  };

  return (
    <>
      <PageHead
        title="Release tools"
        desc="Everything a deploy needs, from this page: pause the crawl, regrade, take snapshots and compare them, and tell players about maintenance."
        chips={<ScopeChip />}
      />
      <ChecklistPanel panel={runs} scope={scope} onChanged={after} />
      <div className="cols2">
        <CrawlPanel panel={crawl} />
        <LivePanel panel={live} />
      </div>
      <TiersPanel panel={tiers} scope={scope} onWatch={setWatch} />
      <SnapshotsPanel panel={snaps} scope={scope} />
      <MaintenancePanel panel={banner} />
    </>
  );
}

// ---------------------------------------------------------------- checklist

function ChecklistPanel({ panel, scope, onChanged }) {
  const open = panel.data?.open ?? null;
  const working = Boolean(open?.steps.some((s) => s.state === 'working'));
  usePoll(working, () => api('/api/admin/release/runs'), (d) => {
    panel.setData(d);
    if (!d.open?.steps.some((s) => s.state === 'working')) onChanged(['tiers']);
  });
  return (
    <Panel panel={panel} title="Deploy checklist" id="checklist" ghostRows={3}>
      {(d) => (
        <>
          {d.open ? <OpenRun run={d.open} panel={panel} onChanged={onChanged} /> : <StartRun panel={panel} scope={scope} />}
          <RecentRuns runs={d.recent} />
        </>
      )}
    </Panel>
  );
}

function StartRun({ panel, scope }) {
  const [kind, setKind] = useState('before');
  const [label, setLabel] = useState('');
  const a = useAction();
  return (
    <div className="rel-start">
      <p className="small t2">
        Start the list before you deploy and again after. Each step is done from here; its result stays on the run and in the
        Audit log. Runs use the version you’re looking at: <b>{scope.versionName} · {scope.region.toUpperCase()}</b>.
      </p>
      <div className="rel-start-row">
        <Segmented label="Which checklist" value={kind} onChange={setKind}
          options={[{ id: 'before', label: 'Before deploy' }, { id: 'after', label: 'After deploy' }]} />
        <Field label="Release" placeholder="e.g. 0.11.0" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="rel-label" />
        <ActionButton action={a} className="btn gold sm" icon="play" disabled={!label.trim()}
          onRun={async () => {
            const r = await api('/api/admin/release/runs', { method: 'POST', body: { kind, label, version: scope.version, region: scope.region } });
            panel.setData({ ...panel.data, open: r.run });
            return r;
          }}
          done="Started">
          Start the {kind === 'before' ? 'before' : 'after'}-deploy checklist
        </ActionButton>
        <ActionStatus action={a} />
      </div>
      <ol className="rel-preview small t2">
        {kind === 'before'
          ? <><li>Pause the background crawl</li><li>Regrade tiers</li><li>Take a snapshot</li></>
          : <><li>Confirm the new version is live</li><li>Regrade tiers</li><li>Take a snapshot</li><li>Compare with the newest “before” snapshot</li><li>Resume the background crawl</li></>}
      </ol>
    </div>
  );
}

function OpenRun({ run, panel, onChanged }) {
  const finish = useAction();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const done = run.steps.filter((s) => s.state === 'done').length;
  const next = run.steps.find((s) => s.state !== 'done');
  const close = async (abandoned) => {
    const r = await api(`/api/admin/release/runs/${run.id}/finish`, { method: 'POST', body: { abandoned } });
    panel.reload();
    return r;
  };
  return (
    <div className="stack gap-12" id={`run-${run.id}`}>
      <div className={`needs rel-steps${done === run.steps.length ? ' clear' : ''}`}>
        <span className="t"><Icon name={done === run.steps.length ? 'check-circle' : 'flags'} />{run.kind === 'before' ? 'Before' : 'After'} deploy · {run.label} · {done} of {run.steps.length}</span>
        {run.steps.map((s, i) => (
          <a key={s.id} className={`it ${s.state === 'failed' ? 'err' : s.state === 'done' ? 'ok' : s.state === 'working' ? 'info' : ''}`} href={`#step-${s.id}`}>
            <Icon name={s.state === 'done' ? 'check' : s.state === 'failed' ? 'x-circle' : s.state === 'working' ? 'refresh' : 'clock'} />
            <b>{i + 1}</b> {s.label}
          </a>
        ))}
      </div>
      <p className="small t2">
        {run.scope ? <>For {run.scope.version} · {run.scope.region.toUpperCase()}. </> : null}
        Started {formatDateTime(run.startedAt)}.{next ? <> Next: <b>{next.label}</b>.</> : <> Every step is done.</>}
      </p>
      <div className="rlist rel-rlist">
        {run.steps.map((s, i) => <StepRow key={s.id} run={run} step={s} n={i + 1} panel={panel} onChanged={onChanged} isNext={next?.id === s.id} />)}
      </div>
      <div className="row gap-8 wrap-row">
        <ActionButton action={finish} className={`btn sm${next ? '' : ' gold'}`} icon="check" onRun={() => close(false)} done="Finished">Finish this checklist</ActionButton>
        <button type="button" className="btn ghost sm" onClick={() => setConfirmAbandon(true)}>Abandon</button>
        <ActionStatus action={finish} />
      </div>
      {confirmAbandon && (
        <ConfirmDialog title="Abandon this checklist?" danger confirmLabel="Abandon checklist" reasonRequired={false}
          what="The run is closed as abandoned and stays in the history with the steps done so far. Nothing is undone: a paused crawl stays paused until you resume it."
          playersSee={false} onClose={() => setConfirmAbandon(false)} onConfirm={() => close(true)} />
      )}
    </div>
  );
}

const STEP_HELP = {
  pause: 'Stops the daily refresh, roster expansion, guild fetches and the collections backfill, so numbers hold still. Lookups, sign-ins and their auto-fetch still run.',
  regrade: 'Asks the worker for a full tier grading (it starts after 30 s without another request). A grading covers every game version.',
  snapshot: 'Records this version’s numbers, labelled with this run.',
  version: 'Checks the web process, CHANGELOG’s newest and the worker report the same version.',
  compare: 'Compares this run’s snapshot with the newest snapshot of a “before” run.',
  resume: 'Turns the background crawl back on.',
};

function StepRow({ run, step, n, panel, onChanged, isNext }) {
  const a = useAction();
  const [ask, setAsk] = useState(false);
  const chip = STATE_CHIP[step.state] ?? STATE_CHIP.not_started;
  const go = (body = {}) => a.run(async () => {
    const r = await api(`/api/admin/release/runs/${run.id}/steps/${step.id}`, { method: 'POST', body });
    panel.setData({ ...panel.data, open: r.run });
    onChanged({ pause: ['crawl'], resume: ['crawl'], regrade: ['tiers'], snapshot: ['snapshots'], compare: ['snapshots'], version: ['live'] }[step.id] ?? []);
    const s = r.run.steps.find((x) => x.id === step.id);
    if (s?.state === 'failed') throw new Error(s.result ?? 'Failed');
    return s;
  }, { done: (s) => (s?.state === 'working' ? 'Requested' : 'Done'), working: step.id === 'snapshot' ? 'Taking the snapshot…' : 'Working…' });
  const verb = step.state === 'not_started' ? 'Do it' : 'Do it again';
  return (
    <div id={`step-${step.id}`} className={isNext ? 'is-next' : undefined}>
      <span className="rel-n" aria-hidden="true">{n}</span>
      <div className="stack gap-4 rel-step-body">
        <b>{step.label}</b>
        <span className="xsmall muted">{STEP_HELP[step.id]}</span>
        <span className="row gap-6 wrap-row">
          <Chip kind={chip.kind}>{chip.text}</Chip>
          {step.result && <span className="small t2 rel-result">{step.result}</span>}
          {step.at && <span className="xsmall muted">{timeAgo(step.at)}</span>}
        </span>
      </div>
      <div className="act rel-step-act">
        <button type="button" className={`btn sm${isNext ? ' gold' : ''}${a.busy ? ' is-loading' : ''}`} disabled={a.busy || step.state === 'working'} aria-busy={a.busy || undefined}
          onClick={() => (step.needsReason ? setAsk(true) : go())}>
          {verb}
        </button>
        <ActionStatus action={a} />
      </div>
      {ask && (
        <ConfirmDialog
          title={step.id === 'pause' ? 'Pause the background crawl?' : 'Resume the background crawl?'}
          what={step.id === 'pause'
            ? 'The daily refresh, roster expansion, guild fetches and the collections backfill wait until you resume. Lookups, sign-ins and their auto-fetch still run, because a person is waiting on them. This is the same switch as Features › Background crawl.'
            : 'The daily refresh, roster expansion, guild fetches and the collections backfill start again. Same switch as Features › Background crawl.'}
          playersSee={false} danger={step.id === 'pause'} confirmLabel={step.id === 'pause' ? 'Pause the crawl' : 'Resume the crawl'}
          onClose={() => setAsk(false)}
          onConfirm={async (reason) => {
            await go({ reason });
          }} />
      )}
    </div>
  );
}

function RecentRuns({ runs }) {
  if (!runs.length) return <p className="small muted">No finished checklists yet.</p>;
  return (
    <div className="stack gap-6">
      <span className="eyebrow">Earlier checklists</span>
      <div className="dt-wrap">
        <table className="dt">
          <thead><tr><th>Checklist</th><th>Started</th><th>Steps</th><th>Ended</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} id={`run-${r.id}`} className={r.abandonedAt ? 'is-fail' : undefined}>
                <td className="dtl" data-label="Checklist"><b>{r.kind === 'before' ? 'Before' : 'After'} deploy · {r.label}</b>{r.scope && <span className="sub">{r.scope.version} · {r.scope.region.toUpperCase()}</span>}</td>
                <td data-label="Started" className="nw">{formatDateTime(r.startedAt)}</td>
                <td data-label="Steps">
                  <span className="row gap-4 wrap-row">
                    {r.steps.map((s) => <Chip key={s.id} kind={(STATE_CHIP[s.state] ?? STATE_CHIP.not_started).kind} title={s.result ?? undefined}>{s.label}</Chip>)}
                  </span>
                </td>
                <td data-label="Ended" className="nw">{r.abandonedAt ? <Chip kind="warn">Abandoned {formatDateTime(r.abandonedAt)}</Chip> : <Chip kind="ok">Finished {formatDateTime(r.finishedAt)}</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- crawl and live version

function CrawlPanel({ panel }) {
  const [ask, setAsk] = useState(false);
  return (
    <Panel panel={panel} title="Background crawl" id="crawl" sub={<ScopeChip global />} ghostRows={3}>
      {({ crawl }) => (
        <>
          <div className="bigstatus">
            {crawl.on ? <Chip kind="ok" icon="play">Running</Chip> : <Chip kind="warn" icon="pause">Paused</Chip>}
            <button type="button" className={`btn sm${crawl.on ? '' : ' gold'}`} onClick={() => setAsk(true)}>
              <Icon name={crawl.on ? 'pause' : 'play'} size="sm" />{crawl.on ? 'Pause the crawl' : 'Resume the crawl'}
            </button>
          </div>
          <p className="small t2">
            Paused stops the daily refresh, roster expansion, guild fetches and the collections backfill.{' '}
            <b>Lookups and sign-ins still run while paused</b> (and their auto-fetch), because a person is waiting on them.
            This is the same switch as Features › Background crawl.
          </p>
          <dl className="kvs">
            <dt>Waiting in the queue</dt><dd>{formatNumber(crawl.queued)}{crawl.queued >= 100000 ? '+' : ''} item(s)</dd>
            <dt>Last changed</dt><dd>{crawl.changedAt ? `${formatDateTime(crawl.changedAt)}${crawl.reason ? ` · “${crawl.reason}”` : ''}` : 'Never (the default: running)'}</dd>
          </dl>
          {ask && (
            <ConfirmDialog
              title={crawl.on ? 'Pause the background crawl?' : 'Resume the background crawl?'}
              what={crawl.on
                ? 'The daily refresh, roster expansion, guild fetches and the collections backfill wait until you resume. Lookups, sign-ins and their auto-fetch still run.'
                : 'The daily refresh, roster expansion, guild fetches and the collections backfill start again.'}
              playersSee={false} danger={crawl.on} confirmLabel={crawl.on ? 'Pause the crawl' : 'Resume the crawl'}
              onClose={() => setAsk(false)}
              onConfirm={async (reason) => {
                const r = await api('/api/admin/release/crawl', { method: 'POST', body: { on: !crawl.on, reason } });
                panel.setData(r);
              }} />
          )}
        </>
      )}
    </Panel>
  );
}

function LivePanel({ panel }) {
  return (
    <Panel panel={panel} title="Is the new version live?" id="live" sub={<ScopeChip global />} ghostRows={3}>
      {({ live }) => {
        const w = live.workers.find((x) => x.responding) ?? live.workers[0] ?? null;
        return (
          <>
            <div className="bigstatus">{live.live ? <Chip kind="ok">Live: {live.changelog}</Chip> : <Chip kind="warn">Not all on {live.changelog ?? 'one version'}</Chip>}</div>
            <dl className="kvs">
              <dt>Web process</dt><dd><span className="mono2">{live.web}</span> {live.web === live.changelog ? <Chip kind="ok">matches</Chip> : <Chip kind="err">differs</Chip>}</dd>
              <dt>CHANGELOG’s newest</dt><dd><span className="mono2">{live.changelog ?? 'couldn’t read'}</span></dd>
              <dt>Worker</dt>
              <dd>
                {w ? (
                  <>
                    <span className="mono2">{w.version}</span>{' '}
                    {w.responding ? (w.version === live.changelog ? <Chip kind="ok">matches</Chip> : <Chip kind="err">differs</Chip>) : <Chip kind="err">Not responding</Chip>}
                    <span className="xsmall muted"> · last heartbeat {timeAgo(w.lastTickAt)}</span>
                  </>
                ) : <span className="muted">No worker has reported</span>}
              </dd>
            </dl>
            {live.problems.length > 0 && <ul className="small t2 rel-problems">{live.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </>
        );
      }}
    </Panel>
  );
}

// ---------------------------------------------------------------- tiers

const TIER_CHIP = { queued: 'run', grading: 'run', done: 'ok', failed: 'err' };

function TiersPanel({ panel, scope, onWatch }) {
  const a = useAction();
  const t = panel.data?.tiers;
  const current = t?.run ?? t?.inFlight ?? null;
  const active = current && ['queued', 'grading'].includes(current.status);
  usePoll(Boolean(active), () => api(`/api/admin/release/tiers?${scope.apiQuery}${current ? `&run=${current.id}` : ''}`), (d) => panel.setData(d));
  return (
    <Panel panel={panel} title="Regrade tiers" id="regrade" sub={<ScopeChip />} ghostRows={3}>
      {({ tiers }) => {
        const shown = tiers.run ?? tiers.inFlight;
        return (
          <>
            <p className="small t2">
              Asks the worker for a full grading of letter tiers now, instead of waiting for the next one. It starts after 30 seconds
              without another request. <b>A grading always grades every game version at once</b>: it can’t be limited to{' '}
              {scope.versionName}. The numbers below are {scope.versionName} · {scope.region.toUpperCase()}’s.
            </p>
            <div className="row gap-8 wrap-row">
              <ActionButton action={a} className="btn gold sm" icon="refresh" disabled={Boolean(active)}
                onRun={async () => {
                  const r = await api('/api/admin/release/tiers', { method: 'POST', body: { version: scope.version, region: scope.region } });
                  onWatch(r.tiers.run?.id ?? null);
                  panel.setData(r);
                  return r;
                }}
                done="Requested">
                Regrade now
              </ActionButton>
              <ActionStatus action={a} />
            </div>
            {shown && (
              <div className="rel-progress" role="status" aria-live="polite">
                <Chip kind={TIER_CHIP[shown.status] ?? 'info'}>
                  {shown.status === 'queued' ? 'Queued' : shown.status === 'grading' ? 'Grading' : shown.status === 'done' ? 'Done' : 'Failed'} · grading #{shown.id}
                </Chip>
                <span className="small t2">
                  {shown.status === 'queued' && `Requested ${timeAgo(shown.requestedAt)}; the worker starts it after 30 s without another request.`}
                  {shown.status === 'grading' && `Started ${timeAgo(shown.startedAt)}: grading every version.`}
                  {shown.status === 'done' && `Finished ${formatDateTime(shown.finishedAt)} in ${formatNumber(shown.ms)} ms: ${shown.rulesetsAll} realm categor${shown.rulesetsAll === 1 ? 'y' : 'ies'} across every version; ${formatNumber(shown.characters)} tier-eligible characters on this version.`}
                  {shown.status === 'failed' && `Failed ${formatDateTime(shown.finishedAt)}: ${shown.problem ?? 'no reason recorded'}.`}
                </span>
              </div>
            )}
            <div className="kpis">
              <div className="kpi"><span className="l">Last full grading</span><span className="v rel-kpi-v">{tiers.last ? timeAgo(tiers.last.finishedAt) : 'Never'}</span><span className="d">{tiers.last ? `${formatDateTime(tiers.last.finishedAt)} · ${(tiers.last.reasons ?? []).join(', ')}` : 'No full grading has finished yet'}</span></div>
              <div className="kpi"><span className="l">Tier-eligible characters</span><span className="v">{formatNumber(tiers.stored.population)}</span><span className="d">in {formatNumber(tiers.stored.rulesets)} realm categor{tiers.stored.rulesets === 1 ? 'y' : 'ies'} at the last grading</span></div>
              <div className="kpi"><span className="l">With a letter</span><span className="v">{formatNumber(tiers.stored.lettered)}</span><span className="d">{formatNumber(tiers.stored.graded)} categor{tiers.stored.graded === 1 ? 'y' : 'ies'} above the minimum</span></div>
            </div>
            {tiers.lastFailed && <div className="perr" role="alert"><Icon name="error" /><span>The newest grading failed ({formatDateTime(tiers.lastFailed.finishedAt)}): {tiers.lastFailed.problem ?? 'no reason recorded'}.</span></div>}
          </>
        );
      }}
    </Panel>
  );
}

// ---------------------------------------------------------------- snapshots

function SnapshotsPanel({ panel, scope }) {
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState([]);
  const [result, setResult] = useState(null);
  const take = useAction();
  const cmp = useAction();
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  return (
    <Panel panel={panel} title="Snapshots" id="snapshots" sub={<ScopeChip />} flush>
      {({ snapshots }) => (
        <>
          <div className="rel-pad stack gap-10">
            <p className="small t2">
              A snapshot records {scope.versionName} · {scope.region.toUpperCase()}’s numbers: character counts, a hash of every
              statistic value, the ten most-populated boards per ruleset, gains, letter counts and hashes, what counts toward
              tiers, guild totals{scope.version === 'forever' ? ' and the sample character (Path Vexley)' : ''}. Take one before
              a deploy and one after, then compare. Its numbers come from Blizzard data, so they are deleted after 29 days (the
              30-day rule); the label stays.
            </p>
            <div className="row gap-8 wrap-row rel-take">
              <Field label="Label" placeholder="e.g. before 0.11.0" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className="rel-label" />
              <ActionButton action={take} className="btn gold sm" icon="archive" disabled={!label.trim()} working="Taking the snapshot…"
                onRun={async () => {
                  const r = await api('/api/admin/release/snapshots', { method: 'POST', body: { label, version: scope.version, region: scope.region } });
                  setLabel('');
                  panel.reload();
                  return r;
                }}
                done={(r) => `Snapshot #${r.snapshot.id}: ${formatNumber(r.snapshot.characters)} characters`}>
                Take a snapshot
              </ActionButton>
              <ActionStatus action={take} />
            </div>
          </div>
          {snapshots.length === 0 ? (
            <Empty icon="archive" title="No snapshots of this version yet">Take one before your next deploy.</Empty>
          ) : (
            <>
              <div className="tbar">
                <span className="cnt">Pick two to compare ({picked.length} of 2)</span>
                <span className="spacer" />
                <ActionButton action={cmp} className="btn sm" icon="sync" disabled={picked.length !== 2}
                  onRun={async () => {
                    const r = await api('/api/admin/release/compare', { method: 'POST', body: { a: picked[0], b: picked[1] } });
                    setResult(r.compare);
                    return r;
                  }}
                  done={(r) => (r.compare.identical ? 'Identical' : 'Different')}>
                  Compare
                </ActionButton>
                <ActionStatus action={cmp} />
              </div>
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th>Compare</th><th>Snapshot</th><th>Taken</th><th>App version</th><th className="r">Characters</th><th>Data</th></tr></thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id} id={`snap-${s.id}`} className={picked.includes(s.id) ? 'is-sel' : undefined}>
                        <td data-label="Compare">
                          <label className="check rel-pick">
                            <input type="checkbox" checked={picked.includes(s.id)} disabled={!s.hasData} onChange={() => toggle(s.id)} aria-label={`Compare “${s.label}”`} />
                          </label>
                        </td>
                        <td className="dtl" data-label="Snapshot"><b>{s.label}</b><span className="sub">#{s.id}{s.runKind ? ` · ${s.runKind}-deploy checklist` : ''}</span></td>
                        <td data-label="Taken" className="nw">{formatDateTime(s.takenAt)}</td>
                        <td data-label="App version"><span className="mono2">{s.appVersion}</span></td>
                        <td data-label="Characters" className="r num">{s.hasData ? formatNumber(s.characters) : '—'}</td>
                        <td data-label="Data">{s.hasData ? <Chip kind="ok">Kept</Chip> : <Chip kind="off">Data aged out (30-day rule)</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {result && <CompareResult r={result} />}
        </>
      )}
    </Panel>
  );
}

function CompareResult({ r }) {
  const differ = r.sections.filter((s) => !s.same);
  return (
    <div className="rel-pad stack gap-10 rel-compare" id="compare">
      <div className="row gap-8 wrap-row">
        {r.identical ? <Chip kind="ok">Identical</Chip> : r.onlyNewCharacters ? <Chip kind="info">Only new characters</Chip> : <Chip kind="warn">{differ.length} check(s) differ</Chip>}
        <span className="small"><b>{r.a.label}</b> ({formatDateTime(r.a.takenAt)}, {r.a.appVersion}) → <b>{r.b.label}</b> ({formatDateTime(r.b.takenAt)}, {r.b.appVersion})</span>
      </div>
      <p className="small">{r.summary}</p>
      {r.scopeNote && <p className="small t2">{r.scopeNote}</p>}
      <div className="rlist rel-sections">
        {r.sections.map((s) => (
          <div key={s.id}>
            {s.same ? <Chip kind="ok">Same</Chip> : <Chip kind="warn">Differs</Chip>}
            <div className="stack gap-4">
              <b className="small">{s.label}</b>
              {s.lines.length > 0 && <ul className="small t2 rel-lines">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </div>
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- maintenance banner

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (s) => (s ? new Date(s).toISOString() : null);

function bannerState(v, now = Date.now()) {
  if (!v) return { kind: 'off', text: 'Off' };
  if (v.end && now >= Date.parse(v.end)) return { kind: 'off', text: 'Ended' };
  if (v.start && now < Date.parse(v.start)) return { kind: 'info', text: `Scheduled: from ${formatDateTime(v.start)}` };
  return { kind: 'vis', text: 'Showing to players now' };
}

function MaintenancePanel({ panel }) {
  return (
    <Panel panel={panel} title="Maintenance banner" id="maintenance" sub={<ScopeChip global />} ghostRows={3}>
      {({ banner }) => <MaintenanceEditor key={JSON.stringify(banner.value)} banner={banner} panel={panel} />}
    </Panel>
  );
}

function MaintenanceEditor({ banner, panel }) {
  const v = banner.value;
  const [text, setText] = useState(v?.text ?? '');
  const [start, setStart] = useState(toLocalInput(v?.start));
  const [end, setEnd] = useState(toLocalInput(v?.end));
  const [ask, setAsk] = useState(null); // 'save' | 'off'
  const st = bannerState(v);
  const draft = { text: text.trim(), start: fromLocalInput(start), end: fromLocalInput(end) };
  const changed = !v || v.text !== draft.text || (v.start ?? null) !== draft.start || (v.end ?? null) !== draft.end;
  const problem = draft.text.length > 0 && draft.text.length < 5 ? 'At least 5 characters.'
    : /[<>]/.test(draft.text) ? 'Plain text: no angle brackets.'
      : draft.start && draft.end && draft.end <= draft.start ? 'The end is before the start.' : null;
  const save = async (value, reason) => {
    await api('/api/admin/settings/maintenance.banner', { method: 'PUT', body: { value, reason } });
    panel.reload();
  };
  return (
    <>
      <div className="row gap-8 wrap-row">
        <Chip kind={st.kind}>{st.text}</Chip>
        {banner.changedAt && <span className="xsmall muted">Last changed {formatDateTime(banner.changedAt)}{banner.reason ? ` · “${banner.reason}”` : ''}</span>}
      </div>
      <p className="small t2">
        An optional notice at the top of every page for players, between the start and end you set (empty start: from when you
        save; empty end: until you turn it off). Plain text on one line, up to 200 characters. Off by default.
      </p>
      <div className="stack gap-10 rel-banner-form">
        <Field label="Text" value={text} maxLength={200} placeholder="e.g. Everstats is updating at 15:00 UTC; pages may be slow for a few minutes."
          onChange={(e) => setText(e.target.value)} error={problem} inputClassName="wide" />
        <div className="row gap-10 wrap-row">
          <Field label="Start (your time)" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label="End (your time)" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {draft.text.length >= 5 && (
        <div className="stack gap-6">
          <span className="eyebrow">Preview: what players see</span>
          <div className="rel-preview-frame"><MaintenanceNotice text={draft.text} end={draft.end} /></div>
        </div>
      )}
      <div className="row gap-8 wrap-row">
        <button type="button" className="btn gold sm" disabled={!changed || !draft.text || Boolean(problem)} onClick={() => setAsk('save')}>
          <Icon name="check" size="sm" />{v ? 'Save the banner' : 'Turn the banner on'}
        </button>
        {v && <button type="button" className="btn ghost sm" onClick={() => setAsk('off')}><Icon name="eye-off" size="sm" />Turn off</button>}
      </div>
      {ask === 'save' && (
        <ConfirmDialog title={v ? 'Save the maintenance banner?' : 'Show a maintenance banner?'} danger={false} confirmLabel={v ? 'Save the banner' : 'Turn the banner on'}
          what={`Every page shows “${draft.text}” at the top ${draft.start ? `from ${formatDateTime(draft.start)}` : 'from now'} ${draft.end ? `until ${formatDateTime(draft.end)}` : 'until you turn it off'}.`}
          playersSee ack="Players will see this" onClose={() => setAsk(null)} onConfirm={(reason) => save(draft, reason)} />
      )}
      {ask === 'off' && (
        <ConfirmDialog title="Turn the maintenance banner off?" confirmLabel="Turn off"
          what="The banner disappears from every page (players' pages check again within 5 minutes, or on their next page load)."
          playersSee onClose={() => setAsk(null)} onConfirm={(reason) => save(null, reason)} />
      )}
    </>
  );
}
