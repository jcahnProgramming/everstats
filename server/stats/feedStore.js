import { FEED_PREFIX, feedById, numericFields } from './feeds.js';

/**
 * Rule A7 in production (0.10.0): a feed response's numbers → the character's statistic values, one derived statistic
 * per field (stats/feeds.js), so each is a board like any other (per version via the statistic, per region and realm
 * category via the character's ruleset_id). Ids are allocated the first time any character has a value above zero
 * (collections/store.js ensureDerivedId, per game version), so a board exists only for what Blizzard really returns.
 * Names are built from Blizzard's own names and age out with the window like Blizzard's.
 *
 * Feeds already boarded elsewhere are not written twice: the PvP summary's fields are collections/registry.js FAMILIES
 * 'pvp' boards ("Honorable kills (PvP summary)") since 0.9.1, the same feed and field, so the same board.
 */
export const COVERED_ELSEWHERE = Object.freeze({ 'pvp-summary': 'collections family pvp (0.9.1)' });
const MAX_PER_FEED = 400;

/** Writes one feed's values for a character. `json` null (Blizzard didn't answer) leaves its old values. → fields written */
export async function storeFeedValues(q, characterId, feedId, json, { fetchedAt = new Date() } = {}) {
  if (!json || !feedById.has(feedId) || COVERED_ELSEWHERE[feedId]) return 0;
  const ch = await q.one('SELECT ruleset_id, hidden, game_version FROM characters WHERE id = $1', [characterId]);
  if (!ch || ch.ruleset_id === null) return 0;
  const { ensureDerivedId } = await import('../collections/store.js');
  const { fields } = numericFields(feedId, json);
  const keep = [];
  for (const f of fields.filter((x) => x.value > 0).slice(0, MAX_PER_FEED)) {
    const id = await ensureDerivedId(q, { key: f.key, name: f.name, version: ch.game_version, category: f.group });
    await q.query(
      `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, hidden, value, text, blizzard_updated_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
       ON CONFLICT (character_id, statistic_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, hidden = EXCLUDED.hidden, value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at`,
      [characterId, id, ch.ruleset_id, ch.hidden, f.value, fetchedAt],
    );
    keep.push(id);
  }
  // A field this feed no longer sends (or now zero: zero has no row) leaves the character's boards.
  await q.query(
    `DELETE FROM character_statistics cs USING statistics s
      WHERE cs.character_id = $1 AND s.id = cs.statistic_id AND s.derived LIKE $2 AND NOT (cs.statistic_id = ANY($3::bigint[]))`,
    [characterId, `${FEED_PREFIX}${feedId}:%`, keep],
  );
  return keep.length;
}
