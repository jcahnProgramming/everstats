import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Segmented } from '../../components/Controls.jsx';
import { formatDateTime } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { Change, Chip, Empty, PageHead, useHit } from '../shell/parts.jsx';
import { useShellInfo } from '../shell/scope.jsx';
import './dashboard.css';

/**
 * The Audit log (0.10.3, design/v5-admin pages/audit-log): every admin action in one list, newest first: when, who,
 * what (an action chip), the target (a link to it), before → after, and why. Filter by area or text; export as CSV.
 *
 * It reads the logs Everstats already kept (server/audit/log.js): admin_events since 0.1.0 and moderation_actions since
 * 0.8.2, so everything those held shows here as recorded. What older entries didn't record (the value before a setting
 * change, a reason, admin sign-ins before 0.10.3) says "not recorded", never a guess.
 *
 * A moderator (while moderators are on) sees only their own entries, from /api/admin/moderation/audit.
 *
 * Different from the mockup: the per-row version "scope" column shows the version only where the entry recorded one
 * (per-version tier settings and group decisions); everything else is a site-wide action and says so.
 */
const AREA_ICON = { moderation: 'shield-check', accounts: 'user', inbox: 'inbox', badges: 'badge', tiers: 'tiers', discovery: 'discovery', features: 'features', settings: 'settings', release: 'flags', 'sign-in': 'passkey', other: 'info' };

export function AuditPage() {
  const { role } = useShellInfo();
  const [params, setParams] = useSearchParams();
  const area = params.get('area') ?? '';
  const q = params.get('q') ?? '';
  const target = params.get('target') ?? '';
  const [text, setText] = useState(q);
  const [extra, setExtra] = useState([]); // later pages, appended
  const [next, setNext] = useState(null);
  const [more, setMore] = useState(false);
  const base = role === 'moderator' ? '/api/admin/moderation/audit' : '/api/admin/audit';
  const query = new URLSearchParams({ ...(area ? { area } : {}), ...(q ? { q } : {}), ...(target ? { target } : {}) }).toString();
  const p = usePanel('audit', () => api(`${base}${query ? `?${query}` : ''}`), [base, query]);
  useHit(p.data);

  useEffect(() => {
    setExtra([]);
    setNext(p.data?.next ?? null);
  }, [p.data]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text === q) return;
      setParams((x) => {
        const o = new URLSearchParams(x);
        if (text.trim()) o.set('q', text.trim());
        else o.delete('q');
        return o;
      }, { replace: true });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [text, q, setParams]);

  const setArea = (a) => setParams((x) => {
    const o = new URLSearchParams(x);
    if (a) o.set('area', a);
    else o.delete('area');
    return o;
  });
  const loadMore = async () => {
    setMore(true);
    try {
      const r = await api(`${base}?${new URLSearchParams({ ...(area ? { area } : {}), ...(q ? { q } : {}), ...(target ? { target } : {}), cursor: next })}`);
      setExtra((e) => [...e, ...r.entries]);
      setNext(r.next);
    } catch {
      // the panel's own error line covers a failed page; the button stays to try again
    }
    setMore(false);
  };

  const areas = p.data?.areas ?? [];
  const entries = [...(p.data?.entries ?? []), ...extra];
  return (
    <>
      <PageHead title="Audit log" desc={role === 'moderator'
        ? 'Your own moderation actions: when, what, on whom and why.'
        : 'Every admin action: moderation, settings, feature switches, badges, approvals, Discovery decisions, reveals, admin sign-ins and release tools. Who, when, what changed and why.'} />
      <Panel panel={p} title="Entries" id="audit" flush
        sub={role !== 'moderator' && <a className="btn sm ghost" href={`/api/admin/audit/export.csv${query ? `?${query}` : ''}`} download><Icon name="download" size="sm" />Export CSV</a>}>
        {(d) => (
          <>
            {role !== 'moderator' && (
              <div className="tbar">
                <label className="search">
                  <Icon name="search" />
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search actions, setting keys, reasons…" aria-label="Search the audit log" />
                </label>
                <Segmented label="Area" options={[{ id: '', label: 'All' }, ...areas.map((a) => ({ id: a.id, label: a.label }))]} value={area} onChange={setArea} />
                {target && <span className="chip info"><Icon name="filter" />{target}<button type="button" className="btn ghost sm icon" aria-label="Clear the target filter" onClick={() => setParams((x) => {
                  const o = new URLSearchParams(x);
                  o.delete('target');
                  return o;
                })}><Icon name="close" /></button></span>}
                <span className="spacer" />
                <span className="cnt">{entries.length}{next ? '+' : ''} entries</span>
              </div>
            )}
            {entries.length === 0 ? (
              <Empty icon="audit" title={q || area || target ? 'Nothing matches' : 'No admin actions recorded yet'}>
                {q || area || target ? 'Try another area or fewer words.' : 'Every change made in the admin will be listed here.'}
              </Empty>
            ) : (
              <div className="dt-wrap">
                <table className="dt audit-table">
                  <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Change</th><th scope="col">Why</th></tr></thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} id={`audit-${e.id.replace(':', '-')}`}>
                        <td className="dtl nw" data-label="When"><time dateTime={e.at}>{formatDateTime(e.at)}</time></td>
                        <td data-label="Who" className="t2">{e.actor.label}</td>
                        <td data-label="Action"><span className="row gap-6"><Chip kind="info" icon={AREA_ICON[e.area] ?? 'info'}>{(areas.find((a) => a.id === e.area)?.label) ?? e.area}</Chip><span>{e.action}</span></span></td>
                        <td data-label="Target">{e.target ? (e.target.href ? <Link className="tgt" to={e.target.href}>{e.target.label ?? `${e.target.kind} ${e.target.id ?? ''}`}</Link> : <span className="t2">{e.target.label ?? `${e.target.kind} ${e.target.id ?? ''}`}</span>) : <span className="muted">—</span>}</td>
                        <td data-label="Change">{e.after === null && e.before === null ? <span className="muted">—</span> : <Change before={e.before} after={e.after} recorded={e.beforeRecorded} />}</td>
                        <td data-label="Why" className="t2">{e.reason ?? <span className="muted">not recorded</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pager">
              <span>{d.recordsSince ? `Admin records since ${formatDateTime(d.recordsSince)}; moderation since 0.8.2.` : 'Newest first.'} Older entries without a “before” value or a reason say “not recorded”.</span>
              <span className="spacer" />
              {next && <button type="button" className={`btn sm${more ? ' is-loading' : ''}`} disabled={more} onClick={loadMore}>Load older</button>}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
