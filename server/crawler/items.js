import { blizzardContext } from '../core/gameVersions.js';
import { parseItemMedia } from './parse.js';
import { enqueue } from './queue.js';

/**
 * Item icons (0.4.1). One row per item id in item_media, shared by every character: an icon is fetched once, by the
 * first character seen wearing the item, then reused. Blizzard's API terms (Developer API Terms of Use, section 2:
 * "a maximum 30-day TTL ... for all Data") mean a row older than ICON_TTL_DAYS is fetched again the next time a
 * character wearing it is fetched. The image itself is never stored: the page shows it from Blizzard's render host.
 *
 * Icons never hold up a character: after a character is stored, its missing icons are queued as one 'items' work
 * item ("items" + character id) at the SAME priority as whatever fetched the character, through the shared budget.
 * The page shows each slot's frame, name and tooltip at once, and the icon when it lands.
 *
 * 0.10.0: icons are per game version and region (item_media's key): an item id names a different item on another
 * version. The namespace is the one Blizzard's own media link names, else the static namespace a collections fetch
 * detected for that version and region; never a written one. With neither, the icon waits (the "?" art shows).
 */
export const ICON_TTL_DAYS = 30;
const MAX_ITEMS_PER_ITEM = 60; // worn items and their transmogs (0.8.0)

/** Every item id whose icon a character's gear can show: what is worn, and (0.8.0) each slot's transmog item. */
export const gearItemIds = (equipment) => [...new Set((equipment ?? []).flatMap((i) => [i.itemId, i.transmog?.itemId]).filter(Number.isSafeInteger))];

/** Item ids on this character with no icon row, or one older than the TTL. */
export async function itemsNeedingMedia(q, characterId) {
  const ch = await q.one('SELECT equipment, game_version, region FROM characters WHERE id = $1', [characterId]);
  const ids = gearItemIds(ch?.equipment);
  if (!ids.length) return [];
  const fresh = await q.query(
    `SELECT item_id FROM item_media WHERE game_version = $3 AND region = $4 AND item_id = ANY($1::bigint[]) AND fetched_at > now() - ($2 || ' days')::interval`,
    [ids, String(ICON_TTL_DAYS), ch.game_version, ch.region],
  );
  const have = new Set(fresh.map((r) => r.item_id));
  return ids.filter((id) => !have.has(id));
}

/** Queues the character's missing icons at `priority`, if any are missing. → number missing. */
export async function queueItemMedia(q, characterId, priority) {
  const missing = await itemsNeedingMedia(q, characterId);
  if (!missing.length) return 0;
  const ch = await q.one('SELECT game_version, region FROM characters WHERE id = $1', [characterId]);
  await enqueue(q, { kind: 'items', key: `items:${characterId}`, priority, mode: 'full', version: ch.game_version, region: ch.region });
  return missing.length;
}

/** The 'items' work item: fetch each missing icon. Blizzard's own media link on the item, else the documented path. */
export async function fetchItemMedia({ db, client }, item) {
  const characterId = Number(String(item.key).replace(/^items:/, ''));
  if (!Number.isSafeInteger(characterId)) return 'bad key';
  const missing = await itemsNeedingMedia(db, characterId);
  const ch = await db.one('SELECT equipment, game_version, region FROM characters WHERE id = $1', [characterId]);
  if (!ch) return 'no such character';
  const equipment = ch.equipment ?? [];
  const ctx = blizzardContext(ch.game_version, ch.region);
  const { staticNamespace } = await import('../collections/catalog.js');
  const detected = await staticNamespace(db, { version: ch.game_version, region: ch.region });
  let ok = 0;
  let waiting = 0;
  for (const id of missing.slice(0, MAX_ITEMS_PER_ITEM)) {
    // A transmog item has no media link of its own in the equipment response: the documented path.
    const href = equipment.find((e) => e.itemId === id)?.mediaHref ?? `/data/wow/media/item/${id}`;
    const ns = (() => {
      try {
        return new URL(href, ctx.apiHost).searchParams.get('namespace');
      } catch {
        return null;
      }
    })();
    const namespace = ns ?? detected;
    if (!namespace) {
      waiting += 1;
      continue;
    }
    const r = await client.request('item-media', href, { priority: item.priority, namespace, version: ch.game_version, region: ch.region });
    // 429 / 5xx / no answer: leave it for the next fetch (the client's back-off has already recorded it).
    if (r.status === null || r.status === 429 || r.status >= 500) continue;
    const icon = r.status === 200 ? parseItemMedia(r.json) : null;
    await db.query(
      `INSERT INTO item_media (item_id, state, icon_url, fetched_at, game_version, region) VALUES ($1, $2, $3, now(), $4, $5)
       ON CONFLICT (game_version, region, item_id) DO UPDATE SET state = EXCLUDED.state, icon_url = EXCLUDED.icon_url, fetched_at = now()`,
      [id, icon ? 'ok' : r.status === 404 ? 'missing' : 'failed', icon, ch.game_version, ch.region],
    );
    if (icon) ok += 1;
  }
  return `icons: ${ok} of ${missing.length}${waiting ? ` (${waiting} waiting for a static namespace)` : ''}`;
}
