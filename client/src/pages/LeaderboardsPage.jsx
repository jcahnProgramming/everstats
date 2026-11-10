import { displayName } from '../../../server/stats/names.js';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from '../scope.jsx';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState, UnrankedNote } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { Segmented } from '../components/Controls.jsx';
import { RulesetSwitcher } from '../components/Stats.jsx';
import { GoldBoardsSection } from './GoldBoardPage.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { useCoverage } from '../useCoverage.js';

/**
 * Leaderboards index (design/v1/pages/leaderboards-index): pick a ruleset, browse every board by category, each
 * with its top three.
 *
 * Rulesets come from Blizzard (GET /api/leaderboards), never from this file. The chosen ruleset lives in the address
 * (?ruleset=…). Different from the mockup: no statistic search box and no remembered ruleset yet; category jump tags
 * link to the sections below.
 *
 * 0.5.0: a Characters | Guilds switch (?view=guilds). The Guilds view lists the same boards with each one's top three
 * GUILDS by the total of their current tracked members (GET /api/guild-boards), keeping the ruleset and categories.
 *
 * 0.8.0: the CATEGORY sections collapse (the board cards inside them don't), all collapsed when the page opens, each on
 * its own; nothing is remembered, so a refresh collapses them again. A category chip, or an address ending in
 * #category (the character page's "All boards"), opens that category and scrolls to it. A collapsed header says how
 * many boards it holds and which board has the most characters (or ranked guilds) on it.
 */
const busiest = (cat, guilds) => {
  const n = (b) => (guilds ? b.ranked : b.nonzero) ?? 0;
  const top = cat.boards.reduce((best, b) => (n(b) > n(best ?? { ranked: -1, nonzero: -1 }) ? b : best), null);
  if (!top || n(top) === 0) return guilds ? 'no ranked guild has any yet' : 'nobody tracked has any yet';
  return guilds ? `busiest: ${top.name} (${formatNumber(n(top))} guild${n(top) === 1 ? '' : 's'})` : `busiest: ${top.name} (${formatNumber(n(top))} with any)`;
};
export function LeaderboardsPage() {
  const { coverage } = useCoverage();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const asked = params.get('ruleset');
  const view = params.get('view') === 'guilds' ? 'guilds' : 'characters';
  // 0.11.1: a one-pool version's realm-type filter (?realmType=RP). Characters only; the server checks the value.
  const realmType = view === 'characters' ? params.get('realmType') : null;

  useEffect(() => {
    let live = true;
    setError(null);
    setData(null);
    const path = view === 'guilds' ? '/api/guild-boards' : '/api/leaderboards';
    const q = new URLSearchParams();
    if (asked) q.set('ruleset', asked);
    if (realmType) q.set('realmType', realmType);
    api(`${path}${q.size ? `?${q}` : ''}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [asked, view, realmType]);
  const go = (next) => {
    const q = { view, ruleset: rs?.id ? String(rs.id) : asked, realmType, ...next };
    setParams(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'view' && v === 'characters'))));
  };

  const [open, setOpen] = useState(() => new Set());
  const [scrollTo, setScrollTo] = useState(null);
  const toggle = (key) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const reveal = useCallback((key) => {
    setOpen((o) => new Set(o).add(key));
    setScrollTo(key);
  }, []);
  // A category anchor (#combat) opens that category and scrolls to it once the boards are drawn.
  useEffect(() => {
    if (!data || !window.location.hash) return;
    const key = decodeURIComponent(window.location.hash.slice(1));
    if (data.categories?.some((c) => c.key === key)) reveal(key);
  }, [data, reveal]);
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(scrollTo)?.scrollIntoView({ block: 'start' });
    document.getElementById(`h-${scrollTo}`)?.focus({ preventScroll: true });
    setScrollTo(null);
  }, [scrollTo, open]);

  const rs = data?.ruleset ?? null;
  const guilds = view === 'guilds';
  // 0.11.1: what the server says about the version this page is in (one pool per region, account-wide collections).
  const sc = data?.scope ?? null;
  const filter = data?.filter?.realmType ?? null;
  const filterName = filter ? data.realmTypes?.find((t) => t.key === filter)?.name ?? filter : null;
  const where = filterName ? `${filterName} realms` : rs?.name;
  return (
    <div className="wrap page-pad stack gap-32">
      <div className="stack gap-18">
        <div className="row gap-12"><h1 className="h1">Leaderboards</h1><span className="tag gold">Beta</span></div>
        <p className="lead">{sc?.onePool
          ? `Every ${sc.name} statistic gets its own leaderboard across every realm of the region`
          : 'Every statistic gets its own leaderboard on each ruleset'}, for characters and for guilds: overall, this week{data?.periods?.rolling?.days ? ` and the last ${data.periods.rolling.days} days` : ' and over recent days'}.</p>
        <div className="row gap-12">
          <Segmented label="Rank" large options={[{ id: 'characters', label: 'Characters' }, { id: 'guilds', label: 'Guilds' }]} value={view} onChange={(id) => go({ view: id })} />
          <Link className="btn ghost sm" to={`/tiers${rs?.id ? `?ruleset=${rs.id}` : ''}`}>Tier boards</Link>
        </div>
        {error && <ServiceUnavailable inline title="Couldn't load the leaderboards">{error}</ServiceUnavailable>}
        {data && data.rulesets.length > 0 && (
          <div className="row gap-16">
            <RulesetSwitcher rulesets={data.rulesets} value={rs?.id} onChange={(id) => go({ ruleset: String(id) })} large />
            {guilds
              ? <span className="t2 small"><b className="strong-text">{formatNumber(data.rankedGuilds ?? 0)}</b> guilds ranked on {rs?.name} ({formatNumber(data.minMembers)}+ tracked members) · totals of current members</span>
              : <span className="t2 small"><b className="strong-text">{formatNumber(data.population)}</b> tracked characters on {where} · refreshed daily</span>}
          </div>
        )}
        {/* 0.11.1: realm type is a FILTER on a one-pool version (everyone still shares one pool and one set of tiers). */}
        {!guilds && data?.realmTypes?.length > 1 && (
          <div className="row gap-12">
            <Segmented label="Realm type" options={[{ id: '', label: 'All realms' }, ...data.realmTypes.map((t) => ({ id: t.key, label: `${t.name} realms` }))]} value={filter ?? ''} onChange={(id) => go({ realmType: id || null })} />
            {filter && <span className="muted small">Ranks and counts below are among characters on {filterName} realms only. Tiers are always graded across all realms.</span>}
          </div>
        )}
        {sc && !sc.primary && data && !guilds && (
          <p className="muted small">{sc.name}: Everstats tracks {formatNumber(data.tracked ?? 0)} character{data.tracked === 1 ? '' : 's'} so far. A character joins when someone looks it up, signs in with it, or opens its guild.</p>
        )}
        <p className="muted small">Beta: boards are filling up as players join. Every search and every sign-in adds characters.</p>
        {data && rs && data.categories.length > 0 && (
          <nav className="row gap-8" aria-label="Categories">
            {data.categories.map((c) => (
              <a
                key={c.key}
                className="tag"
                href={`#${c.key}`}
                onClick={(e) => {
                  e.preventDefault();
                  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${c.key}`);
                  reveal(c.key);
                }}
              >
                {c.label} · {c.boards.length}
              </a>
            ))}
          </nav>
        )}
      </div>

      {data && data.rulesets.length === 0 && (
        <EmptyState kind="nodata" title="No rulesets yet">
          <span>Rulesets come from the game's own list and from the characters Everstats tracks. None has been read yet: look a character up and its ruleset appears here.</span>
        </EmptyState>
      )}
      {data && rs && data.categories.length === 0 && (
        <EmptyState kind="nodata" title="No statistics tracked yet">
          <span>The boards appear as soon as Everstats has fetched a character's statistics. Look someone up to start.</span>
        </EmptyState>
      )}

      {data && rs && data.categories.length > 0 && (
        <div className="stack gap-8">
          {data.categories.map((cat) => {
            const isOpen = open.has(cat.key);
            return (
              <section key={cat.key} id={cat.key} className={`stack gap-14 lb-cat${isOpen ? ' is-open' : ''}`} aria-labelledby={`h-${cat.key}`}>
                <h2 className="lb-cat-h">
                  <button type="button" id={`h-${cat.key}`} className="orn lb-cat-btn" aria-expanded={isOpen} aria-controls={`boards-${cat.key}`} onClick={() => toggle(cat.key)}>
                    <span className="gem" />
                    <span className="lb-cat-title">
                      <span className="h2 h2-panel">{cat.label}</span>
                      <span className="muted xsmall">{formatNumber(cat.boards.length)} board{cat.boards.length === 1 ? '' : 's'} · {!cat.tierCounted ? 'not graded' : cat.inOverall ? `${cat.tierCounted} graded` : 'own category letter, not in the overall tier'} · {busiest(cat, guilds)}</span>
                    </span>
                    <span className="rule" />
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                  </button>
                </h2>
                {isOpen && sc?.accountWide && cat.extra === 'gold' && (
                  <p className="note small" role="note"><Icon name="info" /><span>Account-wide on {sc.short}: collections belong to the whole Battle.net account there, so a player’s alts share these numbers, and characters with the same number share a rank.</span></p>
                )}
                {isOpen && (
                  <div id={`boards-${cat.key}`} className="grid-auto col-md gap-14">
                    {cat.boards.map((b) => (guilds ? <MiniGuildBoard key={b.id} board={b} ruleset={rs} minMembers={data.minMembers} /> : <MiniBoard key={b.id} board={b} ruleset={rs} population={data.population} filter={filter} />))}
                  </div>
                )}
                {isOpen && !guilds && cat.unlisted > 0 && (
                  <p className="muted xsmall">{formatNumber(cat.unlisted)} more board{cat.unlisted === 1 ? '' : 's'} for a single faction, instance or slot {cat.unlisted === 1 ? 'isn’t' : 'aren’t'} listed here until {formatNumber(data.minIndexEntries)} characters are ranked on {cat.unlisted === 1 ? 'it' : 'each'}. They exist all the same: a character’s page links to every board it is on.</p>
                )}
                {isOpen && cat.extra === 'gold' && !guilds && rs && <GoldBoardsSection ruleset={rs.id} />}
              </section>
            );
          })}
        </div>
      )}

      {guilds && data && rs && data.categories.length > 0 && data.rankedGuilds === 0 && (
        <EmptyState kind="nodata" title={`No guild on ${rs.name} has ${data.minMembers} tracked members yet`}>
          <span>A guild is ranked once {data.minMembers} of its members are tracked. {formatNumber(data.guildsWithMembers ?? 0)} guild{data.guildsWithMembers === 1 ? ' has' : 's have'} at least one so far.</span>
        </EmptyState>
      )}


      <section className="panel pad-24 stack gap-16" aria-labelledby="grading-h">
        <h2 className="h2 h2-panel" id="grading-h">Tiers</h2>
        <p className="t2 small">Each ruleset is graded on its own, from approved statistics only, once it has {coverage ? formatNumber(coverage.minPopulation) : 'enough'} tier-eligible characters. <Link to={`/tiers${rs?.id ? `?ruleset=${rs.id}` : ''}`}>Tier boards</Link> · <Link to="/tiers/how">How tiers work</Link></p>
        {coverage && <TierLegend shares={coverage.tierShares} minPopulation={coverage.minPopulation} />}
        {coverage && data?.population !== undefined && data.population < coverage.minPopulation && <UnrankedNote minPopulation={coverage.minPopulation} tracked={data?.population ?? null} ruleset={rs?.name ?? null} />}
      </section>
    </div>
  );
}

/** 0.10.4: a board where everyone with any is tied. Instead of one line over empty rows (stretched to its neighbours'
 *  height), the card shows the value they share, large, and how many share it. The value is the board's own. */
function TiedLine({ n, value, who }) {
  return (
    <span className="mini-tied">
      {value !== null && value !== undefined && <span className="mini-tied-v">{formatNumber(value)}</span>}
      <span className="t2 small">All {formatNumber(n)} {who} are tied{value !== null && value !== undefined ? ' at this' : ''}</span>
    </span>
  );
}

function MiniBoard({ board: b, ruleset, population, filter = null }) {
  const to = `/leaderboards/${ruleset.id}/${b.id}${filter ? `?realmType=${encodeURIComponent(filter)}` : ''}`;
  return (
    <Link className={`panel mini${b.tied ? ' is-tied' : ''}`} to={to}>
      <span className="hd"><b className="mini-title" title={displayName(b.name)}>{displayName(b.name)}</b><span className="muted xsmall nowrap">{formatNumber(b.nonzero)} with any</span></span>
      {b.nonzero === 0 ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">Nobody tracked has any yet ({formatNumber(population)} tracked)</span><span /></span>
      ) : b.tied ? (
        <TiedLine n={b.nonzero} value={b.tiedValue} who="with any" />
      ) : b.top.map((r) => (
        <span key={r.slug ?? r.name} className="ln">
          <span className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{r.rank}</span>
          <span className="ellipsis">{r.name} <span className="surname">{r.surname}</span></span>
          <span className="strong">{r.text ? <span className="muted xsmall">{r.text} · </span> : null}{formatNumber(r.value)}</span>
        </span>
      ))}
      <span className="ft">Full board →</span>
    </Link>
  );
}

function MiniGuildBoard({ board: b, ruleset, minMembers }) {
  const to = `/leaderboards/guilds/${ruleset.id}/${b.id}`;
  return (
    <Link className={`panel mini${b.tied ? ' is-tied' : ''}`} to={to}>
      <span className="hd"><b className="mini-title" title={displayName(b.name)}>{displayName(b.name)}</b><span className="muted xsmall nowrap">{formatNumber(b.ranked)} guild{b.ranked === 1 ? '' : 's'}</span></span>
      {b.ranked === 0 ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">{b.notYet ? `${formatNumber(b.notYet)} not ranked yet (under ${minMembers} members)` : 'No ranked guild has any yet'}</span><span /></span>
      ) : b.tied ? (
        <TiedLine n={b.ranked} value={b.tiedValue} who="ranked guilds" />
      ) : b.top.map((r) => (
        <span key={r.slug} className="ln">
          <span className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{r.rank}</span>
          <span className="ellipsis">{r.name}</span>
          <span className="strong">{formatNumber(r.value)}</span>
        </span>
      ))}
      <span className="ft">Full board →</span>
    </Link>
  );
}
