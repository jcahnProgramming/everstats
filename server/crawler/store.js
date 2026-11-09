import { recordStatistics } from '../stats/catalog.js';
import { PERIODS, periodStart, utcDay } from '../stats/periods.js';

/**
 * Writing what the crawler fetched. Parsed values only (crawler/parse.js): never a raw body.
 * Every function takes `q` (a transaction from db.tx) so a character's update lands whole or not at all.
 */
const MAX_STATS_PER_CHARACTER = 5000;

export async function upsertRuleset(q, r, { listed = null } = {}) {
  if (!r || !Number.isInteger(r.id)) return;
  await q.query(
    `INSERT INTO rulesets (id, name, listed) VALUES ($1, $2, coalesce($3, false))
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, listed = coalesce($3, rulesets.listed), updated_at = now()`,
    [r.id, String(r.name).slice(0, 60), listed],
  );
}

export async function upsertGuild(q, g, rulesetId) {
  if (!g || !Number.isFinite(g.id) || !g.slug) return null;
  await q.query(
    `INSERT INTO guilds (id, slug, name, faction, ruleset_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, faction = EXCLUDED.faction,
       ruleset_id = coalesce(EXCLUDED.ruleset_id, guilds.ruleset_id), updated_at = now()`,
    [g.id, g.slug, g.name, g.faction, rulesetId],
  );
  return g.id;
}

/** A character Blizzard named somewhere (an account list, a roster) without its profile: tracked as known. */
export async function upsertKnown(q, c, { source, ownerAccountId = null }) {
  await q.query('UPDATE characters SET slug = NULL WHERE slug = $1 AND id <> $2', [c.slug, c.id]);
  return q.one(
    `INSERT INTO characters (id, slug, name, surname, faction, race, class, gender, level, account_level, profile_state, source, owner_account_id, owned_since)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'not_found', $11, $12, CASE WHEN $12::bigint IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug, name = EXCLUDED.name, surname = EXCLUDED.surname,
       faction = coalesce(characters.faction, EXCLUDED.faction), race = coalesce(characters.race, EXCLUDED.race),
       class = coalesce(characters.class, EXCLUDED.class), gender = coalesce(characters.gender, EXCLUDED.gender),
       level = GREATEST(characters.level, EXCLUDED.level),
       account_level = coalesce(EXCLUDED.account_level, characters.account_level),
       owner_account_id = coalesce(EXCLUDED.owner_account_id, characters.owner_account_id),
       owned_since = CASE WHEN EXCLUDED.owner_account_id IS NOT NULL AND characters.owner_account_id IS DISTINCT FROM EXCLUDED.owner_account_id THEN now() ELSE characters.owned_since END
     RETURNING id, profile_state, last_checked_at, stats_fetched_at`,
    [c.id, c.slug, c.name, c.surname ?? '', c.faction ?? null, c.race ?? null, c.class ?? null, c.gender ?? null, c.level ?? null,
      source === 'account' ? c.level ?? null : null, source, ownerAccountId],
  );
}

/** The profile (200). Returns { id, previous } where previous is the row before this write (or null). */
export async function storeProfile(q, p, { source }) {
  const previous = await q.one('SELECT id, ruleset_id, hidden, login_at_full, last_fetched_at, media_state FROM characters WHERE id = $1 FOR UPDATE', [p.id]);
  await upsertRuleset(q, p.ruleset);
  const guildId = await upsertGuild(q, p.guild, p.ruleset?.id ?? null);
  if (p.slug) await q.query('UPDATE characters SET slug = NULL WHERE slug = $1 AND id <> $2', [p.slug, p.id]);
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, race, class, gender, level, guild_id, last_login_at, profile_state, last_checked_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ok', now(), $13)
     ON CONFLICT (id) DO UPDATE SET
       slug = coalesce(EXCLUDED.slug, characters.slug), name = EXCLUDED.name, surname = EXCLUDED.surname,
       ruleset_id = coalesce(EXCLUDED.ruleset_id, characters.ruleset_id), faction = EXCLUDED.faction, race = EXCLUDED.race,
       class = EXCLUDED.class, gender = EXCLUDED.gender, level = EXCLUDED.level, guild_id = EXCLUDED.guild_id,
       last_login_at = EXCLUDED.last_login_at, profile_state = 'ok', last_checked_at = now()`,
    [p.id, p.slug, p.name, p.surname, p.ruleset?.id ?? null, p.faction, p.race, p.class, p.gender, p.level, guildId, p.lastLoginAt, source],
  );
  // A ruleset change (a transfer, if Forever ever has them): every ranked copy follows the character.
  if (previous && p.ruleset && previous.ruleset_id !== null && previous.ruleset_id !== p.ruleset.id) {
    await q.query('UPDATE character_statistics SET ruleset_id = $2 WHERE character_id = $1', [p.id, p.ruleset.id]);
  }
  return { id: p.id, previous, guildId };
}

/** The 404 case: a character whose profile Blizzard doesn't serve (yet). */
export async function markProfileMissing(q, slug) {
  // A character that has been fetched before keeps its data (Blizzard may be catching up); one that never was is
  // recorded as not found.
  await q.query(
    `UPDATE characters SET last_checked_at = now(), profile_state = CASE WHEN stats_fetched_at IS NULL THEN 'not_found' ELSE profile_state END
      WHERE slug = $1`,
    [slug],
  );
}

/**
 * Statistics, gear, attributes and media from a full fetch. `stats` null means the statistics endpoint didn't answer
 * (the old values stay, honestly dated by stats_fetched_at). media: { state: 'ok' | 'not_ready' | 'failed', assets }.
 */
export async function storeDetails(q, characterId, { stats, attributes, equipment, media, loginAt }) {
  const ch = await q.one('SELECT ruleset_id, hidden FROM characters WHERE id = $1', [characterId]);
  if (stats && ch.ruleset_id !== null) {
    await recordStatistics(q, stats);
    const list = stats.slice(0, MAX_STATS_PER_CHARACTER);
    await q.query('DELETE FROM character_statistics WHERE character_id = $1 AND NOT (statistic_id = ANY($2::bigint[]))', [characterId, list.map((s) => s.id)]);
    await q.query(
      `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, hidden, value, text, blizzard_updated_at, fetched_at)
       SELECT $1, v.id, $2, $3, v.value, v.text, v.updated, now()
         FROM unnest($4::bigint[], $5::float8[], $6::text[], $7::timestamptz[]) AS v(id, value, text, updated)
       ON CONFLICT (character_id, statistic_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, value = EXCLUDED.value,
         text = EXCLUDED.text, blizzard_updated_at = EXCLUDED.blizzard_updated_at, fetched_at = EXCLUDED.fetched_at`,
      [characterId, ch.ruleset_id, ch.hidden, list.map((s) => s.id), list.map((s) => s.value), list.map((s) => s.text), list.map((s) => s.updatedAt)],
    );
  }
  await q.query(
    `UPDATE characters SET
       stats_fetched_at = CASE WHEN $2 THEN now() ELSE stats_fetched_at END,
       attributes = coalesce($3::jsonb, attributes), equipment = coalesce($4::jsonb, equipment),
       media = CASE WHEN $5 = 'ok' THEN $6::jsonb ELSE media END,
       media_state = CASE WHEN $5 = 'ok' THEN 'ok' WHEN $5 = 'not_ready' AND media_state IS DISTINCT FROM 'ok' THEN 'not_ready'
                          WHEN $5 IS NULL THEN media_state WHEN media_state = 'ok' THEN 'ok' ELSE $5 END,
       media_fetched_at = CASE WHEN $5 = 'ok' THEN now() ELSE media_fetched_at END,
       last_fetched_at = now(), first_fetched_at = coalesce(first_fetched_at, now()), login_at_full = $7
     WHERE id = $1`,
    [characterId, Boolean(stats && ch.ruleset_id !== null), attributes ? JSON.stringify(attributes) : null, equipment ? JSON.stringify(equipment) : null,
      media?.state ?? null, media?.assets ? JSON.stringify(media.assets) : null, loginAt],
  );
}

/** Just the media (a refresh of an unchanged character whose render wasn't ready last time). */
export async function storeMedia(q, characterId, media) {
  await storeDetails(q, characterId, { stats: null, attributes: null, equipment: null, media, loginAt: (await q.one('SELECT login_at_full FROM characters WHERE id = $1', [characterId])).login_at_full });
}

/**
 * Today's snapshot (UTC day) from the character's current values, if it has none yet: one per character per day,
 * the first of the day. The first snapshot in a week or month becomes that period's baseline. → true if taken.
 */
export async function takeSnapshot(q, characterId, { now = Date.now } = {}) {
  const ch = await q.one('SELECT ruleset_id, hidden, level, stats_fetched_at FROM characters WHERE id = $1', [characterId]);
  if (!ch?.stats_fetched_at || ch.ruleset_id === null) return false;
  const rows = await q.query('SELECT statistic_id, value FROM character_statistics WHERE character_id = $1 ORDER BY statistic_id LIMIT $2', [characterId, MAX_STATS_PER_CHARACTER]);
  const at = new Date(now());
  const ids = rows.map((r) => r.statistic_id);
  const values = rows.map((r) => r.value);
  const taken = await q.one(
    `INSERT INTO character_snapshots (character_id, day, taken_at, level, stat_ids, stat_values) VALUES ($1, $2, $3, $4, $5::int[], $6::float8[])
     ON CONFLICT (character_id, day) DO NOTHING RETURNING taken_at`,
    [characterId, utcDay(at), at, ch.level, ids, values],
  );
  if (!taken) return false;
  await q.query("INSERT INTO pipeline_facts (key, at) VALUES ('first_snapshot_at', $1) ON CONFLICT (key) DO NOTHING", [at]);
  for (const period of PERIODS) {
    await q.query(
      `INSERT INTO period_baselines (period, period_start, character_id, ruleset_id, hidden, taken_at, stat_ids, stat_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7::int[], $8::float8[]) ON CONFLICT DO NOTHING`,
      [period, periodStart(period, at), characterId, ch.ruleset_id, ch.hidden, at, ids, values],
    );
  }
  return true;
}

/** Rebuilds the character's gains in the current week and month: current value minus the period's baseline, > 0 only. */
export async function updateGains(q, characterId, { now = Date.now } = {}) {
  const ch = await q.one('SELECT ruleset_id, hidden FROM characters WHERE id = $1', [characterId]);
  if (!ch || ch.ruleset_id === null) return;
  for (const period of PERIODS) {
    const start = periodStart(period, now());
    const base = await q.one('SELECT 1 AS x FROM period_baselines WHERE period = $1 AND period_start = $2 AND character_id = $3', [period, start, characterId]);
    if (!base) continue;
    await q.query('DELETE FROM stat_gains WHERE period = $1 AND period_start = $2 AND character_id = $3', [period, start, characterId]);
    await q.query(
      `INSERT INTO stat_gains (period, period_start, statistic_id, ruleset_id, character_id, hidden, gain)
       SELECT $1, $2, cs.statistic_id, $4, $3, $5, cs.value - coalesce(b.value, 0)
         FROM character_statistics cs
         LEFT JOIN (SELECT unnest(stat_ids) AS id, unnest(stat_values) AS value FROM period_baselines
                     WHERE period = $1 AND period_start = $2 AND character_id = $3) b ON b.id = cs.statistic_id
        WHERE cs.character_id = $3 AND cs.value - coalesce(b.value, 0) > 0`,
      [period, start, characterId, ch.ruleset_id, ch.hidden],
    );
  }
}

/** Hides or shows a character everywhere it is ranked. */
export async function setHidden(q, characterId, hidden) {
  await q.query('UPDATE characters SET hidden = $2 WHERE id = $1', [characterId, hidden]);
  await q.query('UPDATE character_statistics SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
  await q.query('UPDATE stat_gains SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
  await q.query('UPDATE period_baselines SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
}
