/**
 * Admin → Activity (0.7.1): COUNTS of a few kinds of event per UTC hour (activity_counts). Nothing else is stored: no
 * IP address, no user agent, no visitor or session id, no page path, no third-party analytics. A kind and a number.
 *
 * Bots: a request from a network the look-up limiter is already refusing (it made 30 look-ups in 15 minutes) is treated
 * as automated and not counted. Anything below that limit is counted, so the panel says counts may include some bots.
 *
 * Counted from 0.7.1's deploy (pipeline_facts 'activity_counting_since'); before that the numbers are unknown and the
 * panel says so, never 0.
 */
/** kind → the long description. ACTIVITY_LABELS: the short name the panel shows. */
export const ACTIVITY_LABELS = Object.freeze({
  'character.search': 'Search box (characters)',
  'character.lookup': 'Character pages that asked Blizzard',
  'character.signin': 'Looked up at sign-in',
  'guild.search': 'Guilds opened from a search',
  'search.page': 'Search page',
  'guild.view': 'Guild page views',
  'guild.lookup': 'Guild pages that asked Blizzard',
});
export const ACTIVITY_KINDS = Object.freeze({
  'character.search': 'Character searches from the search box or the home page (the character page they opened)',
  'character.lookup': 'Character pages opened directly that asked Blizzard for a fresh copy',
  'character.signin': 'Characters looked up because their owner signed in with Battle.net',
  'guild.search': 'Guilds opened from a guild search (the /guilds search box or a search suggestion)',
  'search.page': 'Name searches on the search page (characters and guilds)',
  'guild.view': 'Guild page views',
  'guild.lookup': 'Guild pages that asked Blizzard (a guild Everstats hadn’t fetched yet)',
});

/** A network the look-up limiter is refusing right now: treated as automated, not counted. */
export const looksAutomated = (limits, network) => !limits.lookups.check(network).ok;

/** Adds `n` to this hour's count for `kind`. Never throws and never delays the request it counts. */
export function countActivity(db, kind, n = 1) {
  if (!ACTIVITY_KINDS[kind] || !(n > 0)) return;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  db.query(
    'INSERT INTO activity_counts (hour, kind, n) VALUES ($1, $2, $3) ON CONFLICT (hour, kind) DO UPDATE SET n = activity_counts.n + EXCLUDED.n',
    [hour, kind, n],
  ).catch(() => {});
}
