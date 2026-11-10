import { useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber } from '../format.js';

/**
 * Data retention (0.4.2): Blizzard's Developer API Terms of Use, section 2, require a maximum 30-day lifespan for all
 * data from the API. One setting, the window; above 30 days only with a note describing Blizzard's written permission
 * (logged in admin_events). Shows the last sweep (rows deleted per table) and the oldest Blizzard data still stored.
 */
const DAY = 24 * 60 * 60 * 1000;

export function RetentionSection({ retention: r, setting, onSaved }) {
  const toast = useToasts();
  const [days, setDays] = useState(String(r.windowDays));
  const [note, setNote] = useState(r.permission ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const ageDays = r.oldestAt ? (Date.now() - Date.parse(r.oldestAt)) / DAY : null;
  const over = ageDays !== null && ageDays >= r.windowDays;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api('/api/admin/settings/retention.window', { method: 'PUT', body: { value: { days: Number(days), note } } });
      toast.ok('Retention window saved', `${days} days.`);
      onSaved();
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  const deleted = r.lastSweep?.deleted ?? {};
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="retention-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="retention-h">Data retention</h2>
        <span className={`tag ${over ? 'err' : 'ok'}`}>{over ? 'Over the window' : 'Within the window'}</span>
      </div>
      <p className="t2 small">
        Blizzard’s API terms: “a maximum 30-day TTL (time-to-live) policy for all Data”. The limit below is that maximum, <b className="strong-text">{r.windowDays} days</b>.
        Everstats deletes Blizzard data once it is <b className="strong-text">{r.keepDays} days</b> old ({r.safetyDays} day sooner than the limit), and checks every hour, so the oldest
        it can ever hold is {r.keepDays} days and 1 hour. Share-card images go after 6 hours at most, finished crawl work orders after 1 hour. Backups hold none of it (0.5.0): only Everstats’ own data, kept {r.backups?.nightly ?? 14} nightly plus the first of each month.
        Backups from before 0.5.0 did hold Blizzard data and are still deleted {r.backups?.legacyKeepDays ?? 3} days after they were taken. The sweep runs hourly in both the web app and the worker.
      </p>
      <div className="kv"><span className="t2">Oldest Blizzard data stored</span><span className={over ? 'down' : ''}>{r.oldestAt ? `${ageDays.toFixed(1)} days (${formatDateTime(r.oldestAt)})` : 'none stored'}</span></div>
      <div className="kv"><span className="t2">Last sweep</span><span>{r.lastSweep ? `${formatDateTime(r.lastSweep.at)} · ${r.lastSweep.process}` : 'not yet'}</span></div>
      {r.lastSweep?.problem && <div className="note err small" role="alert"><Icon name="error" /><span>Last sweep problems: {r.lastSweep.problem}</span></div>}
      {r.lastSweep && (
        <details>
          <summary className="small">Deleted in the last sweep</summary>
          <table className="tbl retention-table">
            <tbody>{Object.entries(deleted).map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{formatNumber(v)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      <details>
        <summary className="small">Oldest per kind of data (oldest first)</summary>
        {/* 0.9.2: sorted oldest first, so the top row is the "Oldest Blizzard data stored" figure above. */}
        <table className="tbl retention-table">
          <tbody>{Object.entries(r.oldest).sort(([, a], [, b]) => (a ? Date.parse(a) : Infinity) - (b ? Date.parse(b) : Infinity)).map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{v ? `${((Date.now() - Date.parse(v)) / DAY).toFixed(1)} days` : '—'}</td></tr>)}</tbody>
        </table>
      </details>
      <form className="stack gap-8" onSubmit={save}>
        <Field label={setting?.label ?? 'Retention window (days)'} inputClassName="num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        {Number(days) > 30 && (
          <Field label="Blizzard’s written permission (who, when, what was granted)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} help="Required above 30 days, and logged." />
        )}
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        <Button type="submit" className="gold self-start" loading={busy}>Save</Button>
        {r.permission && <span className="muted xsmall">Permission on record: {r.permission}</span>}
      </form>
    </section>
  );
}
