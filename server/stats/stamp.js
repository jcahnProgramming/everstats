/**
 * Writing a character's statistic rows only when something changed (0.11.1).
 *
 * Until 0.11.1 every full fetch rewrote every one of the character's rows, changed or not, because each upsert set
 * fetched_at = now(): about ten million row versions a day on production, each one a new entry in all three indexes.
 * Nothing was bloated, but the visibility map was always stale, so every "index-only" rank count visited the heap for
 * a third of its entries.
 *
 * A row is now written when its VALUE (or its text, Blizzard date, realm category or hidden flag) differs, or when its
 * stamp is more than RESTAMP_DAYS old.
 *
 * Why the stamp still has to move: the retention sweep deletes character_statistics rows by fetched_at (Blizzard's
 * 30-day rule, retention/registry.js). fetched_at therefore means "Blizzard confirmed this row no later than…", and it
 * may UNDERSTATE the truth by up to RESTAMP_DAYS, never overstate it: nothing is kept longer than before. A row is
 * confirmed by every full fetch of its character (at least every FULL_REFRESH_DAYS, crawler/fetch.js, as long as the
 * daily refresh keeps up), so in normal running no live row's stamp passes about two weeks. If fetching STOPS
 * altogether, the sweep can start deleting rows RESTAMP_DAYS early: from keep-days − RESTAMP_DAYS (22 days at the
 * default) instead of keep-days (29). Safe for Blizzard's rule; the Data retention page says so.
 *
 * Sweeping by the character's own fetch time instead was considered and refused: a row's source can stop being fetched
 * while its character is still fetched daily (collections switched off, a feed that stopped answering, a character
 * with no collections fetch), and such a row must still age out on its own.
 */
export const RESTAMP_DAYS = 7;

/**
 * The WHERE of `ON CONFLICT (character_id, statistic_id) DO UPDATE` for a value Everstats derives (a feed field, a
 * collection count): write when it changed or its stamp is RESTAMP_DAYS older than this fetch.
 */
export const WRITE_IF_CHANGED = `WHERE (character_statistics.value, character_statistics.ruleset_id, character_statistics.hidden)
         IS DISTINCT FROM (EXCLUDED.value, EXCLUDED.ruleset_id, EXCLUDED.hidden)
      OR character_statistics.fetched_at < EXCLUDED.fetched_at - interval '${RESTAMP_DAYS} days'`;

/** The same for Blizzard's own statistics (text and Blizzard's date too; the upsert there never touches hidden). */
export const WRITE_IF_CHANGED_BLIZZARD = `WHERE (character_statistics.value, character_statistics.text, character_statistics.blizzard_updated_at, character_statistics.ruleset_id)
         IS DISTINCT FROM (EXCLUDED.value, EXCLUDED.text, EXCLUDED.blizzard_updated_at, EXCLUDED.ruleset_id)
      OR character_statistics.fetched_at < EXCLUDED.fetched_at - interval '${RESTAMP_DAYS} days'`;

/** A character's current values: Map(statisticId → value). Read before and after a fetch's writes to see what moved. */
export async function valuesOf(q, characterId) {
  const rows = await q.query('SELECT statistic_id, value FROM character_statistics WHERE character_id = $1 LIMIT 10000', [characterId]);
  return new Map(rows.map((r) => [Number(r.statistic_id), r.value]));
}

/** The statistics whose value differs between two readings (changed, appeared or gone). → Set of ids */
export function changedIds(before, after) {
  const out = new Set();
  for (const [id, v] of after) if (before.get(id) !== v) out.add(id);
  for (const id of before.keys()) if (!after.has(id)) out.add(id);
  return out;
}
