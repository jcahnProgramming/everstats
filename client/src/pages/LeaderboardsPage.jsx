import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState, UnrankedNote } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { Segmented } from '../components/Controls.jsx';
import { RulesetSwitcher } from '../components/Stats.jsx';
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
 */
export function LeaderboardsPage() {
  const { coverage } = useCoverage();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const asked = params.get('ruleset');
  const view = params.get('view') === 'guilds' ? 'guilds' : 'characters';

  useEffect(() => {
    let live = true;
    setError(null);
    setData(null);
    const path = view === 'guilds' ? '/api/guild-boards' : '/api/leaderboards';
    api(`${path}${asked ? `?ruleset=${encodeURIComponent(asked)}` : ''}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [asked, view]);
  const go = (next) => {
    const q = { view, ruleset: rs?.id ? String(rs.id) : asked, ...next };
    setParams(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'view' && v === 'characters'))));
  };

  // A category anchor (#combat) scrolls once the boards are drawn.
  useEffect(() => {
    if (!data || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [data]);

  const rs = data?.ruleset ?? null;
  const guilds = view === 'guilds';
  return (
    <div className="wrap page-pad stack gap-32">
      <div className="stack gap-18">
        <div className="row gap-12"><h1 className="h1">Leaderboards</h1><span className="tag gold">Beta</span></div>
        <p className="lead">Every statistic gets its own leaderboard on each ruleset, for characters and for guilds: overall, this week{data?.periods?.rolling?.days ? ` and the last ${data.periods.rolling.days} days` : ' and over recent days'}.</p>
        <Segmented label="Rank" large options={[{ id: 'characters', label: 'Characters' }, { id: 'guilds', label: 'Guilds' }]} value={view} onChange={(id) => go({ view: id })} />
        {error && <ServiceUnavailable inline title="Couldn't load the leaderboards">{error}</ServiceUnavailable>}
        {data && data.rulesets.length > 0 && (
          <div className="row gap-16">
            <RulesetSwitcher rulesets={data.rulesets} value={rs?.id} onChange={(id) => go({ ruleset: String(id) })} large />
            {guilds
              ? <span className="t2 small"><b className="strong-text">{formatNumber(data.rankedGuilds ?? 0)}</b> guilds ranked on {rs?.name} ({formatNumber(data.minMembers)}+ tracked members) · totals of current members</span>
              : <span className="t2 small"><b className="strong-text">{formatNumber(data.population)}</b> tracked characters on {rs?.name} · refreshed daily</span>}
          </div>
        )}
        <p className="muted small">Beta: boards are filling up as players join. Every search and every sign-in adds characters.</p>
        {data && rs && data.categories.length > 0 && (
          <nav className="row gap-8" aria-label="Categories">
            {data.categories.map((c) => <a key={c.key} className="tag" href={`#${c.key}`}>{c.label} · {c.boards.length}</a>)}
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

      {data && rs && data.categories.map((cat) => (
        <section key={cat.key} id={cat.key} className="stack gap-14" aria-labelledby={`h-${cat.key}`}>
          <div className="orn"><span className="gem" /><h2 className="h2 h2-panel" id={`h-${cat.key}`}>{cat.label}</h2><span className="muted xsmall">{cat.boards.length} boards · {!cat.graded ? 'not graded' : cat.farmable ? 'own tier only' : 'graded'}</span><span className="rule" /></div>
          <div className="grid-auto col-md gap-14">
            {cat.boards.map((b) => (guilds ? <MiniGuildBoard key={b.id} board={b} ruleset={rs} minMembers={data.minMembers} /> : <MiniBoard key={b.id} board={b} ruleset={rs} population={data.population} />))}
          </div>
        </section>
      ))}

      {guilds && data && rs && data.categories.length > 0 && data.rankedGuilds === 0 && (
        <EmptyState kind="nodata" title={`No guild on ${rs.name} has ${data.minMembers} tracked members yet`}>
          <span>A guild is ranked once {data.minMembers} of its members are tracked. {formatNumber(data.guildsWithMembers ?? 0)} guild{data.guildsWithMembers === 1 ? ' has' : 's have'} at least one so far.</span>
        </EmptyState>
      )}

      <section className="panel pad-24 stack gap-16" aria-labelledby="grading-h">
        <h2 className="h2 h2-panel" id="grading-h">Grading</h2>
        <p className="t2 small">Tiers are the next build. When they arrive, each ruleset is graded on its own, once it has enough tracked characters.</p>
        <TierLegend />
        {coverage && <UnrankedNote minPopulation={coverage.minPopulation} tracked={data?.population ?? null} ruleset={rs?.name ?? null} />}
      </section>
    </div>
  );
}

function MiniBoard({ board: b, ruleset, population }) {
  const to = `/leaderboards/${ruleset.id}/${b.id}`;
  return (
    <Link className="panel mini" to={to}>
      <span className="hd"><b className="ellipsis">{b.name}</b><span className="muted xsmall nowrap">{formatNumber(b.nonzero)} with any</span></span>
      {b.nonzero === 0 ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">Nobody tracked has any yet ({formatNumber(population)} tracked)</span><span /></span>
      ) : b.tied ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">All {formatNumber(b.nonzero)} with any are tied</span><span /></span>
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
    <Link className="panel mini" to={to}>
      <span className="hd"><b className="ellipsis">{b.name}</b><span className="muted xsmall nowrap">{formatNumber(b.ranked)} guild{b.ranked === 1 ? '' : 's'}</span></span>
      {b.ranked === 0 ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">{b.notYet ? `${formatNumber(b.notYet)} not ranked yet (under ${minMembers} members)` : 'No ranked guild has any yet'}</span><span /></span>
      ) : b.tied ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">All {formatNumber(b.ranked)} ranked guilds are tied</span><span /></span>
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
