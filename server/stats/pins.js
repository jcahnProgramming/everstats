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
  const byName = new Map([...statistics.values()].filter((s) => s.name !== null).map((s) => [s.name.toLowerCase(), s.id]));
  return DEFAULT_PIN_NAMES.map((n) => byName.get(n.toLowerCase())).filter((id) => id !== undefined);
}

/** → { ids, isDefault } */
export async function pinsOf(db, accountId) {
  const acct = await db.one('SELECT pins_customised FROM accounts WHERE id = $1', [accountId]);
  if (!acct?.pins_customised) return { ids: await defaultPinIds(db), isDefault: true };
  const rows = await db.query('SELECT statistic_id FROM account_pins WHERE account_id = $1 ORDER BY position, statistic_id LIMIT $2', [accountId, MAX_PINS]);
  return { ids: rows.map((r) => r.statistic_id), isDefault: false };
}

/**
 * The pinned-stat cards for a character (the dashboard, and the public profile when the player shows them): each
 * pin's value, its rank on the character's ruleset board (null at zero: not ranked), how many have any, and the move
 * since a week ago (null until a week of rank history exists). A statistic whose name has aged out of the retention
 * window (no character returned it lately) is { name: null }: shown as unavailable, never given an invented name.
 */
export async function pinCards(db, ids, character) {
  // Pins are statistics of the primary game version; `character` is one of that version (callers check).
  const { rankOn } = await import('./boards.js');
  const { utcDay } = await import('./periods.js');
  const { statistics } = await loadCatalog(db);
  const weekAgo = utcDay(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const out = [];
  for (const id of ids) {
    const s = statistics.get(id);
    if (!s) continue;
    const cs = await db.one('SELECT value, text FROM character_statistics WHERE character_id = $1 AND statistic_id = $2', [character.id, id]);
    const rk = character.hidden ? null : await rankOn(db, { characterId: character.id, statisticId: id, rulesetId: character.ruleset_id });
    const then = rk?.rank
      ? await db.one('SELECT rank, day FROM pin_rank_history WHERE character_id = $1 AND statistic_id = $2 AND day <= $3 ORDER BY day DESC LIMIT 1', [character.id, id, weekAgo])
      : null;
    out.push({
      id, name: s.name, category: s.category, grading: s.grading, value: cs?.value ?? 0, text: cs?.text ?? null,
      rank: rk?.rank ?? null, withAny: rk?.withAny ?? null,
      // Positive = moved up the board. null until a week of rank history exists (shown as "—").
      move: then && rk?.rank ? then.rank - rk.rank : null, since: then?.day ?? null,
    });
  }
  return out;
}

export async function setPins(q, accountId, ids) {
  await q.query('DELETE FROM account_pins WHERE account_id = $1', [accountId]);
  for (const [i, id] of ids.entries()) {
    await q.query('INSERT INTO account_pins (account_id, statistic_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [accountId, id, i]);
  }
  await q.query('UPDATE accounts SET pins_customised = true WHERE id = $1', [accountId]);
}
