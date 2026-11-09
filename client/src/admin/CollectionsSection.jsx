import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatBytes, formatDateTime, formatNumber } from '../format.js';

/**
 * /admin → Collections (0.9.0): Blizzard's static catalogs (state, size and the requests and bytes each refresh really
 * cost), the Legacy Points reward texts in the achievement catalog (what is counted, and anything mentioning "Legacy"
 * that isn't), account-wide detection evidence, and the per-character refresh cost measured from the last hour.
 */
export function CollectionsSection() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/admin/collections').then((x) => { if (live) setD(x); }, () => {});
    return () => {
      live = false;
    };
  }, []);
  if (!d) return <section className="panel pad-20"><h2 className="h2 h2-panel">Collections</h2><span className="t2 small" role="status">Loading…</span></section>;
  const daily = d.refreshes.requestsEach ? Math.round((d.tracked.n * d.refreshes.requestsEach) / 7) : null;
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="coll-admin-h">
      <h2 className="h2 h2-panel" id="coll-admin-h">Collections</h2>
      <div className="stack gap-6 small">
        <span><b>Refresh cost, measured:</b> {d.refreshes.lastHour ? `${formatNumber(d.refreshes.requestsEach)} requests and ${formatNumber(d.refreshes.kbEach)} KB per character (average of ${formatNumber(d.refreshes.lastHour)} refreshes finished in the last hour)` : 'no collections refresh finished in the last hour, so nothing to measure yet'}.</span>
        <span>{formatNumber(d.tracked.n)} tracked characters of level 10+ ({formatNumber(d.tracked.hunters)} hunters) · {formatNumber(d.tracked.with_collections)} have collections.{daily !== null ? ` Weekly refreshes add about ${formatNumber(daily)} requests a day at today’s count (tracked × measured requests ÷ 7), plus sign-ins and tab opens.` : ''}</span>
      </div>
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">Catalog</th><th scope="col">State</th><th scope="col" className="r">Entries</th><th scope="col" className="r">Requests</th><th scope="col" className="r">Bytes</th><th scope="col">Finished</th></tr></thead>
          <tbody>{d.catalogs.map((c) => (
            <tr key={c.kind}><td>{c.label}{c.detail && c.kind !== 'namespace' ? <span className="muted xsmall"> · {c.detail}</span> : null}{c.kind === 'namespace' ? <span className="mono xsmall"> {c.detail}</span> : null}</td><td>{c.state}</td><td className="r">{c.total === null ? '—' : formatNumber(c.total)}</td><td className="r">{formatNumber(c.requests)}</td><td className="r">{formatBytes(c.bytes)}</td><td>{c.finished_at ? formatDateTime(c.finished_at) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="stack gap-6 small">
        <b>Legacy Points: reward texts in the achievement catalog ({formatNumber(d.legacy.achievements)} achievements)</b>
        {d.legacy.counted.map((p) => <span key={p.text}>Counted: “{p.text}” · {formatNumber(p.achievements)}</span>)}
        {d.legacy.uncounted.map((p) => <span key={p.text} className="strong-text">Mentions Legacy, NOT counted: “{p.text}” · {formatNumber(p.achievements)}</span>)}
        {!d.legacy.counted.length && !d.legacy.uncounted.length && <span className="muted">No reward text mentions Legacy yet (or the catalog isn’t built).</span>}
        <span className="muted">Other reward texts: {formatNumber(d.legacy.otherRewards)}.</span>
      </div>
      <div className="stack gap-6 small">
        <b>Account-wide detection (accounts with two or more fetched characters)</b>
        {Object.keys(d.sharing).length ? Object.entries(d.sharing).map(([k, v]) => <span key={k}>{k}: identical on {formatNumber(v.shared)} of {formatNumber(v.accounts)}</span>) : <span className="muted">No account has two fetched characters to compare yet.</span>}
      </div>
    </section>
  );
}
