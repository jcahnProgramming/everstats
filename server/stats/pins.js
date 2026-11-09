import { loadCatalog } from './catalog.js';

/**
 * Pinned statistics on the signed-in dashboard. An account that hasn't chosen yet (accounts.pins_customised false)
 * sees the default pins; the first change stores its own list (empty is a choice too).
 *
 * The defaults are matched BY NAME against the live catalog, so they're data-safe: a name Blizzard doesn't list (yet)
 * is simply skipped, and no statistic id is written here. Chosen for 0.4.0 because every character sampled in
 * discovery runs 1 and 2 had all four, and together they span the site's spirit: one Forever-only system, one "bad"
 * statistic, one progress count and one combat count.
 */
export const DEFAULT_PIN_NAMES = Object.freeze(['Times camped', 'Total deaths', 'Quests completed', 'Creatures killed']);
export const MAX_PINS = 12;

export async function defaultPinIds(db) {
  const { statistics } = await loadCatalog(db);
  const byName = new Map([...statistics.values()].map((s) => [s.name.toLowerCase(), s.id]));
  return DEFAULT_PIN_NAMES.map((n) => byName.get(n.toLowerCase())).filter((id) => id !== undefined);
}

/** → { ids, isDefault } */
export async function pinsOf(db, accountId) {
  const acct = await db.one('SELECT pins_customised FROM accounts WHERE id = $1', [accountId]);
  if (!acct?.pins_customised) return { ids: await defaultPinIds(db), isDefault: true };
  const rows = await db.query('SELECT statistic_id FROM account_pins WHERE account_id = $1 ORDER BY position, statistic_id LIMIT $2', [accountId, MAX_PINS]);
  return { ids: rows.map((r) => r.statistic_id), isDefault: false };
}

export async function setPins(q, accountId, ids) {
  await q.query('DELETE FROM account_pins WHERE account_id = $1', [accountId]);
  for (const [i, id] of ids.entries()) {
    await q.query('INSERT INTO account_pins (account_id, statistic_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [accountId, id, i]);
  }
  await q.query('UPDATE accounts SET pins_customised = true WHERE id = $1', [accountId]);
}
