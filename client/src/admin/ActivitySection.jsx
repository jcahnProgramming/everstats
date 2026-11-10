import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Modal, Segmented } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber } from '../format.js';

/**
 * Admin → Activity (0.7.1): "what changed since I last checked". The top of /admin.
 *
 *   Numbers from the database (accounts, characters by how they arrived, guilds, factions, rulesets) include history;
 *   search counts exist only from 0.7.1's deploy, and a range that starts earlier says so (never 0). "Mark as checked"
 *   moves the marker only when pressed: a reload never wipes the deltas.
 *
 * The chart: three small single-series bar charts (small multiples, one axis each) in the v1 chart container, because
 * accounts, searches and new characters live on very different scales. Each bar names its value on hover and focus,
 * and the numbers are also in a table.
 */
const RANGES = [
  { id: 'checked', label: 'Since I last checked' },
  { id: '24h', label: 'Last 24 h' },
  { id: '7d', label: '7 days' },
  { id: 'launch', label: 'Since launch' },
];
const delta = (n) => (n === null || n === undefined ? null : n > 0 ? `+${formatNumber(n)}` : '±0');
const pct = (n, of) => (of ? `${Math.round((n / of) * 1000) / 10}%` : '—');

export function ActivitySection() {
  const toast = useToasts();
  const [range, setRange] = useState('checked');
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/activity?range=${range}`));
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);
  const mark = async () => {
    try {
      setRange('checked');
      setData(await api('/api/admin/activity/checked', { method: 'POST', body: { confirm: true } }));
      toast.ok('Marked as checked', 'Changes now count from this moment.');
    } catch (err) {
      toast.err('Couldn’t move the marker', err.message);
    }
    setConfirm(false);
  };
  if (problem) return <section className="panel pad-20"><div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div></section>;
  if (!data) return <section className="panel pad-20" aria-busy="true"><h2 className="h2 h2-panel">Activity</h2></section>;

  const sinceWords = data.since === null
    ? (range === 'checked' ? 'not checked yet' : 'since launch')
    : `since ${formatDateTime(data.since)}`;
  const k = data.searches.kinds;
  const charSearches = ['character.search', 'character.lookup', 'character.signin'];
  const guildSearches = ['guild.search', 'search.page'];
  const sum = (ids, f) => ids.reduce((n, id) => n + k[id][f], 0);
  const newChars = data.characters.bySource.reduce((n, s) => n + (s.new ?? 0), 0);
  const allChars = data.characters.bySource.reduce((n, s) => n + s.total, 0);
  const countedFrom = data.countingSince ? formatDateTime(data.countingSince) : 'this release';
  const searchNote = data.searches.partial ? `Counted from ${countedFrom}; before that unknown.` : null;

  return (
    <section className="panel pad-20 stack gap-18 activity" aria-labelledby="activity-h">
      <div className="row gap-10 wrap-row">
        <h2 className="h2 h2-panel" id="activity-h">Activity</h2>
        <span className="muted small">{data.checkedAt ? `Last checked ${formatDateTime(data.checkedAt)}` : 'Not checked yet'}</span>
        <span className="spacer" />
        <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
        <button type="button" className="btn sm gold" onClick={() => setConfirm(true)}><Icon name="check" size="sm" />Mark as checked</button>
      </div>

      <div className="grid-auto col-xs gap-10">
        {/* 0.9.2: every card says what its big number is (a total) and what the change beside it counts. */}
        <Kpi label="Player accounts, total" value={data.accounts.total} change={delta(data.accounts.new)} changeWords="new" since={sinceWords} />
        <Kpi label="Character searches, all counted" changeWords="more" value={sum(charSearches, 'total')} change={data.since === null ? null : delta(sum(charSearches, 'since'))} since={sinceWords} note={searchNote ?? 'Search box, pages that asked Blizzard, and sign-ins'} />
        <Kpi label="Characters known, total" value={allChars} change={delta(data.since === null ? null : newChars)} changeWords="new" since={sinceWords} note="Characters Blizzard hasn’t returned for 30 days have left" />
        <Kpi label="Guild searches, all counted" changeWords="more" value={sum(guildSearches, 'total')} change={data.since === null ? null : delta(sum(guildSearches, 'since'))} since={sinceWords} note={searchNote ?? 'Guild search and the search page'} />
        <Kpi label="Guild page views, all counted" changeWords="more" value={k['guild.view'].total} change={data.since === null ? null : delta(k['guild.view'].since)} since={sinceWords} note={searchNote} />
        <Kpi label="Guilds known, total" value={data.guilds.total} change={delta(data.guilds.new)} changeWords="new" since={sinceWords} />
      </div>

      <div className="split-even gap-18">
        <div className="stack gap-8">
          <h3 className="h3">Searches by kind</h3>
          <div className="tblbox">
            <table className="tbl compact">
              <thead><tr><th scope="col">What</th><th scope="col" className="r">Total</th><th scope="col" className="r">{range === 'checked' ? 'Since checked' : 'In range'}</th></tr></thead>
              <tbody>
                {Object.entries(k).map(([id, v]) => (
                  <tr key={id}><td className="small"><span title={v.help}>{v.label}</span></td><td className="r">{formatNumber(v.total)}</td><td className="r">{data.since === null ? '—' : formatNumber(v.since)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {searchNote && <span className="muted xsmall">{searchNote}</span>}
        </div>
        <div className="stack gap-8">
          <h3 className="h3">New characters, by how they arrived</h3>
          <div className="tblbox">
            <table className="tbl compact">
              <thead><tr><th scope="col">Arrived from</th><th scope="col" className="r">Known now</th><th scope="col" className="r">{range === 'checked' ? 'Since checked' : 'In range'}</th></tr></thead>
              <tbody>
                {data.characters.bySource.map((s) => (
                  <tr key={s.id}><td className="small">{s.label}</td><td className="r">{formatNumber(s.total)}</td><td className="r">{s.new === null ? '—' : formatNumber(s.new)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="split-even gap-18">
        <div className="stack gap-8">
          <h3 className="h3">Faction</h3>
          <span className="muted xsmall">Tracked characters (fetched, shown, not missing): {formatNumber(data.factions.tracked)}</span>
          <div className="tblbox">
            <table className="tbl compact">
              <thead><tr><th scope="col">Ruleset</th>{data.factions.names.map((f) => <th key={f} scope="col" className="r">{f}</th>)}</tr></thead>
              <tbody>
                <tr><td className="small strong-text">All rulesets</td>{data.factions.names.map((f) => <td key={f} className="r">{formatNumber(data.factions.overall[f])} <span className="muted xsmall">{pct(data.factions.overall[f], data.factions.tracked)}</span></td>)}</tr>
                {data.rulesets.map((r) => (
                  <tr key={r.id}><td className="small">{r.name}</td>{data.factions.names.map((f) => <td key={f} className="r">{formatNumber(r.factions[f])} <span className="muted xsmall">{pct(r.factions[f], r.tracked)}</span></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack gap-8">
          <h3 className="h3">Rulesets</h3>
          <span className="muted xsmall">Tier-eligible characters against the tier minimum ({formatNumber(data.minPopulation)}).</span>
          {data.rulesets.length === 0 ? <span className="muted small">No tracked characters yet.</span> : data.rulesets.map((r) => (
            <div key={r.id} className="stack gap-4">
              <div className="row gap-8"><b className="small flex-fill">{r.name}</b><span className="small">{formatNumber(r.tracked)} tracked</span><span className="muted xsmall">{formatNumber(r.eligible)} / {formatNumber(data.minPopulation)} tier-eligible</span></div>
              <div className={`bar${r.eligible >= data.minPopulation ? '' : ' warn'}`}><span className="bar-fill" style={{ width: `${Math.min(100, (r.eligible / data.minPopulation) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <DailyCharts days={data.days} countedFrom={countedFrom} />

      <span className="muted xsmall">Counts only: no IP addresses, user agents or visitor ids are stored, and there’s no third-party analytics. Networks the look-up limiter is already refusing aren’t counted, but counts may still include some bots. Searches are counted by the hour, so a range can include up to an hour before it starts.</span>

      {confirm && (
        <Modal title="Mark as checked?" onClose={() => setConfirm(false)} actions={<><button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="btn gold" onClick={mark}>Mark as checked</button></>}>
          <p className="t2">Changes will count from now. The ones you see now (“since {data.checkedAt ? formatDateTime(data.checkedAt) : 'never'}”) won’t be shown again.</p>
        </Modal>
      )}
    </section>
  );
}

function Kpi({ label, value, change, since, note = null, changeWords = '' }) {
  return (
    <div className="raised pad-12 stack gap-2">
      <span className="eyebrow">{label}</span>
      <span className="row gap-8 baseline"><b className="big-num">{formatNumber(value)}</b>{change && <span className="kpi-delta">{change}{changeWords ? ` ${changeWords}` : ''}</span>}</span>
      <span className="muted xsmall">{change ? since : ''}{note ? `${change ? ' · ' : ''}${note}` : ''}</span>
    </div>
  );
}

/** Three small-multiple bar charts (one axis each) over the last 14 UTC days, plus their numbers as a table. */
function DailyCharts({ days, countedFrom }) {
  const [table, setTable] = useState(false);
  const series = [
    { id: 'accounts', label: 'New accounts' },
    { id: 'searches', label: 'Searches', note: `Unknown before ${countedFrom}` },
    { id: 'characters', label: 'New characters' },
  ];
  const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <div className="panel chart activity-chart">
      <div className="row gap-10 wrap-row">
        <h3 className="h3 flex-fill">Per day, last 14 days (UTC)</h3>
        <button type="button" className="btn ghost sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? 'Show charts' : 'Show as a table'}</button>
      </div>
      {table ? (
        <div className="tblbox">
          <table className="tbl compact">
            <thead><tr><th scope="col">Day</th>{series.map((s) => <th key={s.id} scope="col" className="r">{s.label}</th>)}</tr></thead>
            <tbody>{days.map((d) => <tr key={d.day}><td>{short(d.day)}</td>{series.map((s) => <td key={s.id} className="r">{d[s.id] === null ? 'unknown' : formatNumber(d[s.id])}{d.partialDay && s.id === 'searches' ? ' (part of the day)' : ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="mini-charts">
          {series.map((s) => {
            const max = Math.max(1, ...days.map((d) => d[s.id] ?? 0));
            return (
              <figure key={s.id} className="mini-chart">
                <figcaption className="row gap-8"><b className="small flex-fill">{s.label}</b><span className="muted xsmall">max {formatNumber(max)}</span></figcaption>
                <div className="mini-bars" role="list" aria-label={`${s.label} per day`}>
                  {days.map((d) => {
                    const v = d[s.id];
                    const words = `${short(d.day)}: ${v === null ? 'unknown (not counted yet)' : formatNumber(v)}`;
                    return (
                      <span key={d.day} className={`mini-bar${v === null ? ' unknown' : ''}`} role="listitem" tabIndex={0} aria-label={words}>
                        <span className="mini-fill" style={{ height: v === null ? '0%' : `${Math.max(v > 0 ? 4 : 0, (v / max) * 100)}%` }} />
                        <span className="tip">{words}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="xaxis"><span>{short(days[0].day)}</span><span>{short(days.at(-1).day)}</span></div>
                {s.note && days.some((d) => d[s.id] === null) && <span className="muted xsmall">{s.note} (hatched days).</span>}
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
