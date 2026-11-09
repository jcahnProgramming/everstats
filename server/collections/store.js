import { COLLECTIONS_CATEGORY, COUNTS, DERIVED_BASE, KINDS, kindById } from './registry.js';
import { catalogMap } from './catalog.js';

/**
 * Writing collections (0.9.0). Parsed values only. Every function takes `q` (a transaction) where it writes.
 *
 * storeCollection    one kind for one character. A kind Blizzard didn't return keeps its last good data (and that
 *                    data's own fetched date), marked not_returned with the status, so the page can say so honestly.
 * deriveCounts       the collection counts that are statistics (registry COUNTS) → character_statistics, dated by the
 *                    data they were counted from. Zero = no row (zero is never ranked). A count that can't be made
 *                    (a kind never returned, Legacy Points before the achievement catalog) is left as it was.
 * detectSharing      "Shared across this account": per signed-in account and kind, whether every fetched character
 *                    of that account has the identical collection. Needs two or more characters; never assumed.
 */
export async function storeCollection(q, characterId, kind, { state, status = null, data = null }) {
  if (state === 'not_returned') {
    await q.query(
      `INSERT INTO character_collections (character_id, kind, state, http_status, data, checked_at, data_fetched_at)
       VALUES ($1, $2, 'not_returned', $3, NULL, now(), NULL)
       ON CONFLICT (character_id, kind) DO UPDATE SET state = 'not_returned', http_status = EXCLUDED.http_status, checked_at = now()`,
      [characterId, kind, status],
    );
    return;
  }
  await q.query(
    `INSERT INTO character_collections (character_id, kind, state, http_status, data, checked_at, data_fetched_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
     ON CONFLICT (character_id, kind) DO UPDATE SET state = EXCLUDED.state, http_status = EXCLUDED.http_status, data = EXCLUDED.data,
       checked_at = now(), data_fetched_at = now()`,
    [characterId, kind, state, status, JSON.stringify(data)],
  );
}

let derivedRecordedAt = 0;
/** The Everstats-counted statistics in `statistics` (names and category are ours; refreshed at most hourly). */
export async function recordDerivedStatistics(q, { force = false } = {}) {
  if (!force && Date.now() - derivedRecordedAt < 60 * 60 * 1000) return;
  // A count for a collection Blizzard has no catalog entries for (heirlooms on Forever) isn't registered at all: no
  // board, no Discovery row. It appears by itself once Blizzard's catalog lists some.
  const { catalogTotals } = await import('./catalog.js');
  const totals = await catalogTotals(q);
  const list = COUNTS.filter((c) => !c.onlyWithCatalog || (totals[c.catalog] ?? 0) > 0);
  await q.query(
    `INSERT INTO statistics (id, name, category_path, derived)
     SELECT v.id, v.name, $3::jsonb, v.key FROM unnest($1::bigint[], $2::text[], $4::text[]) AS v(id, name, key)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category_path = EXCLUDED.category_path, derived = EXCLUDED.derived, last_seen_at = now()`,
    [list.map((c) => c.id), list.map((c) => c.name), JSON.stringify([{ id: null, name: COLLECTIONS_CATEGORY }]), list.map((c) => c.key)],
  );
  derivedRecordedAt = Date.now();
  const { clearCatalogCache } = await import('../stats/catalog.js');
  clearCatalogCache();
}

/** The character's collection rows: Map(kind → { state, status, data, checkedAt, fetchedAt }). */
export async function collectionsOf(q, characterId) {
  const rows = await q.query('SELECT kind, state, http_status, data, checked_at, data_fetched_at FROM character_collections WHERE character_id = $1 LIMIT 50', [characterId]);
  return new Map(rows.map((r) => [r.kind, { state: r.state, status: r.http_status, data: r.data, checkedAt: r.checked_at, fetchedAt: r.data_fetched_at }]));
}

/** Achievement catalog as Legacy Points needs it: Map(id → { name, reward, accountWide }). */
export async function achievementCatalog(q) {
  return catalogMap(q, 'achievement', { limit: 20_000 });
}

export async function deriveCounts(q, characterId) {
  const ch = await q.one('SELECT ruleset_id, hidden FROM characters WHERE id = $1', [characterId]);
  if (!ch || ch.ruleset_id === null) return 0;
  await recordDerivedStatistics(q);
  const rows = await collectionsOf(q, characterId);
  const ctx = { achievementCatalog: rows.has('achievements') ? await achievementCatalog(q) : null };
  let written = 0;
  for (const c of COUNTS) {
    const row = rows.get(c.kind);
    if (!row?.data || !row.fetchedAt) continue; // never returned: nothing to count from
    const value = c.count(row.data, ctx);
    if (value === null || !Number.isFinite(value)) continue;
    if (value > 0) {
      await q.query(
        `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, hidden, value, text, blizzard_updated_at, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
         ON CONFLICT (character_id, statistic_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, hidden = EXCLUDED.hidden, value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at`,
        [characterId, c.id, ch.ruleset_id, ch.hidden, value, row.fetchedAt],
      );
    } else {
      await q.query('DELETE FROM character_statistics WHERE character_id = $1 AND statistic_id = $2', [characterId, c.id]);
    }
    written += 1;
  }
  return written;
}

/** A collection's comparable content (ids only), for account-wide detection. */
function signature(kind, data) {
  if (!data) return null;
  if (kind === 'transmog') return JSON.stringify([...new Set(data.slots.flatMap((s) => s.ids))].sort((a, b) => a - b));
  if (kind === 'pets') return JSON.stringify([...new Set(data.items.map((p) => p.speciesId))].sort((a, b) => a - b));
  return JSON.stringify([...new Set((data.items ?? []).map((x) => x.id))].sort((a, b) => a - b));
}

/**
 * Re-detects every kind for one account from its owned, tracked characters' stored collections. A kind with fewer
 * than two characters that have it loses its row (nothing to compare).
 */
export async function detectSharing(q, accountId) {
  const rows = await q.query(
    `SELECT cc.character_id, cc.kind, cc.data FROM character_collections cc JOIN characters c ON c.id = cc.character_id
      WHERE c.owner_account_id = $1 AND c.profile_state = 'ok' AND cc.data IS NOT NULL AND cc.kind = ANY($2::text[]) LIMIT 2000`,
    [accountId, KINDS.filter((k) => k.detect).map((k) => k.id)],
  );
  const byKind = new Map();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(signature(r.kind, r.data));
  }
  for (const k of KINDS.filter((x) => x.detect)) {
    const sigs = byKind.get(k.id) ?? [];
    if (sigs.length < 2) {
      await q.query('DELETE FROM collection_sharing WHERE account_id = $1 AND kind = $2', [accountId, k.id]);
      continue;
    }
    await q.query(
      `INSERT INTO collection_sharing (account_id, kind, shared, characters, computed_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (account_id, kind) DO UPDATE SET shared = EXCLUDED.shared, characters = EXCLUDED.characters, computed_at = now()`,
      [accountId, k.id, new Set(sigs).size === 1, sigs.length],
    );
  }
}

/** Site-wide detection evidence per kind: { kind → { accounts, shared } } (accounts with 2+ fetched characters). */
export async function sharingEvidence(q) {
  const rows = await q.query('SELECT kind, count(*)::int AS accounts, count(*) FILTER (WHERE shared)::int AS shared FROM collection_sharing GROUP BY kind LIMIT 50');
  return Object.fromEntries(rows.map((r) => [r.kind, { accounts: r.accounts, shared: r.shared }]));
}

/** The kinds detected as shared for one account: Set(kind). */
export async function sharedKindsOf(q, accountId) {
  if (!accountId) return new Set();
  return new Set((await q.query('SELECT kind FROM collection_sharing WHERE account_id = $1 AND shared LIMIT 50', [accountId])).map((r) => r.kind));
}

export const DERIVED_ID_FLOOR = DERIVED_BASE;
export { kindById };
