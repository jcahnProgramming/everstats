import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { formatBytes, formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { PRIORITY, PRIORITY_VALUES } from '../../../../server/crawler/queue.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { Chip, Empty, PageHead, ScopeChip, useHit } from '../shell/parts.jsx';
import { useScope } from '../shell/scope.jsx';
import './site.css';

/**
 * Admin › Data (0.10.3, design/v5-admin pages data-crawler, data-collections, data-backups). Moved here from the old
 * single admin page: CrawlerSection (status, requests, queue, last error, back-offs, backfill line, Worker jobs),
 * CardsSection (renderer times, cache), CollectionsSection, BackupsSection.
 *
 * Different from the mockups, on purpose (CLAUDE.md rules win, or the data doesn't exist):
 *   - No "Pause crawl…" here: pause, roster seeding and the backfill are Features switches. Their state shows read only
 *     with a link to the switch.
 *   - Budget share per version is a CEILING per version (crawler.versionShares), not a split of 100%, so it is drawn as
 *     one bar per version, never a split bar that adds up to 100.
 *   - Requests are counted per UTC hour for the whole client (crawler_hours) and per minute by the worker, never per
 *     version: per version the page shows crawl items (queued, running, finished in the last hour), which are measured.
 *   - Worker jobs show what the worker records (last checked, last did its work, result); there is no per-job progress
 *     or attempt count, and no "Retry stuck job" (a job runs again on its own interval).
 *   - Backups: no "Back up now" or "Download latest" (the web app has no backup folder; downloading a dump that holds
 *     sealed keys through the browser is not something we do). By hand runs in the worker container.
 *   - Catalogs: a stuck build has no "Retry…" button: the hourly catalogs job resumes it by itself (collections/catalog.js).
 */

export const PRIORITY_NAMES = {
  [PRIORITY.lookup]: 'Someone waiting (lookups, sign-ins)',
  [PRIORITY.guild]: 'Guild fetches (“Fetch all members”)',
  [PRIORITY.auto]: 'Auto-fetch after sign-in',
  [PRIORITY.daily]: 'Daily refresh',
  [PRIORITY.roster]: 'Guild rosters and catalogs',
};

/** "3 h 20 m", "1 m 12 s", "41 s". */
export function duration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} m`;
  return `${Math.floor(h / 24)} d ${String(h % 24).padStart(2, '0')} h`;
}

/** An age as the retention page writes it: "28 d 21 h", "5 h 03 m". */
export const ageOf = (iso, now = Date.now()) => (iso ? duration(now - Date.parse(iso)) : '—');

export const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0);

export function Bar({ value, tone = '', label }) {
  return <div className={`bar sm ${tone}`} role="img" aria-label={label}><span style={{ width: `${value}%` }} /></div>;
}

/** The three Data tabs (each has its own address). */
function DataHead({ global = false }) {
  return (
    <PageHead title="Data" desc="The crawler, collections and catalogs, and backups."
      chips={<ScopeChip global={global} />}
      tabs={[
        { to: '/admin/data/crawler', label: 'Crawler' },
        { to: '/admin/data/collections', label: 'Collections & catalogs' },
        { to: '/admin/data/backups', label: 'Backups', keepScope: false },
      ]} />
  );
}

function FeatureState({ on, feature, onText, offText, label }) {
  return (
    <span className="row gap-6 site-switch">
      <Chip kind={on ? 'ok' : 'warn'}>{label}: {on ? onText : offText}</Chip>
      <Link className="small" to={`/admin/features#feat-${feature}`}>Change in Features</Link>
    </span>
  );
}

const CRAWL_STATE = {
  running: { kind: 'ok', text: 'Running' },
  idle: { kind: 'ok', text: 'Idle · nothing waiting' },
  paused: { kind: 'warn', text: 'Background crawl paused' },
  not_configured: { kind: 'warn', text: 'No Blizzard keys' },
  not_responding: { kind: 'err', text: 'Not responding' },
};

// ---------------------------------------------------------------------------------------------------------------
// Data › Crawler
// ---------------------------------------------------------------------------------------------------------------
export function CrawlerPage() {
  const { apiQuery, versionName, region } = useScope();
  const p = usePanel(`data-crawler-${apiQuery}`, () => api(`/api/admin/data/crawler?${apiQuery}`), [apiQuery]);
  const jobs = usePanel('data-jobs', () => api('/api/admin/data/jobs'), [], { everyMs: 5000 });
  const cards = usePanel('data-renderer', () => api('/api/admin/data/renderer'), []);
  useHit(p.data);
  const scopeName = `${versionName} · ${region.toUpperCase()}`;
  return (
    <>
      <DataHead />
      <Panel panel={p} title="Crawler status" id="crawler-status">
        {(d) => <CrawlerStatus d={d} scopeName={scopeName} />}
      </Panel>
      <div className="cols2">
        <Panel panel={p} title="Queue by priority" id="crawler-queue" flush sub={<ScopeChip />}>
          {(d) => <QueueTable d={d} />}
        </Panel>
        <Panel panel={p} title="Budget per game version" id="crawler-budget"
          footer={(d) => <span className="row gap-8 wrap-row">Budget: {d.crawler?.budgetScope === 'region' ? 'one per region' : 'one for all regions'} · <Link to="/admin/settings#set-crawler.versionShares">Change ceilings in Settings</Link></span>}>
          {(d) => <BudgetTable d={d} />}
        </Panel>
      </div>
      <div className="cols2">
        <Panel panel={p} title="Last error and back-offs" id="crawler-errors" sub={<ScopeChip />}>
          {(d) => <LastError d={d} />}
        </Panel>
        <Panel panel={cards} title="Share card renderer" id="crawler-cards" sub={<Chip kind="scope" icon="globe">This web process</Chip>}
          footer={<span>On/off: <Link to="/admin/features#feat-share-cards">Features › Share cards</Link> · renders at once: <Link to="/admin/settings#set-cards.maxConcurrent">Settings</Link></span>}>
          {(d) => <Renderer d={d} />}
        </Panel>
      </div>
      <Panel panel={jobs} title="Worker jobs" id="crawler-jobs" flush
        footer="This panel runs on its own clock because jobs move by the second. A job runs again on its own interval; a failed one tries again next time.">
        {(d) => <WorkerJobs d={d} />}
      </Panel>
    </>
  );
}

function CrawlerStatus({ d, scopeName }) {
  const c = d.crawler;
  const tag = !c ? { kind: 'off', text: 'Not started' } : CRAWL_STATE[c.state] ?? { kind: 'info', text: c.state };
  const b = d.budget;
  const hourPct = pct(c?.requestsLastHour ?? 0, b.perHour);
  const startedAt = c?.startedAt ? Date.parse(c.startedAt) : null;
  const sinceStart = startedAt && Date.now() - startedAt < 60 * 60 * 1000;
  const bf = d.backfill;
  return (
    <div className="stack gap-14">
      <div className="row gap-8 wrap-row">
        <Chip kind={tag.kind}>{tag.text}</Chip>
        {c && <span className="t2 small">Status written {timeAgo(c.updatedAt)} · {formatNumber(c.inFlight)} in flight for {scopeName}</span>}
      </div>
      {!c && (
        <Empty icon="hourglass" title="The crawler hasn’t reported yet">
          It writes its status every few seconds from the worker container. If this stays empty, the worker isn’t running.
        </Empty>
      )}
      {!d.switches.version.on && (
        <div className="note warn small" role="status"><Icon name="warning" /><span>{scopeName} is switched off: nothing is queued or crawled for it. <Link to={`/admin/features#feat-${d.switches.version.feature}`}>Features</Link></span></div>
      )}
      <div className="row gap-12 wrap-row">
        <FeatureState label="Background crawl" on={d.switches.crawl.on} feature="crawl" onText="on" offText="paused" />
        <FeatureState label="Seed from guild rosters" on={d.switches.rosterSeed.on} feature="roster-seed" onText="on" offText="off" />
        <FeatureState label="Collections backfill" on={d.switches.backfill.on} feature="collections-backfill" onText="on" offText="off" />
      </div>
      <div className="kpis">
        <div className="kpi">
          <span className="l">{sinceStart ? 'Requests since the worker started' : 'Requests, last 60 min'}</span>
          <span className="v">{c ? formatNumber(c.requestsLastHour) : '—'}</span>
          <span className="d">of {formatNumber(b.perHour)} an hour ({formatNumber(b.perSecond)}/s) · {hourPct}% · all versions{c?.errorsLastHour ? ` · ${formatNumber(c.errorsLastHour)} failed` : ''}</span>
          <Bar value={hourPct} tone={hourPct >= 90 ? 'warn' : ''} label={`${hourPct}% of the hourly budget`} />
        </div>
        <div className="kpi">
          <span className="l">This UTC hour, every request</span>
          <span className="v">{formatNumber(b.thisHour.requests)}</span>
          <span className="d">from {new Date(b.thisHour.hour).toISOString().slice(11, 13)}:00 UTC, sign-in reads included · {formatNumber(b.thisHour.throttled)} throttled (429)</span>
        </div>
        <div className="kpi">
          <span className="l">Checked today · {scopeName}</span>
          <span className="v">{formatNumber(d.today.checked)}</span>
          <span className="d">{formatNumber(d.today.fetched)} fully fetched (UTC day)</span>
        </div>
        <div className="kpi">
          <span className="l">Tracked · {scopeName}</span>
          <span className="v">{formatNumber(d.today.tracked)}</span>
          <span className="d">{formatNumber(d.today.known)} known in all</span>
        </div>
        <div className="kpi">
          <span className="l">Errors, last 24 h</span>
          <span className="v">{formatNumber(b.last24h.errors)}</span>
          <span className="d">{formatNumber(b.last24h.throttled)} throttled · of {formatNumber(b.last24h.requests)} requests ({b.hoursMeasured} hours logged) · all versions</span>
        </div>
      </div>
      {bf ? (
        <p className="small t2" role="status">
          <b className="strong-text">First collections fetch:</b> {bf.on ? 'on' : 'off'} · {formatNumber(bf.withCollections)} of {formatNumber(bf.tracked)} tracked characters have collections · {formatNumber(bf.queuedToday)} of {formatNumber(bf.perDay)} queued today
          {bf.left > 0 && bf.on ? ` · ${formatNumber(bf.left)} to go: about ${formatNumber(bf.requestsLeft)} requests (${bf.perCharacter} each), ${bf.daysLeft} day${bf.daysLeft === 1 ? '' : 's'} at this cap (arithmetic, not a measurement)` : ''}
        </p>
      ) : <p className="small muted">The first collections fetch runs for the primary game version only.</p>}
    </div>
  );
}

function QueueTable({ d }) {
  const max = Math.max(1, ...d.queue.map((q) => q.queued));
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>Priority</th><th className="t2">What</th><th className="r num">Waiting</th><th className="r num lo">Running</th><th className="r lo">Oldest waiting</th><th>Share of the queue</th></tr></thead>
        <tbody>
          {d.queue.map((q) => (
            <tr key={q.priority}>
              <td className="dtl" data-label=""><b>P{q.priority}</b><span className="sub"><span className="dm lo"><span className="l">Running</span> {formatNumber(q.running)}</span><span className="dm lo"><span className="l">Oldest</span> {q.oldest ? ageOf(q.oldest) : '—'}</span></span></td>
              <td className="t2" data-label="What">{PRIORITY_NAMES[q.priority] ?? `Priority ${q.priority}`}</td>
              <td className="r num" data-label="Waiting">{formatNumber(q.queued)}</td>
              <td className="r num lo" data-label="Running">{formatNumber(q.running)}</td>
              <td className="r nw lo" data-label="Oldest waiting">{q.oldest ? ageOf(q.oldest) : '—'}</td>
              <td data-label="Share of the queue"><Bar value={pct(q.queued, max)} label={`${formatNumber(q.queued)} waiting`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetTable({ d }) {
  return (
    <div className="stack gap-10">
      <span className="small t2">Each version’s ceiling on the shared {formatNumber(d.budget.perSecond)} requests a second. Inside a version, lookups go first.</span>
      <div className="dt-wrap">
        <table className="dt">
          <thead><tr><th>Version</th><th>Ceiling</th><th className="r num">Waiting for budget</th><th className="r num">Queued</th><th className="r num lo">Running</th><th className="r num lo">Finished · 1 h</th></tr></thead>
          <tbody>
            {d.versions.map((v) => (
              <tr key={v.id}>
                <td className="dtl" data-label=""><b>{v.name}</b>{!v.enabled && <span className="sub">Off · admin only</span>}<span className="sub"><span className="dm lo"><span className="l">Running</span> {formatNumber(v.running)}</span><span className="dm lo"><span className="l">Finished · 1 h</span> {formatNumber(v.finishedHour)}{v.failedHour ? ` (${formatNumber(v.failedHour)} failed)` : ''}</span></span></td>
                <td data-label="Ceiling">
                  <div className="ratio"><span className="num">{v.share === null ? '—' : `${v.share}%`}</span><Bar value={v.share ?? 0} tone={v.enabled ? '' : 'off'} label={`${v.share ?? 0}% ceiling`} /></div>
                </td>
                <td className="r num" data-label="Waiting for budget">{formatNumber(v.waitingForBudget)}</td>
                <td className="r num" data-label="Queued">{formatNumber(v.queued)}</td>
                <td className="r num lo" data-label="Running">{formatNumber(v.running)}</td>
                <td className="r num lo" data-label="Finished · 1 h">{formatNumber(v.finishedHour)}{v.failedHour ? <span className="sub">{formatNumber(v.failedHour)} failed</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LastError({ d }) {
  const c = d.crawler;
  if (!c) return <Empty icon="hourglass" title="Nothing reported yet">The crawler writes its last error and back-offs with its status.</Empty>;
  return (
    <div className="stack gap-10">
      {c.lastError ? (
        <div className="codebox">{`${c.lastError.status !== null && c.lastError.status !== undefined ? `HTTP ${c.lastError.status}` : 'No answer'} · ${c.lastError.endpoint} · ${formatDateTime(c.lastError.at)}${c.lastError.error ? `\n${c.lastError.error}` : ''}`}</div>
      ) : <span className="small t2">No Blizzard error for this version since the worker started.{c.lastErrorElsewhere ? ' (The latest error was on another version.)' : ''}</span>}
      {c.sourceProblem && <div className="note warn small"><Icon name="warning" /><span>Blizzard source: {c.sourceProblem === 'not_configured' ? 'no Blizzard keys yet (Settings › API keys)' : c.sourceProblem}</span></div>}
      {c.backoffs.length ? (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th>Backing off</th><th className="r num">Failures</th><th>Until</th></tr></thead>
            <tbody>
              {c.backoffs.map((b) => (
                <tr key={b.endpoint} className="is-fail">
                  <td className="dtl mono" data-label="">{b.endpoint}</td>
                  <td className="r num" data-label="Failures">{formatNumber(b.failures)}</td>
                  <td className="nw" data-label="Until">{formatDateTime(b.until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <span className="muted xsmall">No endpoint is backing off. A 429, a 5xx or no answer doubles that endpoint’s wait; 20 successes in a row reset it.</span>}
    </div>
  );
}

function Renderer({ d }) {
  const r = d.renderer;
  return (
    <div className="stack gap-12">
      <div className="row gap-8 wrap-row">
        <Chip kind={d.on ? 'ok' : 'off'}>{d.on ? 'Share cards on' : 'Share cards off'}</Chip>
        <span className="t2 small">{r ? (r.browser ? 'Headless Chromium running' : 'Idle: Chromium starts on the next render') : 'No renderer in this process'}</span>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="l">Rendering now</span><span className="v">{r ? `${r.running} / ${d.maxConcurrent}` : '—'}</span><span className="d">{r ? `${formatNumber(r.waiting)} waiting` : 'not measured'}</span></div>
        <div className="kpi"><span className="l">Render time · p95</span><span className="v">{r?.p95Ms !== null && r?.p95Ms !== undefined ? `${formatNumber(r.p95Ms)} ms` : '—'}</span><span className="d">{r?.measured ? `median ${formatNumber(r.medianMs)} ms · slowest ${formatNumber(r.slowestMs)} ms · last ${r.measured}` : 'No card rendered since this process started'}</span></div>
        <div className="kpi"><span className="l">Cache</span><span className="v">{formatBytes(d.cache.bytes)}</span><span className="d">{formatNumber(d.cache.images)} image{d.cache.images === 1 ? '' : 's'}{d.cache.oldestData ? ` · oldest data ${ageOf(d.cache.oldestData)} old` : ''}</span></div>
      </div>
      <span className="muted xsmall">Saved defaults: {d.defaults.length ? d.defaults.map((x) => `${formatNumber(x.n)} ${x.kind}`).join(' · ') : 'none yet'}. Images are Blizzard data: kept 6 hours at most and never past the retention window.</span>
    </div>
  );
}

const JOB_STATE = {
  running: { kind: 'run', text: 'Running' },
  ok: { kind: 'ok', text: 'OK' },
  failed: { kind: 'err', text: 'Failed' },
  overdue: { kind: 'warn', text: 'Overdue' },
  waiting: { kind: 'off', text: 'Not run yet' },
  unknown: { kind: 'off', text: 'Unknown: worker not responding' },
};

function WorkerJobs({ d }) {
  const w = d.workers[0];
  if (!w) return <Empty icon="hourglass" title="No worker has reported">The worker writes a heartbeat every 30 seconds. If this stays empty, the worker container isn’t running.</Empty>;
  const dead = w.state === 'not_responding';
  return (
    <>
      <div className="row gap-8 wrap-row site-pad">
        <Chip kind={dead ? 'err' : 'ok'}>{dead ? 'Not responding' : w.state === 'running' ? 'Running a job' : 'Alive'}</Chip>
        <span className="t2 small">{w.id} · v{w.version} · started {formatDateTime(w.startedAt)} · last heartbeat {timeAgo(w.lastTickAt)}</span>
      </div>
      <div className="dt-wrap">
        <table className="dt">
          <thead><tr><th>Job</th><th>State</th><th>Last checked</th><th>Last did its work</th><th className="r">Every</th><th>Result</th></tr></thead>
          <tbody>
            {w.jobs.map((j) => {
              const st = JOB_STATE[j.state] ?? JOB_STATE.unknown;
              return (
                <tr key={j.id} className={j.state === 'failed' ? 'is-fail' : ''}>
                  <td className="dtl" data-label=""><b>{j.label}</b><span className="sub mono">{j.id}</span></td>
                  <td data-label="State"><Chip kind={st.kind}>{st.text}</Chip></td>
                  <td className="nw" data-label="Last checked">{j.lastStartedAt ? timeAgo(j.lastStartedAt) : 'not yet'}</td>
                  <td className="nw" data-label="Last did its work">{j.lastWorkAt ? timeAgo(j.lastWorkAt) : '—'}</td>
                  <td className="r nw" data-label="Every">{j.everyMs ? duration(j.everyMs) : '—'}</td>
                  <td className="t2 site-clip" data-label="Result" title={j.summary ?? undefined}>{j.summary ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {d.workers.length > 1 && <span className="muted xsmall site-pad">{d.workers.length - 1} older worker record{d.workers.length > 2 ? 's' : ''} not shown (a restarted worker writes a new one).</span>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Data › Collections & catalogs
// ---------------------------------------------------------------------------------------------------------------
const CATALOG_STATE = {
  ok: { kind: 'ok', text: 'Ready' },
  empty: { kind: 'off', text: 'Empty: Blizzard lists none' },
  queued: { kind: 'run', text: 'Queued' },
  building: { kind: 'run', text: 'Building' },
  stuck: { kind: 'err', text: 'Stuck: no work item left' },
  failed: { kind: 'err', text: 'Failed' },
};

export function CollectionsDataPage() {
  const { apiQuery, versionName, region } = useScope();
  const p = usePanel(`data-collections-${apiQuery}`, () => api(`/api/admin/data/collections?${apiQuery}`), [apiQuery]);
  useHit(p.data);
  const scopeName = `${versionName} · ${region.toUpperCase()}`;
  return (
    <>
      <DataHead />
      <Panel panel={p} title="Collections at a glance" id="collections-kpis">
        {(d) => <CollectionsKpis d={d} />}
      </Panel>
      <Panel panel={p} title="Catalog builds" id="collections-catalogs" flush
        footer={(d) => `Rebuilt every ${d.refreshDays} days by the hourly catalogs job. A stuck or failed build resumes on its own and keeps the rows it has; the tracker shows only collected items until a build has finished.`}>
        {(d) => <CatalogTable d={d} scopeName={scopeName} />}
      </Panel>
      <div className="cols2">
        <Panel panel={p} title="Legacy Points wording" id="collections-legacy" flush
          footer="Counted only when the reward text is exactly “Earn N Legacy Point(s)”. Anything else that mentions Legacy is listed, never counted.">
          {(d) => <LegacyTable d={d} />}
        </Panel>
        <Panel panel={p} title="Account-wide detection" id="collections-sharing" sub={<Chip kind="scope" icon="globe">All versions</Chip>}>
          {(d) => <Sharing d={d} />}
        </Panel>
      </div>
    </>
  );
}

function CollectionsKpis({ d }) {
  const f = d.refreshes;
  const daily = f.requestsEach ? Math.round((d.tracked.n * f.requestsEach) / 7) : null;
  const real = d.catalogs.filter((c) => c.kind !== 'namespace');
  const ready = real.filter((c) => c.rawState === 'ok' || c.rawState === 'empty').length;
  const building = real.filter((c) => c.state === 'building' || c.state === 'queued').length;
  const bad = real.filter((c) => c.problem).length;
  const bf = d.backfill;
  const bfPct = bf ? pct(bf.withCollections, bf.tracked) : 0;
  return (
    <div className="stack gap-12">
      <div className="kpis">
        <div className="kpi"><span className="l">Refresh cost, measured</span><span className="v">{f.requestsEach ?? '—'}</span><span className="d">{f.lastHour ? `requests per character · ${formatNumber(f.kbEach)} KB · average of ${formatNumber(f.lastHour)} refreshes in the last hour` : 'no refresh finished in the last hour: nothing to measure'}</span></div>
        <div className="kpi"><span className="l">Tracked, level 10+</span><span className="v">{formatNumber(d.tracked.n)}</span><span className="d">{formatNumber(d.tracked.with_collections)} have collections · {formatNumber(d.tracked.hunters)} hunters</span></div>
        {bf ? (
          <div className="kpi"><span className="l">Backfill</span><span className="v">{bfPct}%</span><span className="d">{bf.on ? 'On' : 'Off'} · {formatNumber(bf.perDay)} a day · {bf.left > 0 && bf.on ? `~${bf.daysLeft} day${bf.daysLeft === 1 ? '' : 's'} left` : bf.left > 0 ? `${formatNumber(bf.left)} to go` : 'done'}</span><Bar value={bfPct} label={`${bfPct}% backfilled`} /></div>
        ) : <div className="kpi"><span className="l">Backfill</span><span className="v">—</span><span className="d">Primary game version only</span></div>}
        <div className="kpi"><span className="l">Catalogs ready</span><span className="v">{real.length ? `${ready} of ${real.length}` : '—'}</span><span className="d">{real.length ? `${building} building · ${bad} stuck or failed` : 'none started yet'}</span></div>
      </div>
      {daily !== null && <span className="muted xsmall">Weekly refreshes add about {formatNumber(daily)} requests a day at today’s count (tracked × measured requests ÷ 7), plus sign-ins and tab opens. Arithmetic, not a measurement.</span>}
    </div>
  );
}

function CatalogTable({ d, scopeName }) {
  const ns = d.catalogs.find((c) => c.kind === 'namespace');
  const rows = d.catalogs.filter((c) => c.kind !== 'namespace');
  return (
    <>
      <div className="row gap-8 wrap-row site-pad small t2">
        <span>Static namespace:</span>
        {ns ? <span className="mono2">{ns.detail ?? '—'}</span> : <span className="muted">not named yet: catalogs start once a character response names it</span>}
      </div>
      {rows.length === 0 ? (
        <Empty icon="hourglass" title={`No catalog built for ${scopeName} yet`}>Catalogs are asked for only after a character fetch has named the static namespace.</Empty>
      ) : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th>Catalog</th><th>State</th><th className="r num">Entries</th><th className="r num">Requests</th><th className="r num">Bytes</th><th>Finished</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const st = CATALOG_STATE[c.state] ?? { kind: 'info', text: c.state };
                return (
                  <tr key={c.kind} className={c.problem ? 'is-fail' : ''}>
                    <td className="dtl" data-label=""><b>{c.label}</b>{c.refreshDue && <span className="sub">Refresh due</span>}</td>
                    <td data-label="State"><Chip kind={st.kind}>{st.text}{c.state === 'building' && c.startedAt ? ` · ${ageOf(c.startedAt)}` : ''}</Chip></td>
                    <td className="r num" data-label="Entries">{c.total !== null && c.total !== undefined && c.entries !== c.total ? `${formatNumber(c.entries)} of ${formatNumber(c.total)}` : formatNumber(c.entries)}</td>
                    <td className="r num" data-label="Requests">{formatNumber(c.requests)}</td>
                    <td className="r num" data-label="Bytes">{formatBytes(c.bytes)}</td>
                    <td className="nw" data-label="Finished">{c.finishedAt ? formatDateTime(c.finishedAt) : '—'}</td>
                    <td className="t2 site-clip" data-label="Detail" title={c.detail ?? undefined}>{c.detail ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LegacyTable({ d }) {
  const l = d.legacy;
  const rows = [...l.counted.map((x) => ({ ...x, counted: true })), ...l.uncounted.map((x) => ({ ...x, counted: false }))];
  return (
    <>
      <span className="small t2 site-pad">{formatNumber(l.achievements)} achievements in the catalog · {formatNumber(l.otherRewards)} other reward texts</span>
      {rows.length === 0 ? <Empty icon="info" title="No reward text mentions Legacy yet">Or the achievement catalog isn’t built for this version.</Empty> : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th>Reward text</th><th>Counted</th><th className="r num">Achievements</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={`${x.counted}-${x.text}`} className={x.counted ? '' : 'is-fail'}>
                  <td className="dtl" data-label=""><span className="mono2">“{x.text}”</span></td>
                  <td data-label="Counted"><Chip kind={x.counted ? 'ok' : 'warn'}>{x.counted ? 'Counted' : 'Not counted'}</Chip></td>
                  <td className="r num" data-label="Achievements">{formatNumber(x.achievements)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Sharing({ d }) {
  const kinds = Object.entries(d.sharing);
  if (!kinds.length) return <Empty icon="info" title="Nothing to compare yet">No signed-in account has two fetched characters.</Empty>;
  return (
    <div className="stack gap-10">
      <dl className="kvs">
        {kinds.map(([k, v]) => (
          <div key={k} className="site-kv"><dt>{k}</dt><dd>Identical on {formatNumber(v.shared)} of {formatNumber(v.accounts)} accounts ({pct(v.shared, v.accounts)}%)</dd></div>
        ))}
      </dl>
      <span className="muted xsmall">Compared on accounts with two or more fetched characters. “Shared across this account” shows only where every character has the identical list, or Blizzard says is_account_wide.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Data › Backups (global)
// ---------------------------------------------------------------------------------------------------------------
export function BackupsPage() {
  const [cursors, setCursors] = useState([null]);
  const cursor = cursors.at(-1);
  const status = usePanel('data-backups-status', () => api('/api/admin/data/backups?limit=1'), []);
  const hist = usePanel('data-backups-history', () => api(`/api/admin/data/backups?limit=20${cursor ? `&before=${cursor}` : ''}`), [cursor]);
  useHit(status.data);
  return (
    <>
      <DataHead global />
      <Panel panel={status} title="Last good backup" id="backups-status">
        {(d) => <BackupStatus d={d} />}
      </Panel>
      <div className="cols2">
        <Panel panel={status} title="What is kept" id="backups-rule">
          {(d) => (
            <p className="t2 small">
              Backups hold only Everstats’ own data (accounts, settings, decisions, history), never Blizzard data, so they don’t follow the 30-day rule.
              Kept: the newest <b>{d.rule.nightly}</b> backups{d.rule.monthly ? <> plus the <b>first of each month</b>, indefinitely</> : ' and no monthly copies (this site’s rule)'}.
              A backup from before 0.5.0 still holds Blizzard data and is deleted {d.rule.legacyKeepDays} days after it was taken. A second backup on the same day replaces the first.
            </p>
          )}
        </Panel>
        <Panel panel={status} title="Back up by hand" id="backups-hand">
          {(d) => (
            <div className="stack gap-8">
              <div className="codebox">{d.commands.join('\n')}</div>
              <span className="muted xsmall">Run on the server: “now” takes a verified backup in the worker container, “list” shows the files, “verify” reads one back. Restoring: RESTORE.md. A backup can’t be started or downloaded from this page: only the worker holds the backup folder.</span>
            </div>
          )}
        </Panel>
      </div>
      <Panel panel={hist} title="History" id="backups-history" flush
        footer={(d) => (
          <div className="pager site-pager">
            <span>“Kept because” is worked out from the backup log with the keep rule; this page can’t see the backup folder itself.</span>
            <span className="spacer" />
            <button type="button" className="btn sm ghost" disabled={cursors.length < 2} onClick={() => setCursors((c) => c.slice(0, -1))}>Newer</button>
            <button type="button" className="btn sm ghost" disabled={!d.next} onClick={() => setCursors((c) => [...c, d.next])}>Older</button>
          </div>
        )}>
        {(d) => <BackupHistory d={d} />}
      </Panel>
    </>
  );
}

function BackupStatus({ d }) {
  const b = d.status;
  const chip = b.running ? { kind: 'run', text: 'Running now' }
    : b.failing ? { kind: 'err', text: 'Last attempt failed' }
      : b.lastSuccessAt ? { kind: Date.now() - Date.parse(b.lastSuccessAt) > 30 * 60 * 60 * 1000 ? 'warn' : 'ok', text: `Last good backup · ${timeAgo(b.lastSuccessAt)}` }
        : { kind: 'warn', text: 'No backup yet' };
  return (
    <div className="stack gap-12">
      <div className="bigstatus">
        <Chip kind={chip.kind}>{chip.text}</Chip>
        {b.lastSuccessAt && <span className="t2">{b.lastSuccessBytes !== null ? formatBytes(Number(b.lastSuccessBytes)) : '—'} · <span className="mono2">{b.lastSuccessFile ?? '—'}</span> · verified by reading it back</span>}
      </div>
      {b.failing && b.lastFailure && <div className="note err small" role="alert"><Icon name="error" /><span>Failed {formatDateTime(b.lastFailureAt)}: {b.lastFailure} Earlier backups are untouched; the worker tries again after an hour.</span></div>}
      {!b.lastSuccessAt && !b.failing && <span className="small t2">The worker takes one straight away when there are none, then one after 04:00 UTC each night. If BACKUP_DIR isn’t set, the backup job on Data › Crawler › Worker jobs says so.</span>}
    </div>
  );
}

const RUN_RESULT = {
  ok: { kind: 'ok', text: 'Verified' },
  failed: { kind: 'err', text: 'Failed' },
  running: { kind: 'run', text: 'Running' },
  abandoned: { kind: 'warn', text: 'Abandoned' },
};

function BackupHistory({ d }) {
  if (!d.history.length) return <Empty icon="hourglass" title="No backup has run yet">The worker records every attempt here.</Empty>;
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>When</th><th>Kind</th><th>File</th><th className="r">Size</th><th>Result</th><th className="t2">Kept because</th></tr></thead>
        <tbody>
          {d.history.map((x) => {
            const r = RUN_RESULT[x.outcome] ?? { kind: 'info', text: x.outcome };
            return (
              <tr key={x.id} className={x.outcome === 'failed' || x.outcome === 'abandoned' ? 'is-fail' : ''}>
                <td className="dtl nw" data-label="">{formatDateTime(x.startedAt)}</td>
                <td data-label="Kind">{x.trigger === 'manual' ? 'By hand' : 'Nightly'}</td>
                <td data-label="File"><span className="mono2">{x.file ?? '—'}</span></td>
                <td className="r nw" data-label="Size">{x.bytes !== null ? formatBytes(x.bytes) : '—'}</td>
                <td data-label="Result"><Chip kind={r.kind}>{r.text}</Chip>{x.outcome === 'failed' && x.detail ? <span className="sub site-clip" title={x.detail}>{x.detail}</span> : null}</td>
                <td className="t2" data-label="Kept because">{x.kept ? x.kept.text : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
