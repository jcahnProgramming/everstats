import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parseSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { EmptyState, Fresh, Provenance, UnrankedNote } from '../components/EmptyState.jsx';
import { CharacterLoading, CharacterNotFound, ServiceUnavailable } from '../components/States.jsx';
import { RenderFrame } from '../components/Stats.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { useCoverage } from '../useCoverage.js';

/**
 * The character page (design/v1/pages/character): the gilt character sheet, category tiers, progress chart and the
 * statistics. Look-ups aren't built, so the page asks the real endpoint (GET /api/characters/:slug, rate limited
 * like the real look-up will be), shows the design's loading state while it waits, and then keeps the sheet's frame
 * with an honest "Coming soon" where each kind of data will go. No sample gear, stats, tiers or chart.
 *
 * States wired here (design/v1/states): loading (while the request runs), character-not-found (status not_found,
 * once look-ups exist), api-unavailable (the request failing). render-not-ready lives in <RenderFrame pending>.
 */
export function CharacterPage() {
  const { slug } = useParams();
  const parsed = parseSlug(slug);
  const [result, setResult] = useState(null); // null = waiting · { status } · { error }

  const load = useCallback(async () => {
    if (!parsed) return;
    setResult(null);
    try {
      setResult(await api(`/api/characters/${encodeURIComponent(parsed.slug)}`));
    } catch (err) {
      setResult({ error: err });
    }
  }, [parsed?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  if (!parsed) {
    return (
      <div className="wrap page-pad stack gap-24">
        <h1 className="h1">That isn't a character address</h1>
        <EmptyState kind="nocoverage" title="Characters are looked up by name and surname">
          <span>A character's address is <span className="mono">/c/name-surname</span>, and this one doesn't have that shape. Use the search at the top of the page, or <Link to="/">the one on the home page</Link>.</span>
        </EmptyState>
      </div>
    );
  }

  let body;
  if (result === null) {
    body = <CharacterLoading name={parsed.name} surname={parsed.surname} />;
  } else if (result.error) {
    const e = result.error;
    body = e.status === 429 ? (
      <ServiceUnavailable title="Too many look-ups from your network" onRetry={load} detail="Look-ups are limited to 30 every 15 minutes per network.">
        Wait a few minutes and try again.
      </ServiceUnavailable>
    ) : (
      <ServiceUnavailable title="Can't reach Everstats" onRetry={load}>
        {e.message}
      </ServiceUnavailable>
    );
  } else if (result.status === 'not_found') {
    body = <CharacterNotFound name={parsed.name} surname={parsed.surname}><Link className="btn gold align-start" to="/">Search again</Link></CharacterNotFound>;
  } else {
    body = <NotBuiltSheet parsed={parsed} />;
  }
  return <div className="wrap page-pad stack gap-40">{body}</div>;
}

function NotBuiltSheet({ parsed }) {
  const { coverage } = useCoverage();
  return (
    <>
      <section className="sheet stack gap-24 sheet-pad" aria-label="Character sheet">
        <div className="row gap-24 sheet-top">
          <div className="stack gap-10 char-ident">
            <h1 className="h-display char-name">{parsed.name} <span className="surname">{parsed.surname}</span></h1>
            <span className="t2 char-line">Level, race, class and guild appear once look-ups are on.</span>
            <div className="row gap-14"><Fresh at={null} never="Never looked up: Everstats can't fetch characters yet" /></div>
          </div>
          <div className="row gap-18 char-tier">
            <div className="stack gap-4 char-tier-text">
              <span className="eyebrow">Overall tier</span>
              <span className="h3">No grade yet</span>
              <a className="xsmall" href="#how-graded">How it's graded</a>
            </div>
            <span className="tier lg blank" role="img" aria-label="No tier yet"><b aria-hidden="true" /></span>
          </div>
        </div>
        <div className="grid-auto col-lg gap-20 sheet-body">
          <RenderFrame>
            <span className="h3">No portrait yet</span>
            <span className="muted xsmall">The full-body render comes from Blizzard with the character, with its own freshness: it can lag the profile by hours.</span>
          </RenderFrame>
          <div className="stack gap-16">
            <EmptyState kind="soon" title="Character pages are coming soon">
              <span>Everstats can't look characters up yet, so there's nothing here about {parsed.name} {parsed.surname}, not even whether they exist.</span>
              <span>When it can, this sheet shows their gear slot by slot, their core stats, and their overall tier.</span>
            </EmptyState>
            <Provenance />
          </div>
        </div>
      </section>

      <section className="stack gap-16" aria-labelledby="cats-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="cats-h">Category tiers</h2><span className="rule" /></div>
        <EmptyState kind="soon" compact title="A letter for each statistic category">
          <span>The categories come from the game's own statistics list, and each gets its own letter. Deaths and similar statistics get leaderboards but never count towards a tier.</span>
        </EmptyState>
      </section>

      <section className="panel chart" aria-labelledby="progress-h">
        <div className="row gap-16"><h2 className="h2" id="progress-h">Progress</h2></div>
        <EmptyState kind="soon" compact title="Charts from the daily snapshots">
          <span>Every tracked character gets a snapshot a day, kept forever, so each statistic will have a line to follow.</span>
        </EmptyState>
      </section>

      <section id="stats" className="stack gap-18" aria-labelledby="stats-h">
        <div className="row gap-16"><h2 className="h1 stats-title" id="stats-h">Statistics</h2></div>
        <EmptyState kind="soon" title="Every in-game statistic, each with its own leaderboard">
          <span>Grouped by the game's categories, with this character's value, their rank on that statistic's board, and how fresh it is.</span>
        </EmptyState>
      </section>

      <section id="how-graded" className="panel pad-24 stack gap-16" aria-labelledby="how-h">
        <h2 className="h2" id="how-h">How tiers are graded</h2>
        <p className="t2">One letter per character, by percentile within their own ruleset only. Statistics roll up into category letters, and categories into the overall tier.</p>
        <TierLegend />
        {coverage && <UnrankedNote minPopulation={coverage.minPopulation} tracked={coverage.trackedCharacters} compact />}
      </section>
    </>
  );
}
