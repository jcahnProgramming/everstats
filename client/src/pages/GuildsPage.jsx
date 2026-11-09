import { EmptyState } from '../components/EmptyState.jsx';
import { GuildCrest } from './GuildPage.jsx';

/**
 * /guilds: where the design's "Guilds" nav link goes. The design has no guild index page (only a single guild), so
 * this is the honest landing: guild search and guild rankings aren't built yet.
 */
export function GuildsPage() {
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-20">
        <GuildCrest />
        <div className="stack gap-8 grow">
          <h1 className="h1">Guilds</h1>
          <p className="lead">Every guild's roster with each member's tier, and guilds ranked on the leaderboards.</p>
        </div>
      </div>
      <EmptyState kind="soon" title="Guild pages are coming soon">
        <span>You'll be able to find a guild by name here. Guilds also appear on each character's page once look-ups are on.</span>
      </EmptyState>
    </div>
  );
}
