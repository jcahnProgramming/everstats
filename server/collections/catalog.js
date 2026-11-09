import { PRIORITY, enqueue } from '../crawler/queue.js';
import { RetryableError } from '../crawler/fetch.js';
import { indexOf, mediaAsset, parseAchievementDetail, parseAppearanceDetail, parseItemSearch, renderUrl } from './parse.js';

/**
 * Blizzard's static catalogs (0.9.0): every mount, pet, toy, title, achievement, appearance … that exists, shared by
 * every character (collection_catalog), so pages can show "N / total", missing tiles and completion bars. Fetched ONCE
 * and refreshed every REFRESH_DAYS, well inside the 30-day retention window (Blizzard data: the sweep deletes a row not
 * refreshed for the window). Never per character.
 *
 * The static namespace is the versioned one Blizzard's own links name (crawler-side: the first collections response
 * records it), never a typed-in version; until one is known no catalog is asked for.
 *
 * Each refresh is a chain of short crawl items (kind 'catalog', PRIORITY.roster: the lowest, behind every person and
 * the daily refresh) so none runs for minutes: `catalog:<kind>:index` reads the index (for appearances: the slot index
 * and every slot), then `catalog:<kind>:details:<n>` items each fetch up to DETAIL_CHUNK rows' details (+ their media),
 * until every row is refreshed. collection_catalog_state records requests and bytes per kind (the measured cost).
 *
 * CATALOGS (registry): { kind, label, index: { path, field } | special, detail?: { path(id), parse(json, row) → data },
 *   media?: { path(data), key } }. Probe results (run #4): mount 141, pet 110, toy 13, title 41, achievement 176 (+29
 *   categories), appearance slots 23 (HEAD alone 577), appearance sets 1, heirloom 0 (empty), reputation factions 56.
 *   journal-* indexes are empty on Forever (no "drops from" sources), so there is no sources catalog.
 */
export const REFRESH_DAYS = 14;
export const DETAIL_CHUNK = 30;
const ITEM_SEARCH_MAX_PAGES = 400;

export const CATALOGS = Object.freeze([
  {
    kind: 'mount', label: 'Mounts', index: { path: '/data/wow/mount/index', field: 'mounts' },
    detail: { path: (id) => `/data/wow/mount/${id}`, parse: (j) => ({ displayId: Number.isSafeInteger(j?.creature_displays?.[0]?.id) ? j.creature_displays[0].id : null, factionOnly: j?.faction?.type ?? null }) },
    media: { path: (d) => (d.displayId ? `/data/wow/media/creature-display/${d.displayId}` : null), key: 'zoom' },
  },
  {
    kind: 'pet', label: 'Pets', index: { path: '/data/wow/pet/index', field: 'pets' },
    detail: { path: (id) => `/data/wow/pet/${id}`, parse: (j) => ({ icon: renderUrl(j?.icon), type: typeof j?.battle_pet_type?.name === 'string' ? j.battle_pet_type.name.slice(0, 30) : null }) },
  },
  {
    kind: 'toy', label: 'Toys', index: { path: '/data/wow/toy/index', field: 'toys' },
    detail: { path: (id) => `/data/wow/toy/${id}`, parse: (j) => ({ itemId: j?.item?.id ?? null, mediaId: j?.media?.id ?? null, source: typeof j?.source?.name === 'string' ? j.source.name.slice(0, 40) : null }) },
    media: { path: (d) => (d.mediaId ? `/data/wow/media/item/${d.mediaId}` : null), key: 'icon' },
  },
  {
    kind: 'heirloom', label: 'Heirlooms', index: { path: '/data/wow/heirloom/index', field: 'heirlooms' },
    detail: { path: (id) => `/data/wow/heirloom/${id}`, parse: (j) => ({ itemId: j?.item?.id ?? null, mediaId: j?.media?.id ?? null }) },
    media: { path: (d) => (d.mediaId ? `/data/wow/media/item/${d.mediaId}` : null), key: 'icon' },
  },
  { kind: 'title', label: 'Titles', index: { path: '/data/wow/title/index', field: 'titles' } },
  {
    kind: 'achievement', label: 'Achievements', index: { path: '/data/wow/achievement/index', field: 'achievements' },
    detail: { path: (id) => `/data/wow/achievement/${id}`, parse: (j) => parseAchievementDetail(j) ?? {} },
    media: { path: (d) => (d.mediaId ? `/data/wow/media/achievement/${d.mediaId}` : null), key: 'icon' },
  },
  {
    kind: 'achievement-category', label: 'Achievement categories', index: { path: '/data/wow/achievement-category/index', field: 'categories', roots: 'root_categories' },
    detail: { path: (id) => `/data/wow/achievement-category/${id}`, parse: (j) => ({ sub: (Array.isArray(j?.subcategories) ? j.subcategories : []).map((x) => x?.id).filter(Number.isSafeInteger).slice(0, 100), order: j?.display_order ?? null }) },
  },
  {
    kind: 'faction', label: 'Reputation factions', index: { path: '/data/wow/reputation-faction/index', field: 'factions', roots: 'root_factions' },
    detail: { path: (id) => `/data/wow/reputation-faction/${id}`, parse: (j) => ({ children: (Array.isArray(j?.factions) ? j.factions : []).map((x) => x?.id).filter(Number.isSafeInteger).slice(0, 200), header: !j?.reputation_tiers && Array.isArray(j?.factions) }) },
  },
  {
    kind: 'appearance', label: 'Transmog appearances', index: { special: 'appearanceSlots' },
    detail: { path: (id) => `/data/wow/item-appearance/${id}`, parse: (j) => parseAppearanceDetail(j) ?? {} },
    media: { path: (d) => (d.mediaId ? `/data/wow/media/item/${d.mediaId}` : null), key: 'icon' },
  },
  {
    kind: 'appearance-set', label: 'Appearance sets', index: { path: '/data/wow/item-appearance/set/index', field: 'appearance_sets' },
    detail: { path: (id) => `/data/wow/item-appearance/set/${id}`, parse: (j) => ({ appearances: (Array.isArray(j?.appearances) ? j.appearances : []).map((a) => a?.id).filter(Number.isSafeInteger).slice(0, 60) }) },
  },
  // Item quality: item-appearance has none and /data/wow/item/{id} 404s on Forever, so quality comes from Blizzard's
  // item SEARCH (it answers 200 with quality and appearance ids). Paged by id; stops honestly if paging stalls.
  { kind: 'item', label: 'Item qualities (item search)', index: { special: 'itemSearch' } },
]);
export const catalogByKind = new Map(CATALOGS.map((c) => [c.kind, c]));

// ---- the static namespace

export async function staticNamespace(db) {
  return (await db.one("SELECT detail FROM collection_catalog_state WHERE kind = 'namespace'"))?.detail ?? null;
}
export async function recordStaticNamespace(db, ns) {
  if (!ns) return;
  await db.query(
    `INSERT INTO collection_catalog_state (kind, state, detail, fetched_at, finished_at) VALUES ('namespace', 'ok', $1, now(), now())
     ON CONFLICT (kind) DO UPDATE SET detail = EXCLUDED.detail, fetched_at = now(), finished_at = now()`,
    [ns],
  );
}

// ---- refreshing

async function setState(db, kind, fields) {
  const keys = Object.keys(fields);
  await db.query(
    `INSERT INTO collection_catalog_state (kind, state) VALUES ($1, $2) ON CONFLICT (kind) DO NOTHING`,
    [kind, fields.state ?? 'queued'],
  );
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.query(`UPDATE collection_catalog_state SET ${sets} WHERE kind = $1`, [kind, ...keys.map((k) => fields[k])]);
}

async function tally(db, kind, requests, bytes) {
  await db.query('UPDATE collection_catalog_state SET requests = requests + $2, bytes = bytes + $3 WHERE kind = $1', [kind, requests, bytes]);
}

/** Which catalogs are due (never built, or older than REFRESH_DAYS, or stuck for a day): queued at the lowest priority. */
export async function queueDueCatalogs(db) {
  if (!(await staticNamespace(db))) return { queued: 0, why: 'waiting for a character fetch to name the static namespace' };
  const states = new Map((await db.query("SELECT kind, state, started_at, fetched_at FROM collection_catalog_state WHERE kind <> 'namespace' LIMIT 50")).map((r) => [r.kind, r]));
  let queued = 0;
  for (const c of CATALOGS) {
    const s = states.get(c.kind);
    const day = 24 * 60 * 60 * 1000;
    const stale = !s || !s.fetched_at || Date.now() - new Date(s.fetched_at).getTime() > REFRESH_DAYS * day;
    const stuck = s && (s.state === 'queued' || s.state === 'building') && s.started_at && Date.now() - new Date(s.started_at).getTime() > day;
    const busy = s && (s.state === 'queued' || s.state === 'building') && !stuck;
    if (busy || !(stale || stuck || s?.state === 'failed')) continue;
    if (s?.state === 'failed' && !stale && s.started_at && Date.now() - new Date(s.started_at).getTime() < 6 * 60 * 60 * 1000) continue;
    await setState(db, c.kind, { state: 'queued', started_at: new Date(), requests: 0, bytes: 0, detail: null });
    await enqueue(db, { kind: 'catalog', key: `catalog:${c.kind}:index`, priority: PRIORITY.roster });
    queued += 1;
  }
  return { queued };
}

const okJson = (r, what) => {
  if (r.status === 200 && r.json) return r.json;
  if (r.status === 404) return null;
  throw new RetryableError(`${what}: ${r.status === null ? 'no answer' : `HTTP ${r.status}`}`, 'blizzard');
};

/** The crawl item 'catalog': `catalog:<kind>:index` or `catalog:<kind>:details:<n>`. */
export async function fetchCatalogStep({ db, client }, item) {
  const [, kind, step, n] = String(item.key).split(':');
  const c = catalogByKind.get(kind);
  if (!c) return 'unknown catalog';
  const ns = await staticNamespace(db);
  if (!ns) return 'no static namespace yet';
  const ask = async (path, query = null) => {
    const r = await client.request(`catalog-${kind}`, path, { priority: item.priority, namespace: ns, query });
    await tally(db, kind, 1, r.bytes ?? 0);
    return r;
  };
  try {
    if (step === 'index') return await indexStep(db, c, ask, item);
    return await detailStep(db, c, ask, item, Number(n) || 0);
  } catch (err) {
    if (err instanceof RetryableError && item.attempts < 5) throw err;
    await setState(db, kind, { state: 'failed', finished_at: new Date(), detail: String(err.message ?? err.name).slice(0, 300) });
    return `failed: ${err.message ?? err.name}`;
  }
}

async function upsertRows(db, kind, rows, { started }) {
  // Rows Blizzard no longer lists go; listed rows keep their details until the detail steps refresh them.
  await db.query('DELETE FROM collection_catalog WHERE kind = $1 AND NOT (id = ANY($2::bigint[]))', [kind, rows.map((r) => r.id)]);
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await db.query(
      `INSERT INTO collection_catalog (kind, id, name, data, fetched_at)
       SELECT $1, v.id, v.name, v.data::jsonb, CASE WHEN $5 THEN now() ELSE $6::timestamptz END
         FROM unnest($2::bigint[], $3::text[], $4::text[]) AS v(id, name, data)
       ON CONFLICT (kind, id) DO UPDATE SET name = EXCLUDED.name,
         data = collection_catalog.data || EXCLUDED.data,
         fetched_at = CASE WHEN $5 THEN now() ELSE collection_catalog.fetched_at END`,
      [kind, part.map((r) => r.id), part.map((r) => r.name), part.map((r) => JSON.stringify(r.data ?? {})), !started, started ?? new Date(0)],
    );
  }
}

async function indexStep(db, c, ask, item) {
  await setState(db, c.kind, { state: 'building', started_at: new Date() });
  let rows;
  if (c.index.special === 'appearanceSlots') rows = await appearanceIndex(ask);
  else if (c.index.special === 'itemSearch') return itemSearch(db, c, ask);
  else {
    const j = okJson(await ask(c.index.path), `${c.kind} index`);
    const roots = new Set(c.index.roots ? indexOf(j, c.index.roots).map((x) => x.id) : []);
    rows = (j ? indexOf(j, c.index.field) : []).map((x) => ({ id: x.id, name: x.name, data: c.index.roots ? { root: roots.has(x.id) } : {} }));
  }
  // New rows are marked a second older than this build's start, so the detail steps (fetched_at < started_at) pick
  // them up; still recent, so the hourly retention sweep can't delete them mid-build.
  const started = c.detail ? new Date(new Date((await db.one('SELECT started_at FROM collection_catalog_state WHERE kind = $1', [c.kind])).started_at).getTime() - 1000) : null;
  await upsertRows(db, c.kind, rows, { started });
  if (!rows.length) {
    await setState(db, c.kind, { state: 'empty', total: 0, finished_at: new Date(), fetched_at: new Date() });
    return `${c.kind}: empty`;
  }
  if (!c.detail) {
    await setState(db, c.kind, { state: 'ok', total: rows.length, finished_at: new Date(), fetched_at: new Date() });
    return `${c.kind}: ${rows.length}`;
  }
  await setState(db, c.kind, { total: rows.length });
  await enqueue(db, { kind: 'catalog', key: `catalog:${c.kind}:details:0`, priority: item.priority });
  return `${c.kind}: ${rows.length} listed, details queued`;
}

/** item-appearance/slot/index (its links name each slot) → each slot's appearance list. */
async function appearanceIndex(ask) {
  const idx = okJson(await ask('/data/wow/item-appearance/slot/index'), 'appearance slot index');
  const slots = (Array.isArray(idx?.slots) ? idx.slots : [])
    .map((s) => (typeof s?.key?.href === 'string' ? decodeURIComponent(new URL(s.key.href).pathname.split('/').pop()) : null))
    .filter((s) => s && /^[A-Z0-9_]{1,30}$/.test(s));
  const rows = new Map();
  for (const slot of slots) {
    const j = okJson(await ask(`/data/wow/item-appearance/slot/${slot}`), `appearance slot ${slot}`);
    for (const a of Array.isArray(j?.appearances) ? j.appearances : []) {
      if (Number.isSafeInteger(a?.id) && !rows.has(a.id)) rows.set(a.id, { id: a.id, name: null, data: { slot } });
    }
  }
  return [...rows.values()];
}

async function detailStep(db, c, ask, item, n) {
  const st = await db.one('SELECT started_at, total FROM collection_catalog_state WHERE kind = $1', [c.kind]);
  const rows = await db.query(
    'SELECT id, data FROM collection_catalog WHERE kind = $1 AND fetched_at < $2 ORDER BY id LIMIT $3',
    [c.kind, st.started_at, DETAIL_CHUNK],
  );
  for (const row of rows) {
    const r = await ask(c.detail.path(row.id));
    if (r.status === 429 || r.status === null || r.status >= 500) throw new RetryableError(`${c.kind} detail: ${r.status ?? 'no answer'}`, 'blizzard');
    const data = r.status === 200 && r.json ? { ...row.data, ...c.detail.parse(r.json, row) } : { ...row.data, missing: true };
    if (c.media && r.status === 200) {
      const p = c.media.path(data);
      if (p) {
        const m = await ask(p);
        if (m.status === 429 || m.status === null || m.status >= 500) throw new RetryableError(`${c.kind} media: ${m.status ?? 'no answer'}`, 'blizzard');
        data.icon = m.status === 200 ? mediaAsset(m.json, c.media.key) : null;
      }
    }
    // A name from the detail (appearances have none in their slot lists): the first item that grants it.
    const name = typeof data.name === 'string' ? data.name : data.items?.[0]?.name ?? null;
    await db.query(
      'UPDATE collection_catalog SET data = $3::jsonb, name = coalesce($4, name), fetched_at = now() WHERE kind = $1 AND id = $2',
      [c.kind, row.id, JSON.stringify(data), name],
    );
  }
  const left = (await db.one('SELECT count(*)::int AS n FROM collection_catalog WHERE kind = $1 AND fetched_at < $2', [c.kind, st.started_at])).n;
  if (left && rows.length) {
    await enqueue(db, { kind: 'catalog', key: `catalog:${c.kind}:details:${n + 1}`, priority: item.priority });
    return `${c.kind}: ${rows.length} details, ${left} left`;
  }
  await setState(db, c.kind, { state: 'ok', finished_at: new Date(), fetched_at: new Date() });
  return `${c.kind}: done`;
}

/**
 * Item search, paged by id: pages 1..pageCount of `id=[from,]&orderby=id`, then the next range from the last id seen.
 * A range that doesn't move forward (Blizzard ignoring it) stops the walk and says so: what was read is kept.
 */
async function itemSearch(db, c, ask) {
  let from = 0;
  let pages = 0;
  const seen = new Map();
  let stalled = false;
  while (pages < ITEM_SEARCH_MAX_PAGES) {
    let last = from;
    let pageCount = 1;
    for (let page = 1; page <= pageCount && pages < ITEM_SEARCH_MAX_PAGES; page++) {
      const j = okJson(await ask('/data/wow/search/item', { orderby: 'id', _page: page, _pageSize: 1000, id: `[${from},]` }), 'item search');
      pages += 1;
      const r = parseItemSearch(j);
      pageCount = Math.max(1, Math.min(r.pageCount ?? 1, 10));
      if (!r.items.length) break;
      for (const it of r.items) if (it.appearances.length && !seen.has(it.id)) seen.set(it.id, it);
      last = Math.max(last, ...r.items.map((x) => x.id));
    }
    if (last <= from) {
      stalled = from > 0;
      break;
    }
    if (pageCount < 10) break; // the last range fitted in fewer than 10 pages: that was everything
    from = last + 1;
  }
  const rows = [...seen.values()].map((it) => ({ id: it.id, name: it.name, data: { quality: it.quality, appearances: it.appearances } }));
  await upsertRows(db, c.kind, rows, { started: null });
  const detail = stalled ? 'Blizzard’s item search stopped paging by id: qualities cover the items read so far' : null;
  await setState(db, c.kind, { state: rows.length ? 'ok' : 'empty', total: rows.length, finished_at: new Date(), fetched_at: new Date(), detail });
  return `items: ${rows.length} with appearances, ${pages} pages${stalled ? ' (stalled)' : ''}`;
}

// ---- reading

/** { kind → total rows } for catalogs that finished at least once (state ok or empty). */
export async function catalogTotals(db) {
  const rows = await db.query(
    "SELECT s.kind, s.state, (SELECT count(*)::int FROM collection_catalog c WHERE c.kind = s.kind) AS n FROM collection_catalog_state s WHERE s.kind <> 'namespace' AND s.fetched_at IS NOT NULL LIMIT 50",
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/** Map(id → { id, name, ...data }) for one catalog kind, bounded. */
export async function catalogMap(db, kind, { ids = null, limit = 50_000 } = {}) {
  const rows = ids
    ? await db.query('SELECT id, name, data FROM collection_catalog WHERE kind = $1 AND id = ANY($2::bigint[]) LIMIT $3', [kind, ids, limit])
    : await db.query('SELECT id, name, data FROM collection_catalog WHERE kind = $1 ORDER BY id LIMIT $2', [kind, limit]);
  return new Map(rows.map((r) => [Number(r.id), { ...r.data, id: Number(r.id), name: r.name }]));
}

/** The admin readout: each catalog's state, size and measured cost. */
export async function catalogStatus(db) {
  const rows = await db.query("SELECT kind, state, total, requests, bytes, detail, started_at, finished_at, fetched_at FROM collection_catalog_state ORDER BY kind LIMIT 50");
  return rows.map((r) => ({ ...r, requests: Number(r.requests), bytes: Number(r.bytes), label: catalogByKind.get(r.kind)?.label ?? (r.kind === 'namespace' ? 'Static namespace' : r.kind) }));
}
