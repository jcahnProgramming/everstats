import { usePageTitle } from '../pageTitle.js';
import { displayName } from '../../../server/stats/names.js';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useNavigate, useParams } from '../scope.jsx';
import { api } from '../api.js';
import { Segmented } from '../components/Controls.jsx';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RankedTable, RulesetSwitcher } from '../components/Stats.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../format.js';
import { GuildName } from '../guildBadges/GuildBadges.jsx';
import { ShareRowButton } from '../share/ShareButtons.jsx';

/**
 * 0.5.0: the two guild boards.
 *
 *   GuildBoardPage        /leaderboards/guilds/:ruleset/:statistic   guild vs guild: the TOTAL of each guild's current
 *                         tracked members (default) or the AVERAGE per member, in the same three periods as the character
 *                         boards. A guild with fewer tracked members than the admin minimum is "Not ranked yet".
 *   GuildMemberBoardPage  /g/:slug/boards/:statistic                  one guild's own members on one statistic.
 *
 * Same rules as the character boards: zero is never ranked, ties share a rank, "Collecting data" until snapshots
 * cover the whole period. Built from the leaderboard-single design's parts (it has no guild board of its own).
 */
const periodsFor = (days) => [
  { id: 'overall', label: 'Overall' },
  { id: 'week', label: 'This week' },
  { id: 'rolling', label: days ? `Last ${days} days` : 'Recent days' },
];
const KNOWN = ['overall', 'week', 'rolling'];
const MODES = [{ id: 'total', label: 'Total' }, { id: 'average', label: 'Average per member' }];
const round1 = (v) => Math.round(v * 10) / 10;

function usePeriod(params) {
  const asked = params.get('period');
  return KNOWN.includes(asked) ? asked : 'overall';
}

function Collecting({ period, p }) {
  return (
    <EmptyState kind="collecting" title={period === 'week' ? 'Opens after the first full week' : `Opens once there are ${p.days} days of snapshots`}>
      <span>Period boards rank what was gained, so they wait until daily snapshots cover the whole period. This board opens {p.opensAt ? formatDateTime(p.opensAt) : 'once snapshots start'}.</span>
    </EmptyState>
  );
}

function NoBoard() {
  return (
    <div className="wrap page-pad stack gap-24">
      <nav aria-label="Breadcrumb" className="crumbs xsmall"><Link to="/leaderboards?view=guilds">Guild boards</Link></nav>
      <h1 className="h1">No such board</h1>
      <EmptyState kind="nocoverage" title="Everstats doesn't track this statistic on this ruleset">
        <span>No board exists at this address: not an empty one, none at all.</span>
      </EmptyState>
    </div>
  );
}

export function GuildBoardPage() {
  const { ruleset, statistic } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const period = usePeriod(params);
  const mode = params.get('mode') === 'average' ? 'average' : 'total';
  const [data, setData] = useState(null);
  usePageTitle(data?.statistic?.name ? `${displayName(data.statistic.name)}: guild board on ${data.ruleset?.name ?? ''}`.trim() : null); // 0.9.2
  const [error, setError] = useState(null);
  const [more, setMore] = useState({ rows: [], next: null, busy: false });
  const base = `/api/guild-boards/${encodeURIComponent(ruleset)}/${encodeURIComponent(statistic)}?period=${period}&mode=${mode}`;

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api(base).then((d) => {
      if (!live) return;
      setData(d);
      setMore({ rows: [], next: d.next, busy: false });
    }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [base]);

  const loadMore = useCallback(async () => {
    setMore((m) => ({ ...m, busy: true }));
    try {
      const d = await api(`${base}&cursor=${encodeURIComponent(more.next)}`);
      setMore((m) => ({ rows: [...m.rows, ...d.rows], next: d.next, busy: false }));
    } catch {
      setMore((m) => ({ ...m, busy: false }));
    }
  }, [base, more.next]);

  const set = (next) => {
    const q = { period, mode, ...next };
    setParams(Object.fromEntries(Object.entries(q).filter(([k, v]) => !(k === 'period' && v === 'overall') && !(k === 'mode' && v === 'total'))));
  };

  if (error) return error.status === 404 ? <NoBoard /> : <div className="wrap page-pad"><ServiceUnavailable title="Couldn't load this board">{error.message}</ServiceUnavailable></div>;
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Guild board</h1><span className="t2 small" role="status">Loading…</span></div>;

  const s = data.statistic;
  const rows = [...data.rows, ...more.rows];
  const p = period === 'overall' ? null : data.periods[period];
  const what = period === 'overall' ? '' : ' gained';
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-16 board-title">
        <div className="stack gap-10 flex-fill">
          <nav aria-label="Breadcrumb" className="crumbs xsmall">
            <Link to={`/leaderboards?view=guilds&ruleset=${data.ruleset.id}`}>Guild boards</Link><span aria-hidden="true">/</span>
            <Link to={`/leaderboards?view=guilds&ruleset=${data.ruleset.id}#${s.categoryKey}`}>{s.category}</Link>
          </nav>
          <h1 className="h1">{displayName(s.name) ?? 'Statistic no longer available'}</h1>
          <span className="t2 small">Guilds ranked by the {mode === 'total' ? 'total' : 'average per member'} of their current tracked members.{' '}
            <Link to={`/leaderboards/${data.ruleset.id}/${s.id}${period === 'overall' ? '' : `?period=${period}`}`}>Characters on this board →</Link></span>
        </div>
        <RulesetSwitcher rulesets={data.rulesets} value={data.ruleset.id} onChange={(id) => navigate(`/leaderboards/guilds/${id}/${s.id}${window.location.search}`)} />
      </div>

      <div className="row gap-12">
        <Segmented label="Period" options={periodsFor(data.periods.rolling?.days)} value={period} onChange={(id) => set({ period: id })} />
        <Segmented label="Rank guilds by" options={MODES} value={mode} onChange={(id) => set({ mode: id })} />
      </div>

      <div className="split">
        <section className="panel clip stack main" aria-labelledby="board-h">
          <div className="row board-head">
            <h2 className="h3" id="board-h">{data.collecting ? 'Collecting data' : `${formatNumber(data.ranked)} guild${data.ranked === 1 ? '' : 's'} ranked · ${mode === 'total' ? 'totals' : 'averages'} of current members`}</h2>
            <span className="tag">{data.ruleset.name}</span>
          </div>
          <div className="pad-16 stack gap-14">
            <p className="muted xsmall">Totals of current members: a guild’s figure comes from the characters in it today. A player who leaves takes their numbers with them{period === 'overall' ? '' : ', and their gains this period count for the guild they’re in now'}. Hidden characters count toward nothing. A guild is ranked once it has {formatNumber(data.minMembers)} tracked members{period === 'overall' ? '' : ' with snapshots this period'}.</p>
            {data.collecting ? <Collecting period={period} p={p} />
              : data.population === 0 && data.notYetCount === 0 ? (
                <EmptyState kind="nodata" title="No guild has tracked members here yet">
                  <span>Guilds appear as their members are looked up, sign in, or are found on a roster.</span>
                </EmptyState>
              ) : data.ranked === 0 ? (
                <EmptyState kind="nodata" title={data.population === 0 ? `No guild has ${data.minMembers} tracked members yet` : `No ranked guild has any${what} yet`}>
                  <span>{data.population === 0 ? 'Guilds below the minimum are listed under “Not ranked yet”.' : 'Every ranked guild is at 0 here, and a zero isn’t ranked.'}</span>
                </EmptyState>
              ) : data.tied ? (
                <EmptyState kind="tied" title={`All ${formatNumber(data.ranked)} ranked guilds are at ${formatNumber(round1(data.tiedValue))}`}>
                  <span>Ranking them would be a meaningless order, so there isn’t one.</span>
                </EmptyState>
              ) : (
                <>
                  <GuildTable rows={rows} mode={mode} shareTo={(r) => ({ to: `/leaderboards/guilds/${data.ruleset.id}/${s.id}/share?${new URLSearchParams({ g: r.slug, ...(mode === 'average' ? { mode } : {}), ...(period === 'overall' ? {} : { period }) })}`, label: `Share #${r.rank} ${s.name ?? ''}`.trim() })} />
                  {more.next && <button type="button" className="btn ghost self-start" disabled={more.busy} onClick={loadMore}>{more.busy ? 'Loading…' : 'Show more'}</button>}
                  {data.atZero > 0 && <p className="muted small">{formatNumber(data.atZero)} more ranked guild{data.atZero === 1 ? ' is' : 's are'} at 0{what}: not ranked.</p>}
                </>
              )}
            {data.computed?.newest && (
              <Provenance source="Sums of each member’s Blizzard statistics, recomputed within minutes of a member’s fetch" fetchedAt={data.computed.newest}>
                <span className="muted">Oldest guild total: {timeAgo(data.computed.oldest)}</span>
              </Provenance>
            )}
          </div>
        </section>

        <aside className="stack gap-18 side">
          {!data.collecting && data.notYet?.length > 0 && (
            <section className="panel pad-20 stack gap-10" aria-labelledby="notyet-h">
              <h2 className="h3" id="notyet-h">Not ranked yet</h2>
              <span className="muted xsmall">Needs {formatNumber(data.minMembers)} tracked members. {data.notYetCount > data.notYet.length ? `Showing ${data.notYet.length} of ${formatNumber(data.notYetCount)}.` : ''}</span>
              {data.notYet.map((g) => (
                <div key={g.slug} className="kv">
                  <GuildName guild={g} />
                  <span className="t2 nowrap">{formatNumber(g.members)} of {formatNumber(data.minMembers)}</span>
                </div>
              ))}
            </section>
          )}
          <section className="panel pad-20 stack gap-10" aria-labelledby="about-h">
            <h2 className="h3" id="about-h">About this board</h2>
            <div className="kv"><span className="t2">Ranked by</span><span>{mode === 'total' ? 'Total of members' : 'Average per member'}</span></div>
            <div className="kv"><span className="t2">Members counted</span><span>current, tracked</span></div>
            <div className="kv"><span className="t2">Ruleset</span><span>{data.ruleset.name}</span></div>
            <div className="kv"><span className="t2">Ties</span><span>share a rank</span></div>
            <div className="kv"><span className="t2">Minimum to rank</span><span>{formatNumber(data.minMembers)} members</span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function GuildTable({ rows, mode, shareTo = null }) {
  return (
    <div className="tblbox">
      <table className="tbl to-list">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Guild</th>
            <th scope="col" className="r">Members</th>
            <th scope="col" className={mode === 'total' ? 'r' : 'r muted'}>Total</th>
            <th scope="col" className={mode === 'average' ? 'r' : 'r muted'}>Average</th>
            {shareTo && <th scope="col"><span className="sr-only">Share</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug}>
              <td className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{formatNumber(r.rank)}</td>
              <td><span className="stack"><GuildName guild={r} />{r.faction && <span className="muted xsmall">{r.faction}</span>}</span></td>
              <td className="r t2">{formatNumber(r.members)}</td>
              <td className={`r${mode === 'total' ? ' strong' : ' t2'}`}>{formatNumber(r.total)}</td>
              <td className={`r${mode === 'average' ? ' strong' : ' t2'}`}>{formatNumber(round1(r.average))}</td>
              {shareTo && <td className="r"><ShareRowButton {...shareTo(r)} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="ranklist only-phone">
        {rows.map((r) => (
          <li key={r.slug} className={shareTo ? 'has-share' : undefined}>
            <Link to={`/g/${encodeURIComponent(r.slug)}`}>
              <span className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{formatNumber(r.rank)}</span>
              <span className="strong ellipsis"><GuildName guild={r} link={false} still /></span>
              <span className="strong">{formatNumber(round1(mode === 'total' ? r.total : r.average))}</span>
              <span className="muted xsmall ellipsis">{formatNumber(r.members)} members · {mode === 'total' ? `avg ${formatNumber(round1(r.average))}` : `total ${formatNumber(r.total)}`}</span>
            </Link>
            {shareTo && <ShareRowButton {...shareTo(r)} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GuildMemberBoardPage() {
  const { slug, statistic } = useParams();
  const [params, setParams] = useSearchParams();
  const period = usePeriod(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api(`/api/guilds/${encodeURIComponent(slug)}/boards/${encodeURIComponent(statistic)}?period=${period}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [slug, statistic, period]);

  if (error) {
    return error.status === 404 ? (
      <div className="wrap page-pad stack gap-24">
        <h1 className="h1">No such board</h1>
        <EmptyState kind="nocoverage" title="Everstats doesn't know this guild or statistic">
          <span><Link to={`/g/${encodeURIComponent(slug)}`}>Open the guild’s page</Link> first: a guild Everstats hasn’t seen is looked up there.</span>
        </EmptyState>
      </div>
    ) : <div className="wrap page-pad"><ServiceUnavailable title="Couldn't load this board">{error.message}</ServiceUnavailable></div>;
  }
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Guild board</h1><span className="t2 small" role="status">Loading…</span></div>;
  const s = data.statistic;
  const g = data.guild;
  const p = period === 'overall' ? null : data.periods[period];
  const what = period === 'overall' ? '' : ' gained';
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="stack gap-10">
        <nav aria-label="Breadcrumb" className="crumbs xsmall"><Link to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link><span aria-hidden="true">/</span><span>{s.category}</span></nav>
        <h1 className="h1">{displayName(s.name) ?? 'Statistic no longer available'}</h1>
        <span className="t2 small">{g.name}’s own members{g.ruleset ? <> · <Link to={`/leaderboards/${g.ruleset.id}/${s.id}${period === 'overall' ? '' : `?period=${period}`}`}>everyone on {g.ruleset.name} →</Link></> : null}</span>
      </div>
      <Segmented label="Period" options={periodsFor(data.periods.rolling?.days)} value={period} onChange={(id) => setParams(id === 'overall' ? {} : { period: id })} />
      <section className="panel clip stack" aria-labelledby="board-h">
        <div className="row board-head">
          <h2 className="h3" id="board-h">{data.collecting ? 'Collecting data' : `${formatNumber(data.rows.length)} with any · ${formatNumber(data.members)} tracked members`}</h2>
          {g.ruleset && <span className="tag">{g.ruleset.name}</span>}
        </div>
        <div className="pad-16 stack gap-14">
          {data.collecting ? <Collecting period={period} p={p} />
            : data.rows.length === 0 ? (
              <EmptyState kind="nodata" title={`No member has any${what} yet`}>
                <span>A value of 0 isn’t ranked. {formatNumber(data.members)} tracked member{data.members === 1 ? ' is' : 's are'} at 0.</span>
              </EmptyState>
            ) : (
              <>
                <RankedTable valueLabel={period === 'overall' ? (displayName(s.name) ?? 'Value') : 'Gained'} showTier={false} showMove={false} showGuild={false}
                  rows={data.rows.map((r) => ({ ...r, detail: [r.level ? `Level ${r.level}` : null, r.race, r.class].filter(Boolean).join(' · '), valueText: r.text }))} />
                {data.atZero > 0 && <p className="muted small">{formatNumber(data.atZero)} more tracked member{data.atZero === 1 ? ' is' : 's are'} at 0{what}: not ranked.</p>}
              </>
            )}
        </div>
      </section>
    </div>
  );
}
