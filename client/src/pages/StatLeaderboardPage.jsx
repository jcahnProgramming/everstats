import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { Segmented } from '../components/Controls.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RankedTable, RulesetSwitcher } from '../components/Stats.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../format.js';

/**
 * One statistic's leaderboard on one ruleset (design/v1/pages/leaderboard-single), in three periods:
 *   Overall   the value
 *   Weekly    what each character GAINED since its first snapshot this week (US weekly reset, Tuesday 15:00 UTC)
 *   Last N days  0.4.2, replacing "Monthly": gained since the character's oldest snapshot still kept. Blizzard's API terms
 *             allow keeping data for at most 30 days, and Everstats keeps N of them (N comes from the server: 26).
 * Both say "Collecting data" until snapshots cover the whole period: never a partial ranking.
 *
 * Different from the mockup: no tier or 7-day columns (tiers are the next build, movement needs a week of history),
 * no faction filter or jump-to search yet, no "Climbers this week" card (the Weekly tab is that board), and guild
 * rankings say "Coming soon" (guild pages are the next build).
 */
const periodsFor = (days) => [
  { id: 'overall', label: 'Overall' },
  { id: 'week', label: 'This week' },
  { id: 'rolling', label: days ? `Last ${days} days` : 'Recent days' },
];
const KNOWN = ['overall', 'week', 'rolling'];

export function StatLeaderboardPage() {
  const { ruleset, statistic } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const askedPeriod = params.get('period') === 'month' ? 'rolling' : params.get('period'); // an old "monthly" link
  const period = KNOWN.includes(askedPeriod) ? askedPeriod : 'overall';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState({ rows: [], next: null, busy: false });

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api(`/api/leaderboards/${encodeURIComponent(ruleset)}/${encodeURIComponent(statistic)}?period=${period}`).then((d) => {
      if (!live) return;
      setData(d);
      setMore({ rows: [], next: d.next, busy: false });
    }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [ruleset, statistic, period]);

  const loadMore = useCallback(async () => {
    setMore((m) => ({ ...m, busy: true }));
    try {
      const d = await api(`/api/leaderboards/${encodeURIComponent(ruleset)}/${encodeURIComponent(statistic)}?period=${period}&cursor=${encodeURIComponent(more.next)}`);
      setMore((m) => ({ rows: [...m.rows, ...d.rows], next: d.next, busy: false }));
    } catch {
      setMore((m) => ({ ...m, busy: false }));
    }
  }, [ruleset, statistic, period, more.next]);

  if (error) {
    if (error.status === 404) {
      return (
        <div className="wrap page-pad stack gap-24">
          <nav aria-label="Breadcrumb" className="crumbs xsmall"><Link to="/leaderboards">Leaderboards</Link></nav>
          <h1 className="h1">No such board</h1>
          <EmptyState kind="nocoverage" title="Everstats doesn't track this statistic on this ruleset">
            <span>No board exists at this address: not an empty one, none at all.</span>
            <span className="row gap-8"><Link className="btn sm ghost" to="/leaderboards">Back to boards</Link></span>
          </EmptyState>
        </div>
      );
    }
    return <div className="wrap page-pad"><ServiceUnavailable title="Couldn't load this board">{error.message}</ServiceUnavailable></div>;
  }
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Leaderboard</h1><span className="t2 small" role="status">Loading…</span></div>;

  const s = data.statistic;
  const rows = [...data.rows, ...more.rows];
  const valueLabel = period === 'overall' ? (s.name ?? 'Value') : 'Gained';
  const grading = s.grading === 'none' ? 'Leaderboard only: never counts toward a tier' : s.farmable || s.grading === 'category' ? `Counts toward its own ${s.category} tier, not the overall tier` : 'Counts toward the overall tier';
  const p = period === 'overall' ? null : data.periods[period];
  const rollingDays = data.periods.rolling?.days;

  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-16 board-title">
        <div className="stack gap-10 grow">
          <nav aria-label="Breadcrumb" className="crumbs xsmall">
            <Link to={`/leaderboards?ruleset=${data.ruleset.id}`}>Leaderboards</Link><span aria-hidden="true">/</span>
            <Link to={`/leaderboards?ruleset=${data.ruleset.id}#${s.categoryKey}`}>{s.category}</Link>
          </nav>
          <h1 className="h1">{s.name ?? 'Statistic no longer available'}</h1>
          <span className="t2 small">{grading}.{s.named ? ' Ranked by the number; the name beside it is what this character did most.' : ''}</span>
        </div>
        <RulesetSwitcher rulesets={data.rulesets} value={data.ruleset.id} onChange={(id) => navigate(`/leaderboards/${id}/${s.id}${period === 'overall' ? '' : `?period=${period}`}`)} />
      </div>

      <div className="row gap-12">
        <Segmented label="Period" options={periodsFor(data.periods.rolling?.days)} value={period} onChange={(id) => setParams(id === 'overall' ? {} : { period: id })} />
        {period === 'week' && <span className="muted xsmall">Resets Tuesday 15:00 UTC (the US weekly reset) · since {formatDateTime(p.start)}</span>}
        {period === 'rolling' && <span className="muted xsmall">Gains over the last {p.days} days: each character’s oldest kept snapshot to now.</span>}
      </div>

      <div className="split">
        <section className="panel clip stack main" aria-labelledby="board-h">
          <div className="row board-head">
            <h2 className="h3" id="board-h">{data.collecting ? 'Collecting data' : `${formatNumber(data.nonzero)} with any · ${formatNumber(data.population)} tracked on ${data.ruleset.name}`}</h2>
            <span className="tag">{data.ruleset.name}</span>
          </div>
          <div className="pad-16 stack gap-14">
            <p className="muted xsmall">Beta: boards are filling up as players join.{period === 'week' ? ' A character’s gain counts only from its first snapshot this week: someone tracked since Thursday shows what they gained since Thursday.' : ''}{period === 'rolling' ? ` Blizzard’s rules let Everstats keep game data for at most 30 days; it keeps ${rollingDays}, so this is the longest stretch it can rank.` : ''}</p>
            {data.collecting ? (
              <EmptyState kind="collecting" title={period === 'week' ? 'Opens after the first full week' : `Opens once there are ${p.days} days of snapshots`}>
                <span>{period === 'week' ? 'Weekly boards rank what characters gained, so they need daily snapshots from the very start of a week.' : `This board ranks what characters gained over the last ${p.days} days, so it waits until snapshots go back that far.`} Snapshots began {data.periods.firstSnapshotAt ? formatDateTime(data.periods.firstSnapshotAt) : 'with the first tracked character (none yet)'}; this board opens {p.opensAt ? formatDateTime(p.opensAt) : 'once snapshots start'}.</span>
              </EmptyState>
            ) : data.population === 0 ? (
              <EmptyState kind="nodata" title="Nobody tracked on this ruleset yet">
                <span>The board fills in as characters on {data.ruleset.name} are looked up or sign in.</span>
              </EmptyState>
            ) : data.nonzero === 0 ? (
              <EmptyState kind="nodata" title={period === 'overall' ? 'Nobody tracked has any yet' : period === 'week' ? 'Nobody has gained any this week' : `Nobody has gained any in the last ${rollingDays} days`}>
                <span>All {formatNumber(data.population)} tracked characters on {data.ruleset.name} are at 0, and a zero isn't ranked. The board fills in as soon as someone {period === 'overall' ? 'has one' : 'gains one'}.</span>
              </EmptyState>
            ) : data.tied ? (
              <EmptyState kind="tied" title={`All ${formatNumber(data.nonzero)} with any are at ${formatNumber(data.tiedValue)}`}>
                <span>Ranking them would be a meaningless order, so there isn't one. The board ranks as soon as someone {period === 'overall' ? 'gets a different value' : 'gains something'}.</span>
              </EmptyState>
            ) : (
              <>
                <RankedTable valueLabel={valueLabel} rows={rows.map((r) => ({ ...r, slug: r.slug ?? `${r.name}-${r.surname}`.toLowerCase(), detail: [r.level ? `Level ${r.level}` : null, r.race, r.class].filter(Boolean).join(' · '), value: r.value, valueText: r.text }))} showTier={false} showMove={false} />
                {more.next && <button type="button" className="btn ghost self-start" disabled={more.busy} onClick={loadMore}>{more.busy ? 'Loading…' : 'Show more'}</button>}
                {data.atZero > 0 && (
                  <p className="muted small">{formatNumber(data.atZero)} more tracked character{data.atZero === 1 ? ' is' : 's are'} at 0{period === 'overall' ? '' : ' gained'}: not ranked.</p>
                )}
              </>
            )}
            {data.data?.newest ? (
              <Provenance source="Blizzard achievement statistics, refreshed daily for every tracked character" fetchedAt={data.data.newest}>
                <span className="muted">Oldest on this board: {timeAgo(data.data.oldest)}</span>
              </Provenance>
            ) : null}
          </div>
        </section>

        <aside className="stack gap-18 side">
          {data.mine?.length > 0 && (
            <section className="sheet pad-20 stack gap-10" aria-labelledby="mine-h">
              <h2 className="h3" id="mine-h">Your characters on this board</h2>
              {data.mine.map((m) => (
                <div key={m.slug} className="kv">
                  <Link to={`/c/${encodeURIComponent(m.slug)}`}>{m.name} <span className="surname">{m.surname}</span></Link>
                  <span className="t2">{m.hidden ? 'hidden' : m.rank === null ? 'Not ranked (0)' : <><b className="strong-text">#{formatNumber(m.rank)}</b> of {formatNumber(m.withAny)} · {formatNumber(m.value)}</>}</span>
                </div>
              ))}
            </section>
          )}
          <section className="panel pad-20 stack gap-10" aria-labelledby="about-h">
            <h2 className="h3" id="about-h">About this board</h2>
            <div className="kv"><span className="t2">Category</span><span>{s.category}</span></div>
            <div className="kv"><span className="t2">Ruleset</span><span>{data.ruleset.name}</span></div>
            <div className="kv"><span className="t2">Ties</span><span>share a rank</span></div>
            {!data.collecting && <div className="kv"><span className="t2">Above zero</span><span>{formatNumber(data.nonzero)}</span></div>}
          </section>
          <section className="panel pad-20 stack gap-12" aria-labelledby="guilds-h">
            <h2 className="h3" id="guilds-h"><Icon name="guild" size="sm" /> Guild rankings</h2>
            <EmptyState kind="soon" compact title="Guilds ranked on this statistic come with guild pages" />
          </section>
        </aside>
      </div>
    </div>
  );
}
