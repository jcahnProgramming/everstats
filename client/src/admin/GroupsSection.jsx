import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Segmented } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber } from '../format.js';

/**
 * 0.10.0: tier decisions by GROUP on /admin/discovery (server/tiers/groups.js, /api/admin/discovery/groups). For each
 * group of the chosen game version the owner picks "Counts toward tiers", "Own category letter only" or "Doesn't
 * count"; one click covers every statistic in the group, later ones included. A statistic decided on its own is an
 * EXCEPTION, listed under its group. Other versions show Forever's choice and how many statistic ids match Forever's,
 * as a suggestion only: nothing is applied until the owner picks. Everstats' own boards (collection counts, feed
 * values) count only with their own approval, so they never follow a group choice (said under the list).
 */
export function GroupsSection() {
  const toast = useToasts();
  const [version, setVersion] = useState(null);
  const [data, setData] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/discovery/groups${version ? `?version=${encodeURIComponent(version)}` : ''}`));
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  }, [version]);
  useEffect(() => {
    load();
  }, [load]);
  const choose = async (group, choice) => {
    setBusy(`${group}|${choice}`);
    try {
      const r = await api('/api/admin/discovery/groups', { method: 'POST', body: { version: data.version, group, choice } });
      setData((d) => ({ ...d, ...r }));
      toast.ok(choice === 'cleared' ? 'Choice taken back' : 'Group decided', `${group}: ${choice === 'cleared' ? 'undecided' : r.choices[choice]}. A full grading follows within a minute.`);
    } catch (err) {
      toast.err('Couldn’t save', err.message);
    }
    setBusy(null);
  };
  const toggle = (label) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(label)) n.delete(label);
    else n.add(label);
    return n;
  });
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="groups-h">
      <div className="row gap-10 wrap-row">
        <h2 className="h2 h2-panel" id="groups-h">Tier groups</h2>
        <span className="tag">Per game version</span>
      </div>
      <p className="t2 small">
        Choose, per group, whether its statistics count toward the tiers. A choice covers every statistic in the group, including ones Blizzard adds later.
        A statistic you decided on its own is shown as an exception and keeps its own decision.
      </p>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      {data === undefined && !problem && <span className="t2 small" role="status">Loading…</span>}
      {data && (
        <>
          <Segmented label="Game version" options={data.versions.map((v) => ({ id: v.id, label: `${v.short}${v.enabled ? '' : ' (off)'}` }))} value={data.version} onChange={setVersion} />
          {!data.groups.length && (
            <EmptyState kind="nodata" compact title="No statistics on this version yet">
              <span>Groups appear once this version’s statistics are in Everstats (0.11.0 fetches them). Its groups start undecided: no tiers until you choose.</span>
            </EmptyState>
          )}
          <ul className="plain stack gap-10">
            {data.groups.map((g) => (
              <li key={g.label} className="well pad-12 stack gap-8">
                <div className="row gap-10 wrap-row">
                  <strong>{g.label}</strong>
                  {g.farmable && <span className="tag">Farmable</span>}
                  <span className="muted xsmall">{formatNumber(g.statistics)} statistic{g.statistics === 1 ? '' : 's'} · {formatNumber(g.results.counted)} count{g.results.overall ? ` (${formatNumber(g.results.overall)} toward overall)` : ''} · {formatNumber(g.results.undecided)} undecided</span>
                  <span className="spacer" />
                  {g.choice
                    ? <span className="tag gold">{g.choice.label}{g.choice.origin === 'migration' ? ' · from your 0.9 decisions' : ''}</span>
                    : <span className="tag">Undecided</span>}
                </div>
                {g.suggestion && (
                  <span className="muted xsmall">Suggestion: {g.suggestion.forever.label}; {formatNumber(g.suggestion.idsMatchingForever)} of its {formatNumber(g.statistics)} statistic ids match Forever’s.</span>
                )}
                <div className="row gap-8 wrap-row">
                  {Object.entries(data.choices).map(([choice, label]) => (
                    <button key={choice} type="button" className={`btn sm${g.choice?.choice === choice ? ' gold' : ' ghost'}`} aria-pressed={g.choice?.choice === choice}
                      disabled={busy !== null || g.choice?.choice === choice} onClick={() => choose(g.label, choice)}>{label}</button>
                  ))}
                  {g.choice && <button type="button" className="btn sm ghost" disabled={busy !== null} onClick={() => choose(g.label, 'cleared')}>Undecide</button>}
                  {g.choice && <span className="muted xsmall">Since {formatDateTime(g.choice.decidedAt)}</span>}
                </div>
                {g.exceptions.length > 0 && (
                  <div className="stack gap-6">
                    <button type="button" className="btn ghost sm" aria-expanded={open.has(g.label)} onClick={() => toggle(g.label)}>
                      <Icon name={open.has(g.label) ? 'chevron-up' : 'chevron-down'} size="sm" />{formatNumber(g.exceptions.length)} exception{g.exceptions.length === 1 ? '' : 's'} to the group’s choice
                    </button>
                    {open.has(g.label) && (
                      <ul className="plain stack gap-4 small">
                        {g.exceptions.map((e) => <li key={e.id}><a href={`/admin/discovery?stat=${e.id}`}>{e.name}</a> <span className="muted">· {e.reason}</span></li>)}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <span className="muted xsmall">Boards Everstats makes (collection counts, and since 0.10.0 every number Blizzard’s feeds return) count only when you approve them one by one, never through a group.</span>
        </>
      )}
    </section>
  );
}
