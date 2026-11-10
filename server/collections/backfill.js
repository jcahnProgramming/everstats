import { PRIMARY_SCOPE, scopeSql } from '../core/config.js';
import { getSetting } from '../admin/settings.js';
import { PRIORITY, enqueueMany } from '../crawler/queue.js';
import { KINDS } from './registry.js';
import { featureOn } from '../features/registry.js';

/**
 * The gradual first collections fetch (0.9.2). Characters tracked before 0.9.0 have no collections until they're
 * fetched once; after that the weekly refresh keeps them (collections/fetch.js maybeQueueCollections). This job is the
 * ONE way a character's first collections fetch is queued in the background (a lookup, a sign-in or opening the
 * Collections tab still fetch at once). It queues at most `collections.backfillPerDay` characters a UTC day, a batch
 * per tick, at daily priority through the shared budget (behind every person waiting), while `collections.backfill`
 * is on. Never-fetched first, oldest tracked first.
 */
export const BATCH = 200;
// The backfill is the PRIMARY version's, always (named explicitly: never the request's scope). 0.11.1: a version whose
// registry entry says collections.backfill false (World of Warcraft: collections on demand, owner's decision 6) gets no
// backfill at all: its collections are fetched when someone looks a character up, signs in with it or opens its tab.
const TRACKED = `profile_state = 'ok' AND level >= 10 AND stats_fetched_at IS NOT NULL AND missing_since IS NULL AND slug IS NOT NULL AND ${scopeSql('', PRIMARY_SCOPE)}`;

export async function backfillStatus(db) {
  const on = await getSetting(db, 'collections.backfill');
  const perDay = await getSetting(db, 'collections.backfillPerDay');
  const counts = await db.one(`SELECT count(*)::int AS tracked, count(*) FILTER (WHERE collections_fetched_at IS NOT NULL)::int AS done FROM characters WHERE ${TRACKED}`);
  const today = (await db.one("SELECT queued FROM collection_backfill_days WHERE day = (now() AT TIME ZONE 'UTC')::date"))?.queued ?? 0;
  const left = counts.tracked - counts.done;
  // Requests per character: the registry's endpoints (13 for most; hunters ask one more). Arithmetic, said so.
  const perCharacter = KINDS.filter((k) => !k.when).length;
  return {
    on, perDay, queuedToday: today, tracked: counts.tracked, withCollections: counts.done, left,
    requestsLeft: left * perCharacter, perCharacter, daysLeft: perDay > 0 ? Math.ceil(left / perDay) : null,
  };
}

export async function runBackfill(db) {
  if (!(await getSetting(db, 'collections.backfill'))) return 'Off';
  if (await getSetting(db, 'crawler.paused')) return 'Paused with the crawler';
  // 0.10.3: and with Collections (features/registry.js: the backfill needs 'collections' and 'crawl').
  if (!(await featureOn(db, 'collections-backfill'))) return 'Paused: Collections are switched off';
  const perDay = await getSetting(db, 'collections.backfillPerDay');
  const today = (await db.one("SELECT queued FROM collection_backfill_days WHERE day = (now() AT TIME ZONE 'UTC')::date"))?.queued ?? 0;
  const room = Math.min(BATCH, perDay - today);
  if (room <= 0) return `Today's ${perDay} queued; more tomorrow`;
  const rows = await db.query(
    `SELECT c.slug FROM characters c
      WHERE c.profile_state = 'ok' AND c.level >= 10 AND c.stats_fetched_at IS NOT NULL AND c.missing_since IS NULL AND c.slug IS NOT NULL
        AND ${scopeSql('c', PRIMARY_SCOPE)} AND c.collections_fetched_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM crawl_queue q WHERE q.kind = 'collections' AND q.key = c.slug AND ${scopeSql('q', PRIMARY_SCOPE)} AND q.state IN ('queued', 'running'))
      ORDER BY c.tracked_since NULLS LAST, c.id LIMIT $1`,
    [room],
  );
  if (!rows.length) return 'Every tracked character has collections';
  const n = await enqueueMany(db, rows.map((r) => ({ kind: 'collections', key: r.slug, priority: PRIORITY.daily })));
  await db.query(
    `INSERT INTO collection_backfill_days (day, queued) VALUES ((now() AT TIME ZONE 'UTC')::date, $1)
     ON CONFLICT (day) DO UPDATE SET queued = collection_backfill_days.queued + EXCLUDED.queued`,
    [n],
  );
  return `Queued ${n} first collections fetches (${today + n} of ${perDay} today)`;
}
