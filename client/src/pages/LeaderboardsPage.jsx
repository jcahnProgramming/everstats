import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState, UnrankedNote } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
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
 */
export function LeaderboardsPage() {
  const { coverage } = useCoverage();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const asked = params.get('ruleset');

  useEffect(() => {
    let live = true;
    setError(null);
    api(`/api/leaderboards${asked ? `?ruleset=${encodeURIComponent(asked)}` : ''}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [asked]);

  // A category anchor (#combat) scrolls once the boards are drawn.
  useEffect(() => {
    if (!data || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [data]);

  const rs = data?.ruleset ?? null;
  return (
    <div className="wrap page-pad stack gap-32">
      <div className="stack gap-18">
        <div className="row gap-12"><h1 className="h1">Leaderboards</h1><span className="tag gold">Beta</span></div>
        <p className="lead">Every statistic gets its own leaderboard on each ruleset: overall, this week and this month.</p>
        {error && <ServiceUnavailable inline title="Couldn't load the leaderboards">{error}</ServiceUnavailable>}
        {data && data.rulesets.length > 0 && (
          <div className="row gap-16">
            <RulesetSwitcher rulesets={data.rulesets} value={rs?.id} onChange={(id) => setParams({ ruleset: String(id) })} large />
            <span className="t2 small"><b className="strong-text">{formatNumber(data.population)}</b> tracked characters on {rs?.name} · refreshed daily</span>
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
            {cat.boards.map((b) => <MiniBoard key={b.id} board={b} ruleset={rs} population={data.population} />)}
          </div>
        </section>
      ))}

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
      <span className="hd"><b className="ellipsis">{b.name}</b><span className="muted xsmall nowrap">{formatNumber(b.nonzero)} above 0</span></span>
      {b.tied ? (
        <span className="ln mini-note"><span /><span className="muted xsmall">Everyone's tied so far ({formatNumber(population)} tracked)</span><span /></span>
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
