import { Link, useParams } from 'react-router-dom';
import { parseSlug } from '../../../server/stats/slug.js';
import { EmptyState, Provenance, UnrankedNote } from '../components/EmptyState.jsx';
import { TierBadge, TierLegend } from '../components/Tier.jsx';
import { useCoverage } from '../useCoverage.js';
import './pages.css';

// The character page's layout, with nothing in it: lookups aren't built. Every section shows where its data will
// go and where its provenance line will sit, never a sample value.
export function CharacterPage() {
  const { slug } = useParams();
  const parsed = parseSlug(slug);
  const { coverage } = useCoverage();

  if (!parsed) {
    return (
      <>
        <div className="page-head"><h1>That isn't a character</h1></div>
        <EmptyState kind="nocoverage" title="Characters are looked up by name and surname">
          <span>This address doesn't have the shape name-surname. <Link to="/">Search from the home page</Link>.</span>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow smallcaps">Character · US</p>
        <h1 className="char-name">{parsed.name} <span className="muted">{parsed.surname}</span></h1>
      </div>

      <EmptyState kind="soon" title="Character pages are coming soon">
        <span>Everstats can't look characters up yet, so there's nothing about {parsed.name} {parsed.surname} here. Not even whether they exist.</span>
      </EmptyState>

      <div className="char-top">
        <section className="panel" aria-labelledby="hero-h">
          <div className="panel-head"><h2 id="hero-h">Appearance</h2></div>
          <div className="placeholder-frame hero-render">The character's render will appear here. Blizzard's render can lag hours behind the profile, so it gets its own freshness line.</div>
          <Provenance />
        </section>

        <section className="panel" aria-labelledby="tier-h">
          <div className="panel-head"><h2 id="tier-h">Overall tier</h2></div>
          <div className="row">
            <TierBadge letter={null} large label="No tier yet" />
            <p className="muted">One letter, rolled up from the category letters below, graded against characters on the same ruleset only.</p>
          </div>
          <Provenance />
        </section>
      </div>

      <div className="grid-2">
        <section className="panel" aria-labelledby="gear-h">
          <div className="panel-head"><h2 id="gear-h">Gear</h2></div>
          <div className="placeholder-frame">Equipped items, slot by slot.</div>
          <Provenance />
        </section>
        <section className="panel" aria-labelledby="core-h">
          <div className="panel-head"><h2 id="core-h">Core stats</h2></div>
          <div className="placeholder-frame">Level, health, primary and secondary stats.</div>
          <Provenance />
        </section>
      </div>

      <section className="panel" aria-labelledby="stats-h">
        <div className="panel-head">
          <h2 id="stats-h">Statistics</h2>
          <span className="faint">Grouped by category, each with its own letter</span>
        </div>
        <EmptyState kind="soon" title="Statistic categories come from the game itself">
          <span>The categories and statistics will be read from Blizzard's statistics list once lookups are on. Deaths and similar statistics get leaderboards but never count towards a tier.</span>
        </EmptyState>
        <Provenance />
      </section>

      <section className="panel" aria-labelledby="progress-h">
        <div className="panel-head"><h2 id="progress-h">Progress</h2></div>
        <div className="placeholder-frame chart-frame">Charts of each statistic over time, from the daily snapshots Everstats keeps forever.</div>
        <Provenance />
      </section>

      <section className="panel" aria-labelledby="how-h">
        <div className="panel-head"><h2 id="how-h">How tiers work</h2></div>
        <TierLegend />
        {coverage && <UnrankedNote minPopulation={coverage.minPopulation} />}
      </section>
    </>
  );
}
