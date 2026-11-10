import { usePageTitle } from '../pageTitle.js';
import { displayName } from '../../../server/stats/names.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { parseGuildSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { viaSearchOnce } from '../activity.js';
import { Icon } from '../chrome/Icon.jsx';
import { Segmented } from '../components/Controls.jsx';
import { EmptyState, Fresh, Provenance } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { TierBadge, TierDistribution, TierLink } from '../components/Tier.jsx';
import { formatDate, formatNumber, timeAgo } from '../format.js';
import { NameWithBadge } from '../badges/Badges.jsx';
import { GuildLinksArea, ManageGuild } from './GuildManage.jsx';
import { GuildBadgeArea, GuildBadgeToasts, VerifiedMark } from '../guildBadges/GuildBadges.jsx';
import { ShareButton } from '../share/ShareButtons.jsx';
import { PinGuildButton } from './YourGuilds.jsx';
import { SignInNudge } from '../chrome/SignInNudge.jsx';
import { GuildFetch } from './GuildFetch.jsx';

/**
 * A guild (design/v1/pages/guild), 0.5.0. GET /api/guilds/:slug answers from what Everstats stored; a guild it has
 * never fetched is looked up at Blizzard once (rate-limited like a character look-up).
 *
 * Different from the mockup, on purpose:
 *   - 0.6.0: "Members by tier" counts real letters (Unranked included, and said in words beside the bar) and the roster
 *     has a tier column; each letter links to that member's "Why this tier". No "Best category" column (not built).
 *   - 0.6.0: "On the guild boards" lists a board only once it has guilds.minBoardGuilds ranked guilds ("#1 of 1" says
 *     nothing), and says so when none qualifies yet.
 *   - Counts say exactly what they are: Blizzard's roster size and how many of them Everstats tracks. Members under
 *     level 10 or not fetched yet are COUNTED, never listed by name; hidden characters appear nowhere and count toward
 *     nothing.
 *   - Guild rank: Blizzard sends only a number. 0 is shown as "Guild Master", the rest as "Rank N" (Forever's roster
 *     has no rank names).
 *   - "On the boards" is the guild's own placements on the guild boards (guild vs guild), not its members'.
 *   - Added: totals of the default pinned statistics, and every statistic's top five members, by period.
 */
const PERIODS = (days) => [
  { id: 'overall', label: 'Overall' },
  { id: 'week', label: 'This week' },
  { id: 'rolling', label: days ? `Last ${days} days` : 'Recent days' },
];
const KNOWN = ['overall', 'week', 'rolling'];

const NOTICES = {
  rate_limited: 'You’ve looked up a lot from this network, so this is what Everstats already had, not a fresh fetch.',
  slow: 'Blizzard was slow to answer, so this is what Everstats already had.',
  unavailable: 'Blizzard didn’t answer just now, so this is what Everstats already had.',
  not_configured: 'Look-ups are switched off, so this is what Everstats already had.',
};

export function GuildPage() {
  const { slug: raw } = useParams();
  const slug = parseGuildSlug(raw);
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  usePageTitle(result?.guild?.name ? `<${result.guild.name}>` : null); // 0.9.2

  const load = useCallback(async () => {
    if (!slug) return;
    setResult(null);
    try {
      // via=search: opened from a guild search (counted for the admin's Activity panel; a count, nothing else).
      const via = viaSearchOnce();
      const r = await api(`/api/guilds/${encodeURIComponent(slug)}${via}`);
      if (r.status === 'moved') navigate(`/g/${encodeURIComponent(r.slug)}`, { replace: true });
      else setResult(r);
    } catch (err) {
      setResult({ error: err });
    }
  }, [slug, navigate]);
  useEffect(() => {
    load();
  }, [load]);

  if (!slug) {
    return (
      <div className="wrap page-pad stack gap-24">
        <h1 className="h1">That isn't a guild address</h1>
        <EmptyState kind="nocoverage" title="Guilds are found by name">
          <span>Try <Link to="/guilds">the guild search</Link>.</span>
        </EmptyState>
      </div>
    );
  }
  if (result === null) {
    return (
      <div className="wrap page-pad stack gap-24">
        <section className="sheet row gap-24 sheet-pad guild-banner" aria-busy="true">
          <GuildCrest />
          <div className="stack gap-8 flex-fill">
            <span className="eyebrow">Guild · US</span>
            <h1 className="h1 guild-name">{slug}</h1>
            <span className="t2 small" role="status">Looking this guild up…</span>
          </div>
        </section>
      </div>
    );
  }
  if (result.error) {
    const e = result.error;
    return (
      <div className="wrap page-pad">
        {e.status === 429 ? (
          <ServiceUnavailable title="Too many look-ups from your network" onRetry={load} detail="Look-ups that ask Blizzard are limited to 30 every 15 minutes per network.">
            Wait a few minutes and try again. Guilds Everstats already knows still open.
          </ServiceUnavailable>
        ) : <ServiceUnavailable title="Can't reach Everstats" onRetry={load}>{e.message}</ServiceUnavailable>}
      </div>
    );
  }
  if (result.status === 'not_found') {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">{result.known?.name ?? slug}</h1>
        <EmptyState kind="nocoverage" title="Blizzard has no guild at this address">
          <span>Blizzard serves no Forever guild called “{slug}” in the US region. It may have been renamed or disbanded, or the address is mistyped.</span>
          <span className="row gap-8"><Link className="btn sm ghost" to="/guilds">Search guilds</Link></span>
        </EmptyState>
      </div>
    );
  }
  if (result.status === 'unavailable') {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">{slug}</h1>
        <EmptyState kind="couldnt" title={result.reason === 'not_configured' ? 'Look-ups aren’t switched on yet' : 'We couldn’t check Blizzard just now'} action={result.reason === 'not_configured' ? null : <button type="button" className="btn sm self-start" onClick={load}><Icon name="refresh" size="sm" />Try again</button>}>
          <span>Everstats hasn’t seen this guild yet, and couldn’t ask Blizzard about it. This says nothing about whether it exists.</span>
        </EmptyState>
      </div>
    );
  }
  return <GuildSheet data={result} onReload={load} />;
}

function GuildSheet({ data, onReload }) {
  const g = data.guild;
  const c = data.counts;
  const canManage = Boolean(data.viewerRole);
  return (
    <div className="wrap page-pad stack gap-32">
      <GuildBadgeToasts slug={g.slug} enabled={canManage} />
      {data.notice && <div className="note warn small" role="status"><Icon name="warning" /><span className="flex-fill">{NOTICES[data.notice]}</span></div>}
      <SignUpCall guild={g} />
      <section className="sheet row gap-24 sheet-pad guild-banner" aria-label="Guild">
        <GuildCrest />
        <div className="stack gap-8 flex-fill">
          <div className="row gap-8">
            {g.ruleset && <Link className="tag" to={`/leaderboards?view=guilds&ruleset=${g.ruleset.id}`}>{g.ruleset.name}</Link>}
            {g.faction && <span className="tag">{g.faction}</span>}
            <span className="tag">US</span>
          </div>
          <h1 className="h1 guild-name">{g.name}{data.badges?.verified && <VerifiedMark />}</h1>
          <span className="t2">
            {c.roster === null ? 'Roster not fetched yet' : <><b className="strong-text">{formatNumber(c.roster)}</b> member{c.roster === 1 ? '' : 's'} on Blizzard’s roster</>}
            {' · '}<b className="strong-text">{formatNumber(c.tracked)}</b> tracked on Everstats
          </span>
          {c.roster !== null && (c.underTen > 0 || c.notTracked > 0) && (
            <span className="muted xsmall">
              Not listed here: {[c.underTen > 0 ? `${formatNumber(c.underTen)} under level 10 (Blizzard serves no profile below 10)` : null, c.notTracked > 0 ? `${formatNumber(c.notTracked)} not tracked yet (not fetched yet, or kept private by their player)` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          <div className="row gap-14 small">
            {g.createdAt && <span className="t2">Created in game {formatDate(g.createdAt)}</span>}
            <Fresh at={g.rosterFetchedAt} prefix="Roster as of " never="Roster never fetched" />
            <ShareButton to={`/g/${encodeURIComponent(g.slug)}/share`} label="Share guild card" />
            {/* 0.9.1: follow this guild on your dashboard ("Your guilds"). */}
            <PinGuildButton guildId={g.id} />
          </div>
        </div>
      </section>

      {c.roster === null && (
        <EmptyState kind="nodata" title="Blizzard’s roster hasn’t been fetched yet">
          <span>Everstats knows this guild from {c.tracked === 1 ? 'one member’s' : 'its members’'} profile{c.tracked === 1 ? '' : 's'}. Its roster is read once a day; the member counts fill in when it is.</span>
        </EmptyState>
      )}

      {/* 0.9.0: pull every member in now (reads the roster first and says what it will cost). */}
      <GuildFetch slug={g.slug} onDone={onReload} />


      {/* 0.7.0: the guild's own Links area (only when something is set) and, for its Guild Master and officers only,
          the Manage guild panel. */}
      <GuildBadgeArea data={data.badges} guild={g} canManage={canManage} />
      {data.badges?.automatic && <NoGuildMaster guild={g} />}
      <GuildLinksArea links={data.links} slug={g.slug} />
      <ManageGuild slug={g.slug} onSaved={onReload} />

      <GuildTiers data={data} />
      <Totals data={data} />

      <div className="split">
        <Roster data={data} />
        <Placements data={data} />
      </div>

      <TopMembers data={data} />
    </div>
  );
}

/**
 * 0.7.1: the call to action at the top for signed-out visitors (what the Copy sign-up link leads to). The link itself is
 * just the guild page: no parameter, no referral id. Signing in brings them back here.
 */
function SignUpCall({ guild }) {
  // 0.8.0: the same note as character pages (chrome/SignInNudge.jsx), now dismissible.
  return (
    <SignInNudge id="guild" icon="guild" returnTo={`/g/${encodeURIComponent(guild.slug)}`}>
      Sign in with Battle.net to add your characters to <b>{guild.name}</b>. Every guildie who signs in is tracked and moves the guild toward its next badge.
    </SignInNudge>
  );
}

/** guild-no-gm: nobody on Everstats owns the rank-0 character, so the badges show automatically and nobody can edit. */
function NoGuildMaster({ guild }) {
  // 0.9.2: signed in, Sign in is no help: say who can manage the page (the Guild Master's Battle.net account; officers
  // are added by the Guild Master once they have).
  const session = useSession();
  if (session.signedIn) {
    return (
      <div className="note small" role="note">
        <Icon name="info" />
        <span className="flex-fill">Only the Guild Master’s Battle.net account can manage {guild.name}’s page (and then add officers). If that’s one of your accounts, sign in with it, or link it in Settings. Until then its badges are shown automatically.</span>
      </div>
    );
  }
  return (
    <div className="note small" role="note">
      <Icon name="info" />
      <span className="flex-fill">Is this your guild? Sign in with the Guild Master’s Battle.net account to manage {guild.name}’s page and choose which badges it shows. Until then they’re shown automatically.</span>
      <Link className="btn sm ghost" to="/sign-in">Sign in</Link>
    </div>
  );
}

/** The guild's tracked members by overall letter (0.6.0). Unranked members are counted, with how to read it. */
function GuildTiers({ data }) {
  const t = data.tiers;
  if (!t || data.counts.tracked === 0) return null;
  const rs = data.guild.ruleset;
  return (
    <section className="panel pad-20 stack gap-10 guild-tiers" aria-label="Members by tier">
      {t.graded ? (
        <>
          <TierDistribution letters={t.letters} unrankedWhy={<Link to="/tiers/how#unranked-h">why</Link>} />
          <span className="muted xsmall">Tracked members by overall tier on {rs?.name}{t.gradedAt ? `, graded ${timeAgo(t.gradedAt)}` : ''}. The bar shows ranked members only; each unranked member’s page says which minimum they’re below. <Link to="/tiers/how">How tiers work</Link></span>
        </>
      ) : (
        <>
          <span className="eyebrow">Members by tier</span>
          <span className="t2 small">{rs?.name ?? 'This ruleset'} isn’t graded yet: tiers open once it has enough tier-eligible characters. <Link to="/tiers/how">How tiers work</Link></span>
        </>
      )}
    </section>
  );
}

function Totals({ data }) {
  const t = data.totals;
  return (
    <section className="stack gap-12" aria-labelledby="totals-h">
      <div className="row gap-12"><h2 className="h2" id="totals-h">Guild totals</h2><span className="muted xsmall">Current tracked members only</span></div>
      <div className="grid-auto col-sm gap-14">
        <div className="panel statcard"><span className="eyebrow">Members tracked</span><span className="big">{formatNumber(data.counts.tracked)}</span>{data.counts.roster !== null && <span className="muted xsmall">of {formatNumber(data.counts.roster)} on the roster</span>}</div>
        {t.cards.map((card) => (
          <div key={card.id} className="panel statcard">
            <span className="eyebrow">{card.name}</span>
            {t.built ? (
              <>
                <span className="big">{formatNumber(card.total)}</span>
                <span className="muted xsmall">{data.counts.tracked ? `${formatNumber(Math.round(card.average * 10) / 10)} per member` : 'No tracked members'}</span>
              </>
            ) : <span className="muted small">Being added up: totals are computed within a few minutes of a member being fetched.</span>}
          </div>
        ))}
      </div>
      {t.built && <span className="muted xsmall">Totals as of {timeAgo(t.computedAt)}, from each member’s latest fetch. A member who leaves takes their numbers with them.</span>}
    </section>
  );
}

const LETTER_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const COLUMNS = [
  { id: 'name', label: 'Member', get: (m) => `${m.name} ${m.surname}`.toLowerCase() },
  { id: 'tier', label: 'Tier', get: (m) => LETTER_ORDER[m.tier] ?? 9 },
  { id: 'level', label: 'Level', get: (m) => m.level ?? -1, desc: true },
  { id: 'class', label: 'Class', get: (m) => m.class ?? '' },
  { id: 'race', label: 'Race', lo: true, get: (m) => m.race ?? '' },
  { id: 'rank', label: 'Guild rank', get: (m) => (m.rank ?? 999) },
  // 0.7.0: who claimed the character on Everstats, with their one inline badge (never on leaderboards).
  { id: 'claimed', label: 'Claimed by', get: (m) => m.claimedBy?.username ?? '~' },
  { id: 'seen', label: 'Last seen in game', lo: true, get: (m) => (m.lastLoginAt ? Date.parse(m.lastLoginAt) : 0), desc: true },
];

function Roster({ data }) {
  const [sort, setSort] = useState({ id: 'rank', desc: false });
  const [cls, setCls] = useState('all');
  const classes = useMemo(() => [...new Set(data.roster.map((m) => m.class).filter(Boolean))].sort(), [data.roster]);
  const rows = useMemo(() => {
    const col = COLUMNS.find((x) => x.id === sort.id);
    const list = data.roster.filter((m) => cls === 'all' || m.class === cls);
    return [...list].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      const d = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      return (sort.desc ? -d : d) || `${a.name} ${a.surname}`.localeCompare(`${b.name} ${b.surname}`);
    });
  }, [data.roster, sort, cls]);
  const by = (id) => setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: Boolean(COLUMNS.find((x) => x.id === id).desc) }));
  return (
    <section className="main stack gap-12" aria-labelledby="roster-h">
      <div className="row gap-12">
        <h2 className="h2" id="roster-h">Roster</h2>
        <span className="muted xsmall">{formatNumber(rows.length)} tracked member{rows.length === 1 ? '' : 's'}{cls === 'all' ? '' : ` · ${cls}`}</span>
      </div>
      {classes.length > 1 && (
        <Segmented label="Filter by class" options={[{ id: 'all', label: 'All classes' }, ...classes.map((x) => ({ id: x, label: x }))]} value={cls} onChange={setCls} />
      )}
      {data.roster.length === 0 ? (
        <EmptyState kind="nodata" title="No tracked members yet">
          <span>Everstats tracks a member once Blizzard serves their profile (level 10 and up) and they’ve been fetched. Rosters are read daily, so members appear over the next day.</span>
        </EmptyState>
      ) : (
        <div className="panel tblbox guild-roster">
          <table className="tbl">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.id} scope="col" aria-sort={sort.id === col.id ? (sort.desc ? 'descending' : 'ascending') : undefined} className={[col.id === 'seen' ? 'r' : null, col.lo ? 'lo' : null].filter(Boolean).join(' ') || undefined}>
                    <button type="button" onClick={() => by(col.id)}>
                      {col.label}{sort.id === col.id && <Icon name={sort.desc ? 'chevron-down' : 'chevron-up'} size="sm" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.slug}>
                  <td>
                    <Link to={`/c/${encodeURIComponent(m.slug)}`}>{m.name} <span className="surname">{m.surname}</span></Link>
                    {/* 0.10.4: what the folded columns held, when the card is too narrow for them. */}
                    <span className="dm muted xsmall">{[m.race, m.lastLoginAt ? `seen ${timeAgo(m.lastLoginAt)}` : null].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td><TierLink slug={m.slug} letter={m.tier} /></td>
                  <td>{m.level ?? '—'}</td>
                  <td className="t2">{m.class ?? '—'}</td>
                  <td className="t2 lo">{m.race ?? '—'}</td>
                  <td className="t2">{m.rankName ?? <span className="muted">not on the last roster</span>}</td>
                  <td>{m.claimedBy ? <NameWithBadge username={m.claimedBy.username} badge={m.claimedBy.badge} /> : <span className="muted">—</span>}</td>
                  <td className="r t2 lo">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'not reported'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Provenance source="Blizzard’s guild roster (ranks) and each member’s profile, refreshed daily" fetchedAt={data.guild.rosterFetchedAt} />
    </section>
  );
}

/** "Not ranked yet": the guild-board version of Unranked (the colourless "–" shield + a progress line). */
export function GuildNotRanked({ minMembers, tracked, compact = true }) {
  return (
    <div className={`state state-unranked${compact ? ' compact' : ''}`} role="status">
      <TierBadge letter={null} size="md" />
      <div className="stack gap-8 state-body">
        <span className="state-kind">Not ranked yet</span>
        <strong className="state-title">Needs {formatNumber(minMembers)} tracked members</strong>
        <div className="stack gap-6">
          <div className="bar warn"><span className="bar-fill" style={{ width: `${Math.min(100, (tracked / minMembers) * 100)}%` }} /></div>
          <span className="muted xsmall">{formatNumber(tracked)} of {formatNumber(minMembers)} tracked · guild boards compare guilds only once a few members count</span>
        </div>
      </div>
    </div>
  );
}

function Placements({ data }) {
  const rs = data.guild.ruleset;
  return (
    <aside className="side stack gap-12" aria-labelledby="placements-h">
      <h2 className="h2" id="placements-h">On the guild boards</h2>
      {!data.ranked ? (
        <GuildNotRanked minMembers={data.minMembers} tracked={data.counts.tracked} />
      ) : !data.placements ? (
        <EmptyState kind="nodata" compact title="Being added up"><span>Placements appear within a few minutes.</span></EmptyState>
      ) : data.placements.length === 0 ? (
        data.placementsHeld > 0 ? (
          <EmptyState kind="nodata" compact title="No board has enough guilds yet">
            <span>A board is listed here once {formatNumber(data.minBoardGuilds)} guilds are ranked on it, because “#1 of 1” says nothing. This guild is ranked on {formatNumber(data.placementsHeld)} board{data.placementsHeld === 1 ? '' : 's'} that {data.placementsHeld === 1 ? 'hasn’t' : 'haven’t'} got there yet.</span>
          </EmptyState>
        ) : (
          <EmptyState kind="nodata" compact title="Not on any board yet"><span>None of its tracked members has any of a statistic yet, and a zero isn’t ranked.</span></EmptyState>
        )
      ) : (
        <div className="panel clip">
          {data.placements.map((p) => (
            <Link key={p.statisticId} className="placement" to={`/leaderboards/guilds/${rs.id}/${p.statisticId}${p.mode === 'average' ? '?mode=average' : ''}`}>
              <span className={`rk${p.rank <= 3 ? ` r${p.rank}` : ''} placement-rank`}>#{formatNumber(p.rank)}</span>
              <span className="small strong-text">{displayName(p.name)}</span>
              <span className="muted xsmall">{p.mode === 'average' ? 'by average per member' : 'by total'} · of {formatNumber(p.of)} guild{p.of === 1 ? '' : 's'} · {formatNumber(Math.round(p.value * 10) / 10)}</span>
            </Link>
          ))}
        </div>
      )}
      {rs && <span className="muted xsmall">Guilds on {rs.name}, overall, ranked by the totals (or averages) of their current tracked members. <Link to={`/leaderboards?view=guilds&ruleset=${rs.id}`}>All guild boards</Link></span>}
    </aside>
  );
}

/**
 * 0.8.0: each category is a full-width section, collapsed when the page opens (a refresh collapses them again: nothing
 * is remembered). A header opens or closes its own section only; "See all" links sit inside, so they navigate without
 * toggling anything. A collapsed header says how many statistics it holds and the guild's best guild-board placement
 * in that category (the same boards and rule as "On the guild boards").
 */
function bestLine(best) {
  if (!best) return 'not placed on a guild board here yet';
  return `best: #${formatNumber(best.rank)} of ${formatNumber(best.of)} in ${best.name}${best.mode === 'average' ? ' (by average)' : ''}`;
}

function TopMembers({ data }) {
  const slug = data.guild.slug;
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const [params, setParams] = useSearchParams();
  const asked = params.get('period');
  const period = KNOWN.includes(asked) ? asked : 'overall';
  const [top, setTop] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setTop(null);
    setError(null);
    api(`/api/guilds/${encodeURIComponent(slug)}/top?period=${period}`).then((d) => { if (live) setTop(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [slug, period]);
  const days = top?.periods?.rolling?.days;
  const q = period === 'overall' ? '' : `?period=${period}`;
  return (
    <section className="stack gap-18" aria-labelledby="top-h">
      <div className="row gap-16">
        <h2 className="h1 stats-title" id="top-h">Top members</h2>
        <Segmented label="Period" options={PERIODS(days)} value={period} onChange={(id) => setParams(id === 'overall' ? {} : { period: id }, { replace: true, preventScrollReset: true })} />
      </div>
      <p className="t2 small">Every statistic, the guild’s own top five{period === 'overall' ? '' : ' by what they gained'}. Ties share a rank, and a value of 0 isn’t ranked. Open a category to see its statistics.</p>
      {error && <ServiceUnavailable inline title="Couldn't load the top members">{error}</ServiceUnavailable>}
      {!top && !error && <span className="t2 small" role="status">Loading…</span>}
      {top?.collecting && (
        <EmptyState kind="collecting" title={period === 'week' ? 'Opens after the first full week' : `Opens once there are ${days} days of snapshots`}>
          <span>Period boards rank what members gained, so they wait until daily snapshots cover the whole period. This opens {top.periods[period].opensAt ? formatDate(top.periods[period].opensAt) : 'once snapshots start'}.</span>
        </EmptyState>
      )}
      {top && !top.collecting && (
        <div className="stack gap-8">
          {top.categories.map((cat) => {
            const isOpen = open.has(cat.key);
            const summary = [`${formatNumber(cat.statistics.length)} statistic${cat.statistics.length === 1 ? '' : 's'}`, data.ranked ? bestLine(data.bestByCategory?.[cat.key]) : null].filter(Boolean).join(' · ');
            return (
            <div key={cat.key} className="panel clip" id={`top-${cat.key}`}>
              <div className={`cathead cat-toggle${isOpen ? '' : ' is-collapsed'}`}>
                <button type="button" className="cat-toggle-btn" aria-expanded={isOpen} aria-controls={`top-body-${cat.key}`} onClick={() => toggle(cat.key)}>
                  <span className="title"><h3>{cat.label}</h3><span className="muted xsmall">{summary}</span></span>
                  <span className="spacer" />
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                </button>
              </div>
              {isOpen && (
              <div id={`top-body-${cat.key}`} className="grid-auto col-md guild-top-grid">
              {cat.statistics.map((s) => (
                <div key={s.id} className="guild-top">
                  <div className="row gap-8 guild-top-head">
                    <b className="small flex-fill ellipsis" title={displayName(s.name)}>{displayName(s.name)}</b>
                    {s.withAny > 0 && <Link className="xsmall nowrap" to={`/g/${encodeURIComponent(slug)}/boards/${s.id}${q}`}>See all {formatNumber(s.withAny)} →</Link>}
                  </div>
                  {s.top.length === 0 ? (
                    <span className="muted xsmall">Nobody tracked here has any{period === 'overall' ? '' : ' gained'} yet: a value of 0 isn’t ranked.</span>
                  ) : s.top.map((m) => (
                    <span key={m.slug} className="ln">
                      <span className={`rk${m.rank <= 3 ? ` r${m.rank}` : ''}`}>{m.rank}</span>
                      <Link className="ellipsis" to={`/c/${encodeURIComponent(m.slug)}`}>{m.name} <span className="surname">{m.surname}</span></Link>
                      <span className="strong">{m.text ? <span className="muted xsmall">{m.text} · </span> : null}{formatNumber(m.value)}</span>
                    </span>
                  ))}
                </div>
              ))}
              </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      {top && !top.collecting && top.categories.length === 0 && <EmptyState kind="nodata" title="No statistics tracked yet"><span>The statistics appear once Everstats has fetched a character.</span></EmptyState>}
    </section>
  );
}

/** The design's original generic crest (design/v1/assets/illustrations/guild-crest-placeholder.svg). */
export function GuildCrest() {
  return (
    <svg viewBox="0 0 96 110" className="crest" role="img" aria-label="Guild crest (no crest art is available)">
      <path d="M48 3 L92 15 L92 66 L48 107 L4 66 L4 15 Z" className="crest-shield" />
      <path d="M48 14 L82 23 L82 62 L48 95 L14 62 L14 23 Z" className="crest-inner" />
      <path d="M48 32 C56 42 58 50 48 66 C38 50 40 42 48 32 Z" className="crest-flame" />
      <rect x="40" y="66" width="16" height="6" rx="1" className="crest-base" />
    </svg>
  );
}

