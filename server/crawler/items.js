import { BLIZZARD_API } from '../core/config.js';
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
 */
export const ICON_TTL_DAYS = 30;
const MAX_ITEMS_PER_ITEM = 30;

/** Item ids on this character with no icon row, or one older than the TTL. */
export async function itemsNeedingMedia(q, characterId) {
  const ch = await q.one('SELECT equipment FROM characters WHERE id = $1', [characterId]);
  const ids = [...new Set((ch?.equipment ?? []).map((i) => i.itemId).filter(Number.isSafeInteger))];
  if (!ids.length) return [];
  const fresh = await q.query(
    `SELECT item_id FROM item_media WHERE item_id = ANY($1::bigint[]) AND fetched_at > now() - ($2 || ' days')::interval`,
    [ids, String(ICON_TTL_DAYS)],
  );
  const have = new Set(fresh.map((r) => r.item_id));
  return ids.filter((id) => !have.has(id));
}

/** Queues the character's missing icons at `priority`, if any are missing. → number missing. */
export async function queueItemMedia(q, characterId, priority) {
  const missing = await itemsNeedingMedia(q, characterId);
  if (missing.length) await enqueue(q, { kind: 'items', key: `items:${characterId}`, priority, mode: 'full' });
  return missing.length;
}

/** The 'items' work item: fetch each missing icon. Blizzard's own media link on the item, else the documented path. */
export async function fetchItemMedia({ db, client }, item) {
  const characterId = Number(String(item.key).replace(/^items:/, ''));
  if (!Number.isSafeInteger(characterId)) return 'bad key';
  const missing = await itemsNeedingMedia(db, characterId);
  const equipment = (await db.one('SELECT equipment FROM characters WHERE id = $1', [characterId]))?.equipment ?? [];
  let ok = 0;
  for (const id of missing.slice(0, MAX_ITEMS_PER_ITEM)) {
    const href = equipment.find((e) => e.itemId === id)?.mediaHref ?? `/data/wow/media/item/${id}`;
    const ns = (() => {
      try {
        return new URL(href, BLIZZARD_API.apiHost).searchParams.get('namespace');
      } catch {
        return null;
      }
    })();
    const r = await client.request('item-media', href, { priority: item.priority, namespace: ns ?? BLIZZARD_API.namespaces.static });
    // 429 / 5xx / no answer: leave it for the next fetch (the client's back-off has already recorded it).
    if (r.status === null || r.status === 429 || r.status >= 500) continue;
    const icon = r.status === 200 ? parseItemMedia(r.json) : null;
    await db.query(
      `INSERT INTO item_media (item_id, state, icon_url, fetched_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (item_id) DO UPDATE SET state = EXCLUDED.state, icon_url = EXCLUDED.icon_url, fetched_at = now()`,
      [id, icon ? 'ok' : r.status === 404 ? 'missing' : 'failed', icon],
    );
    if (icon) ok += 1;
  }
  return `icons: ${ok} of ${missing.length}`;
}
