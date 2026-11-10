import { PRIORITY, enqueue } from '../crawler/queue.js';
import { RetryableError, MIN_TRACKED_LEVEL, crawlKey, itemScope, parseCrawlKey } from '../crawler/fetch.js';
import { updateGains } from '../crawler/store.js';
import { catalogTotals, recordStaticNamespace } from './catalog.js';
import { staticNamespaceIn } from './parse.js';
import { KINDS } from './registry.js';
import { storeFeedValues } from '../stats/feedStore.js';

/** 0.10.0 rule A7: the collections responses that are also feeds (stats/feeds.js FEEDS ids). */
const FEED_OF_KIND = Object.freeze({
  reputations: 'reputations', professions: 'professions', achievements: 'achievements', pets: 'collections-pets', 'hunter-pets': 'hunter-pets', pvp: 'pvp-summary',
});
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

/**
 * 0.10.0: `ref` is the character's slug (the primary version's pages) or { slug, realmSlug }; `scope` its version and
 * region (default the primary). The item's key is the character's crawl key in that scope.
 */
export async function queueCollections(q, ref, priority, scope = {}) {
  const r = typeof ref === 'string' || ref === null || ref === undefined ? { slug: ref, realmSlug: null } : ref;
  if (!r.slug) return null;
  return enqueue(q, { kind: 'collections', key: crawlKey(r), priority, mode: 'full', version: scope.version, region: scope.region });
}

/** After a full fetch: collections too, when they're older than a week (or never fetched). */
export async function maybeQueueCollections(db, characterId, slug, priority) {
  const row = await db.one('SELECT collections_fetched_at, level, realm_slug, game_version, region FROM characters WHERE id = $1', [characterId]);
  if (!row || (row.level ?? 0) < MIN_TRACKED_LEVEL) return false;
  // 0.9.2: the WEEKLY refresh, for characters that have collections. A first fetch is the backfill's (collections/
  // backfill.js, capped per day) or a person's (lookup, sign-in, the Collections tab): queued here behind every daily
  // check, first fetches sat at the back of the queue and the boards stayed empty for a day.
  if (!row.collections_fetched_at) return false;
  const due = Date.now() - new Date(row.collections_fetched_at).getTime() > COLLECTIONS_EVERY_DAYS * 86_400_000;
  if (!due) return false;
  // A lookup's full fetch doesn't make anyone wait for collections: they go in behind it, at daily priority, and the
  // Collections tab raises them to lookup priority if someone opens it.
  await queueCollections(db, { slug, realmSlug: row.realm_slug }, priority === PRIORITY.lookup ? PRIORITY.daily : priority, { version: row.game_version, region: row.region });
  return true;
}

const retryable = (r) => r.status === null || r.status === 429 || r.status >= 500;

export async function fetchCollections({ db, client }, item) {
  const { scope, ctx } = itemScope(item);
  const ref = parseCrawlKey(scope.version, item.key);
  const ch = await db.one(
    `SELECT id, slug, realm_slug, class, level, owner_account_id, profile_state FROM characters
      WHERE game_version = $1 AND region = $2 AND coalesce(realm_slug, '') = coalesce($3, '') AND slug = $4`,
    [scope.version, scope.region, ref.realmSlug, ref.slug],
  );
  if (!ch || ch.profile_state !== 'ok') return 'not tracked (no profile yet)';
  if ((ch.level ?? 0) < MIN_TRACKED_LEVEL) return `below level ${MIN_TRACKED_LEVEL}`;
  const totals = await catalogTotals(db);
  const kinds = KINDS.filter((k) => !k.when || k.when({ character: ch, catalogTotals: totals }));
  const base = ctx.characterPath({ realmSlug: ch.realm_slug, slug: ch.slug });
  const answers = await Promise.all(kinds.map((k) => client.request(`collections-${k.id}`, `${base}${k.path}`, { priority: item.priority, namespace: ctx.namespaces.profile, version: scope.version, region: scope.region })));

  if (answers.every(retryable) && item.priority !== PRIORITY.lookup) throw new RetryableError('collections: Blizzard didn’t answer', 'blizzard');
  let bytes = 0;
  let returned = 0;
  let ns = null;
  await db.tx(async (q) => {
    for (const [i, k] of kinds.entries()) {
      const r = answers[i];
      bytes += r.bytes ?? 0;
      if (r.status === 200 && r.json) {
        ns = ns ?? staticNamespaceIn(r.json, scope.region);
        const data = k.parse(r.json);
        await storeCollection(q, ch.id, k.id, { state: k.isEmpty(data) ? 'empty' : 'ok', status: 200, data });
        if (FEED_OF_KIND[k.id]) await storeFeedValues(q, ch.id, FEED_OF_KIND[k.id], r.json); // 0.10.0 rule A7
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
  if (ns) await recordStaticNamespace(db, ns, scope);
  // 0.9.2: once the appearance catalog is complete, any collected appearance it doesn't list is looked up on its own.
  if ((await catalogTotals(db)).appearance > 0) {
    const { unresolvedAppearances } = await import('./catalog.js');
    if ((await unresolvedAppearances(db, ch.id)).length) await enqueue(db, { kind: 'catalog', key: `catalog:appearance:ids:${ch.id}`, priority: PRIORITY.roster, ...scope });
  }
  return `collections: ${returned} of ${kinds.length} returned, ${Math.round(bytes / 1024)} KB`;
}
