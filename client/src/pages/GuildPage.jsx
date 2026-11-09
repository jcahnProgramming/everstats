import { useParams } from 'react-router-dom';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';

/**
 * A guild (design/v1/pages/guild): banner with the crest, roster with each member's tier, best placements.
 * Not built: the banner keeps the design's original placeholder crest (Blizzard's API has no crest art) and the
 * address as it came; roster and placements say they're coming. No sample members, counts or tier bar.
 */
export function GuildPage() {
  const { slug } = useParams();
  return (
    <div className="wrap page-pad stack gap-32">
      <section className="sheet row gap-24 sheet-pad guild-banner" aria-label="Guild">
        <GuildCrest />
        <div className="stack gap-8 grow">
          <span className="eyebrow">Guild · US</span>
          <h1 className="h1 guild-name">{slug}</h1>
          <span className="t2 small">Ruleset, faction and member counts appear once guild pages are on.</span>
        </div>
      </section>

      <div className="split">
        <section className="main panel pad-20 stack gap-14" aria-labelledby="roster-h">
          <h2 className="h3" id="roster-h">Roster</h2>
          <EmptyState kind="soon" title="Guild pages are coming soon">
            <span>Each tracked member with their tier, level, class and best category. Guild rosters are also how Everstats finds new characters to track.</span>
          </EmptyState>
          <Provenance />
        </section>
        <section className="side panel pad-20 stack gap-14" aria-labelledby="boards-h">
          <h2 className="h3" id="boards-h">On the boards</h2>
          <EmptyState kind="soon" compact title="The guild's best placements, top 100 only" />
        </section>
      </div>
    </div>
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
