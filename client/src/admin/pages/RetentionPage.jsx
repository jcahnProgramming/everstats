import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { Chip, Empty, PageHead, ScopeChip, useHit } from '../shell/parts.jsx';
import { useScope } from '../shell/scope.jsx';
import { ageOf, duration } from './DataPages.jsx';
import './site.css';

/**
 * Admin › Data retention (0.10.3, design/v5-admin pages/retention, states retention-empty and retention-error). Moved
 * here from the old RetentionSection: the rule, the status, the last sweep, the oldest data per kind. The max age is
 * edited on Settings (read only here).
 *
 *   Status       ALL versions (Blizzard's rule is about everything we hold): WITHIN while nothing is older than
 *                Blizzard's maximum, OUTSIDE (with how far over) the moment anything is.
 *   Blizzard data   per kind of data in the registry, for the version + region in the switcher where the table can be
 *                scoped (characters and guilds carry their version and region; their child tables join to them);
 *                tables that can't be are labelled "All versions" / "All regions". Expiry = fetched + keep days.
 *   Sweep history   every sweep (retention_sweeps), paged, problems highlighted.
 *   Our own data    the registry's OURS list with its reason.
 *
 * Different from the mockup, on purpose: no "Run sweep now" (sweeps run hourly in both processes, and a failure is
 * retried at the next hour; there is no endpoint that starts one), and no invented "retried at" times: the history
 * shows what each sweep recorded. Kinds are the registry's tables (one row each, characters and guilds split by the
 * clocks they age on), not the mockup's grouping.
 */
export function RetentionPage() {
  const { apiQuery, versionName, region, enabled } = useScope();
  const scopeName = `${versionName} · ${region.toUpperCase()}`;
  const p = usePanel(`retention-${apiQuery}`, () => api(`/api/admin/data/retention?${apiQuery}`), [apiQuery]);
  const [cursors, setCursors] = useState([null]);
  const cursor = cursors.at(-1);
  const sweeps = usePanel('retention-sweeps', () => api(`/api/admin/data/retention/sweeps?limit=15${cursor ? `&before=${cursor}` : ''}`), [cursor]);
  useHit(p.data);
  const s = p.data?.status;
  return (
    <>
      <PageHead title="Data retention" chips={<ScopeChip />}
        desc="Blizzard’s 30-day rule: what we hold, when each piece expires, and what every sweep deleted." />
      {s && s.state === 'outside' && (
        <div className="note err" role="alert">
          <Icon name="error" />
          <span><b>Outside the window.</b> The oldest Blizzard data ({s.oldestKind ?? 'unknown kind'}) is {ageOf(s.oldestAt)} old, {duration(s.overByMs)} past Blizzard’s maximum.
            {s.failedInARow ? ` The last ${s.failedInARow} sweep${s.failedInARow === 1 ? '' : 's'} had problems.` : ''} Sweeps run every hour in the web app and the worker.</span>
        </div>
      )}
      <Panel panel={p} title="Status" id="retention-status" sub={<Chip kind="scope" icon="globe">All versions</Chip>}>
        {(d) => <Status d={d} />}
      </Panel>
      <Panel panel={p} title={`Blizzard data · ${scopeName}`} id="retention-kinds" flush ghostRows={6}
        sub={p.data?.countedAt ? <span className="muted xsmall">Counted {timeAgo(p.data.countedAt)} (kept a minute)</span> : null}
        footer={(
          <div className="legend2 site-legend">
            <span><i className="e1" />Next hour</span><span><i className="e2" />Next 24 h</span><span><i className="e3" />Next 7 days</span><span><i className="e4" />Rest of the window</span>
            <span><i className="e0" />Due for the next sweep</span>
          </div>
        )}>
        {(d) => <Kinds d={d} enabled={enabled} scopeName={scopeName} />}
      </Panel>
      <Panel panel={sweeps} title="Sweep history" id="retention-sweeps" flush sub={<Chip kind="scope" icon="globe">All versions</Chip>}
        footer={(d) => (
          <div className="pager site-pager">
            <span>A table that fails is recorded and the others still run; the next hourly sweep tries again.</span>
            <span className="spacer" />
            <button type="button" className="btn sm ghost" disabled={cursors.length < 2} onClick={() => setCursors((c) => c.slice(0, -1))}>Newer</button>
            <button type="button" className="btn sm ghost" disabled={!d.next} onClick={() => setCursors((c) => [...c, d.next])}>Older</button>
          </div>
        )}>
        {(d) => <Sweeps d={d} />}
      </Panel>
      <Panel panel={p} title="Data that isn’t Blizzard’s" id="retention-ours" flush
        footer="Everstats’ own data is kept; any deletion of it is named in CLAUDE.md with its reason. Backups hold only this data.">
        {(d) => (
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th>Our own table</th><th className="t2">What it holds and why it isn’t Blizzard data</th></tr></thead>
              <tbody>
                {d.ours.map((o) => (
                  <tr key={o.table}><td className="dtl mono" data-label="">{o.table}</td><td className="t2" data-label="Why">{o.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Status({ d }) {
  const s = d.status;
  const r = d.rule;
  const last = s.lastSweep;
  return (
    <div className="stack gap-14">
      <p className="rule-s">
        Blizzard lets us keep its data for <b>{r.windowDays} days</b> at most, so Everstats deletes anything older than <b>{r.keepDays} days</b>, sweeping every hour.
      </p>
      <div className="bigstatus">
        {s.state === 'outside'
          ? <Chip kind="err">Outside the window · {duration(s.overByMs)} over</Chip>
          : <Chip kind="ok">Within the window</Chip>}
        <dl className="kvs">
          <dt>Oldest item</dt>
          <dd>{s.oldestAt ? `${ageOf(s.oldestAt)} · ${s.oldestKind}` : 'No Blizzard data stored'}</dd>
          <dt>Last sweep</dt>
          <dd>{last ? <>{timeAgo(last.finishedAt ?? last.startedAt)} · {last.process} · {last.state === 'problems' ? <Chip kind="err">Problems</Chip> : last.state === 'ok' ? 'OK' : last.state === 'running' ? 'running' : 'didn’t finish'}{last.durationMs !== null ? ` · ${duration(last.durationMs)}` : ''}</> : 'not yet'}</dd>
          <dt>Due for the next sweep</dt>
          <dd>{formatNumber(s.dueForSweep)} row{s.dueForSweep === 1 ? '' : 's'} past {r.keepDays} days in this version{s.dueForSweep ? ' (normal between hourly sweeps)' : ''}</dd>
          <dt>Max age</dt>
          <dd>{r.windowDays} days (deletes at {r.keepDays}) · read only here · <Link to="/admin/settings#set-retention.window">Change in Settings</Link></dd>
          {r.permission && <><dt>Permission on record</dt><dd className="small">{r.permission}</dd></>}
        </dl>
      </div>
      {last?.problem && <div className="note err small" role="alert"><Icon name="error" /><span>Last sweep problems: {last.problem}</span></div>}
    </div>
  );
}

const nOrDash = (n) => (n === null || n === undefined ? '—' : formatNumber(n));

function Kinds({ d, enabled, scopeName }) {
  const scopedRows = d.kinds.filter((k) => k.width === 'scoped').reduce((n, k) => n + (k.rows ?? 0), 0);
  if (!enabled && scopedRows === 0) {
    return (
      <Empty icon="no-coverage" title={`No Blizzard data stored for ${scopeName}`}
        action={<Link className="btn sm" to="/admin/features">Open Features</Link>}>
        This version and region are off, so nothing has been fetched. When it’s turned on, its data appears here with the same {d.rule.keepDays}-day rule.
      </Empty>
    );
  }
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead>
          <tr><th>Kind of data</th><th className="r num">Rows</th><th>Oldest</th><th className="r num">Next hour</th><th className="r num">Next 24 h</th><th className="r num">Next 7 days</th><th className="r num">Rest of window</th><th>Expires when</th></tr>
        </thead>
        <tbody>
          {d.kinds.map((k) => (
            <tr key={k.id} className={k.problem || (k.oldest && Date.now() - Date.parse(k.oldest) > d.rule.windowDays * 86_400_000) ? 'is-fail' : ''}>
              <td className="dtl" data-label="">
                <b>{k.label}</b>
                <span className="sub"><span className="mono">{k.table}</span>{k.width === 'all' ? ' · All versions' : k.width === 'version' ? ' · All regions' : ''}{k.note ? ` · ${k.note}` : ''}</span>
                {k.problem && <span className="sub site-err">{k.problem}</span>}
              </td>
              <td className="r num" data-label="Rows">{nOrDash(k.rows)}</td>
              <td className="nw" data-label="Oldest">{k.timed ? (k.oldest ? ageOf(k.oldest) : '—') : 'follows its runs'}</td>
              <td className="r num" data-label="Next hour">{k.timed ? nOrDash(k.nextHour) : '—'}</td>
              <td className="r num" data-label="Next 24 h">{k.timed ? nOrDash(k.next24h) : '—'}</td>
              <td className="r num" data-label="Next 7 days">{k.timed ? nOrDash(k.next7d) : '—'}</td>
              <td className="r num" data-label="Rest of window">{k.timed ? nOrDash(k.rest) : '—'}{k.untimed ? <span className="sub">{formatNumber(k.untimed)} go with another row</span> : null}</td>
              <td data-label="Expires when">{k.timed && k.rows ? <Timeline k={k} /> : <span className="muted xsmall">{k.rows === 0 ? 'nothing stored' : '—'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The small per-kind expiry bar (data-table.md .expires): due, next hour, next 24 h, next 7 days, the rest. */
function Timeline({ k }) {
  const parts = [['e0', k.overdue], ['e1', k.nextHour], ['e2', k.next24h], ['e3', k.next7d], ['e4', k.rest]];
  const total = parts.reduce((n, [, v]) => n + (v ?? 0), 0);
  if (!total) return <span className="muted xsmall">—</span>;
  const label = `${formatNumber(k.overdue ?? 0)} due now, ${formatNumber(k.nextHour ?? 0)} next hour, ${formatNumber(k.next24h ?? 0)} next 24 h, ${formatNumber(k.next7d ?? 0)} next 7 days, ${formatNumber(k.rest ?? 0)} later`;
  return (
    <div className="expires" role="img" aria-label={label} title={label}>
      {parts.filter(([, v]) => v > 0).map(([cls, v]) => <span key={cls} className={cls} style={{ width: `${Math.max(1, (v / total) * 100)}%` }} />)}
    </div>
  );
}

const SWEEP_STATE = {
  ok: { kind: 'ok', text: 'OK' },
  problems: { kind: 'err', text: 'Problems' },
  running: { kind: 'run', text: 'Running' },
  unfinished: { kind: 'warn', text: 'Didn’t finish' },
};

function Sweeps({ d }) {
  if (!d.sweeps.length) return <Empty icon="hourglass" title="No sweep has run yet">The first runs within an hour of the web app or worker starting.</Empty>;
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>Sweep</th><th>Run by</th><th>Deleted or stripped</th><th className="r">Duration</th><th>Result</th></tr></thead>
        <tbody>
          {d.sweeps.map((s) => {
            const st = SWEEP_STATE[s.state] ?? SWEEP_STATE.ok;
            return (
              <tr key={s.id} className={s.state === 'problems' || s.state === 'unfinished' ? 'is-fail' : ''}>
                <td className="dtl nw" data-label="">{formatDateTime(s.startedAt)}</td>
                <td data-label="Run by"><span className="mono2">{s.process}</span></td>
                <td className="t2" data-label="Deleted or stripped">
                  {s.deleted.length ? s.deleted.slice(0, 5).map((x) => `${x.table} ${formatNumber(x.n)}`).join(' · ') : 'nothing past the window'}
                  {s.deleted.length > 5 ? ` · +${s.deleted.length - 5} more` : ''}
                  {s.problem && <span className="sub site-err">{s.problem}</span>}
                </td>
                <td className="r nw" data-label="Duration">{s.durationMs !== null ? duration(s.durationMs) : '—'}</td>
                <td data-label="Result"><Chip kind={st.kind}>{st.text}</Chip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
