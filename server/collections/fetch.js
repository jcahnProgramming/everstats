import { BLIZZARD_API, config } from '../core/config.js';
import { PRIORITY, enqueue } from '../crawler/queue.js';
import { RetryableError, characterPath, MIN_TRACKED_LEVEL } from '../crawler/fetch.js';
import { updateGains } from '../crawler/store.js';
import { catalogTotals, recordStaticNamespace } from './catalog.js';
import { staticNamespaceIn } from './parse.js';
import { KINDS } from './registry.js';
import { deriveCounts, detectSharing, storeCollection } from './store.js';

/**
 * A character's collections (0.9.0): one crawl item (kind 'collections', key = the slug) asks every collection endpoint
 * the registry lists for it (collections/registry.js KINDS: 13 for most characters, +1 for hunters), in parallel through
 * the crawler's shared budget, at the priority it was queued with:
 *   PRIORITY.lookup   someone opened the Collections tab on data older than a day, or pressed Refresh
 *   PRIORITY.auto     a Battle.net sign-in or "Refresh my characters"
 *   PRIORITY.daily    weekly, as part of the full fetch (COLLECTIONS_EVERY_DAYS)
 * Collections refresh less often than statistics: a full fetch only queues them when they're older than a week.
 *
 * Each kind is stored on its own: what Blizzard returned is saved; what it didn't keeps its last good copy, marked
 * "not returned" with the status. Then the counts become statistics, gains are rebuilt, and the owner's account-wide
 * detection runs again. If Blizzard returned nothing at all (every endpoint throttled or down), the item is retried.
 */
export const COLLECTIONS_EVERY_DAYS = 7;
export const COLLECTIONS_STALE_MS = 24 * 60 * 60 * 1000; // the Collections tab refreshes data older than this

export async function queueCollections(q, slug, priority) {
  if (!slug) return null;
  return enqueue(q, { kind: 'collections', key: String(slug), priority, mode: 'full' });
}

/** After a full fetch: collections too, when they're older than a week (or never fetched). */
export async function maybeQueueCollections(db, characterId, slug, priority) {
  const row = await db.one('SELECT collections_fetched_at, level FROM characters WHERE id = $1', [characterId]);
  if (!row || (row.level ?? 0) < MIN_TRACKED_LEVEL) return false;
  // 0.9.2: the WEEKLY refresh, for characters that have collections. A first fetch is the backfill's (collections/
  // backfill.js, capped per day) or a person's (lookup, sign-in, the Collections tab): queued here behind every daily
  // check, first fetches sat at the back of the queue and the boards stayed empty for a day.
  if (!row.collections_fetched_at) return false;
  const due = Date.now() - new Date(row.collections_fetched_at).getTime() > COLLECTIONS_EVERY_DAYS * 86_400_000;
  if (!due) return false;
  // A lookup's full fetch doesn't make anyone wait for collections: they go in behind it, at daily priority, and the
  // Collections tab raises them to lookup priority if someone opens it.
  await queueCollections(db, slug, priority === PRIORITY.lookup ? PRIORITY.daily : priority);
  return true;
}

const retryable = (r) => r.status === null || r.status === 429 || r.status >= 500;

export async function fetchCollections({ db, client }, item) {
  const slug = String(item.key);
  const ch = await db.one("SELECT id, slug, class, level, owner_account_id, profile_state FROM characters WHERE slug = $1", [slug]);
  if (!ch || ch.profile_state !== 'ok') return 'not tracked (no profile yet)';
  if ((ch.level ?? 0) < MIN_TRACKED_LEVEL) return `below level ${MIN_TRACKED_LEVEL}`;
  const totals = await catalogTotals(db);
  const kinds = KINDS.filter((k) => !k.when || k.when({ character: ch, catalogTotals: totals }));
  const base = characterPath(slug);
  const answers = await Promise.all(kinds.map((k) => client.request(`collections-${k.id}`, `${base}${k.path}`, { priority: item.priority, namespace: BLIZZARD_API.namespaces.profile })));

  if (answers.every(retryable) && item.priority !== PRIORITY.lookup) throw new RetryableError('collections: Blizzard didn’t answer', 'blizzard');
  let bytes = 0;
  let returned = 0;
  let ns = null;
  await db.tx(async (q) => {
    for (const [i, k] of kinds.entries()) {
      const r = answers[i];
      bytes += r.bytes ?? 0;
      if (r.status === 200 && r.json) {
        ns = ns ?? staticNamespaceIn(r.json, config.region);
        const data = k.parse(r.json);
        await storeCollection(q, ch.id, k.id, { state: k.isEmpty(data) ? 'empty' : 'ok', status: 200, data });
        returned += 1;
      } else if (r.status === 404 && k.notFoundIsEmpty) {
        await storeCollection(q, ch.id, k.id, { state: 'empty', status: 404, data: k.parse({}) });
        returned += 1;
      } else {
        await storeCollection(q, ch.id, k.id, { state: 'not_returned', status: r.status });
      }
    }
    await q.query('UPDATE characters SET collections_fetched_at = now(), collections_first_at = coalesce(collections_first_at, now()) WHERE id = $1', [ch.id]);
    await deriveCounts(q, ch.id);
    await updateGains(q, ch.id);
    if (ch.owner_account_id) await detectSharing(q, ch.owner_account_id);
  });
  if (ns) await recordStaticNamespace(db, ns);
  // 0.9.2: once the appearance catalog is complete, any collected appearance it doesn't list is looked up on its own.
  if ((await catalogTotals(db)).appearance > 0) {
    const { unresolvedAppearances } = await import('./catalog.js');
    if ((await unresolvedAppearances(db, ch.id)).length) await enqueue(db, { kind: 'catalog', key: `catalog:appearance:ids:${ch.id}`, priority: PRIORITY.roster });
  }
  return `collections: ${returned} of ${kinds.length} returned, ${Math.round(bytes / 1024)} KB`;
}
