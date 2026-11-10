import { usePageTitle } from '../pageTitle.js';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Segmented } from '../components/Controls.jsx';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { RankedTable, RulesetSwitcher } from '../components/Stats.jsx';
import { formatMoney } from '../collections/parts.jsx';
import { formatNumber } from '../format.js';

/**
 * Gold leaderboards (0.9.0), /leaderboards/gold/{ruleset}/{field}. Gold is private Blizzard data that only a
 * character's owner can read (at a Battle.net sign-in), so these boards rank ONLY characters whose owners chose "Show
 * my gold stats publicly", and say so. Turning it off takes a character off at once. Gold never feeds a tier.
 */
export function GoldBoardPage() {
  const { ruleset, field } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState({ busy: false });
  usePageTitle(data?.field?.label ? `${data.field.label}: gold on ${data.ruleset?.name ?? ''}`.trim() : null); // 0.9.2
  useEffect(() => {
    let live = true;
    setData(null);
    api(`/api/gold-boards/${encodeURIComponent(ruleset)}/${encodeURIComponent(field)}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [ruleset, field]);
  const loadMore = useCallback(async () => {
    setMore({ busy: true });
    const d = await api(`/api/gold-boards/${encodeURIComponent(ruleset)}/${encodeURIComponent(field)}?cursor=${encodeURIComponent(data.next)}`);
    setData((x) => ({ ...x, rows: [...x.rows, ...d.rows], next: d.next }));
    setMore({ busy: false });
  }, [data, ruleset, field]);
  if (error) {
    return <div className="wrap page-pad stack gap-16"><h1 className="h1">No such board</h1><EmptyState kind="nocoverage" title="Everstats has no such gold board"><span><Link to="/leaderboards">All leaderboards</Link></span></EmptyState></div>;
  }
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Gold</h1><span className="t2 small" role="status">Loading…</span></div>;
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-16 wrap-row">
        <div className="stack gap-10 flex-fill">
          <nav aria-label="Breadcrumb" className="crumbs xsmall"><Link to={`/leaderboards?ruleset=${data.ruleset.id}`}>Leaderboards</Link><span aria-hidden="true">/</span><span>Gold</span></nav>
          <h1 className="h1">{data.field.label}</h1>
          <span className="t2 small">Only characters whose owners chose to share. Gold never counts toward a tier.</span>
        </div>
        <RulesetSwitcher rulesets={data.rulesets} value={data.ruleset.id} onChange={(id) => navigate(`/leaderboards/gold/${id}/${field}`)} />
      </div>
      <Segmented label="Gold board" value={data.field.key} onChange={(k) => navigate(`/leaderboards/gold/${data.ruleset.id}/${k}`)} options={data.fields.map((f) => ({ id: f.key, label: f.label }))} />
      <section className="panel clip stack" aria-labelledby="gold-board-h">
        <div className="row board-head"><h2 className="h3" id="gold-board-h">{formatNumber(data.ranked)} shared on {data.ruleset.name}</h2><span className="tag">{data.ruleset.name}</span></div>
        <div className="pad-16 stack gap-14">
          <p className="muted xsmall">Blizzard shares a character’s gold only with its owner. A character is here only while its owner has “Show my gold stats publicly” on, and only with the gold read at their last Battle.net sign-in (kept at most 30 days).</p>
          {data.rows.length ? (
            <>
              <RankedTable valueLabel={data.field.label} formatValue={formatMoney} showTier={false} showMove={false} showGuild={false}
                rows={data.rows.map((r) => ({ ...r, detail: [r.level ? `Level ${r.level}` : null, r.race, r.class].filter(Boolean).join(' · ') }))} />
              {data.next && <button type="button" className="btn ghost self-start" disabled={more.busy} onClick={loadMore}>{more.busy ? 'Loading…' : 'Show more'}</button>}
            </>
          ) : (
            <EmptyState kind="nodata" title="Nobody has shared their gold yet">
              <span>Owners can turn on “Show my gold stats publicly” on their character’s Collections tab.</span>
            </EmptyState>
          )}
          <Provenance source="Blizzard’s protected character data, read with each owner’s own Battle.net sign-in" fetchedAt={data.rows[0]?.fetchedAt ?? null} />
        </div>
      </section>
    </div>
  );
}

/** The gold section on the leaderboards index: the four boards, top three each. */
export function GoldBoardsSection({ ruleset }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!ruleset) return undefined;
    let live = true;
    api(`/api/gold-boards?ruleset=${ruleset}`).then((d) => { if (live) setData(d); }, () => {});
    return () => {
      live = false;
    };
  }, [ruleset]);
  if (!data?.ruleset) return null;
  return (
    <section className="stack gap-14" id="gold" aria-labelledby="h-gold">
      <div className="row gap-12 wrap-row"><h2 className="h2" id="h-gold">Gold</h2><span className="muted small">Only characters whose owners chose to share · never in a tier</span></div>
      <div className="grid-auto col-md gap-14">
        {data.boards.map((b) => (
          <Link key={b.key} className="panel pad-16 stack gap-8 mini" to={`/leaderboards/gold/${data.ruleset.id}/${b.key}`}>
            <span className="h3">{b.label}</span>
            {b.top.length ? b.top.map((r) => <span key={r.slug} className="kv small"><span>#{r.rank} {r.name} {r.surname}</span><span className="strong">{formatMoney(r.value)}</span></span>)
              : <span className="muted small">Nobody has shared yet</span>}
            <span className="muted xsmall">{formatNumber(b.ranked)} shared</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
