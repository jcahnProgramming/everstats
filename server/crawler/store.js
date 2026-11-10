import { recordStatistics } from '../stats/catalog.js';
import { ROLLING_START, periodStart, utcDay } from '../stats/periods.js';
import { retentionPolicy } from '../retention/policy.js';
import { EQUIPMENT_VERSION } from './parse.js';
import { DERIVED_BASE } from '../collections/registry.js';
import { PRIMARY_SCOPE } from '../core/config.js';
import { localId, localIds } from '../core/localIds.js';

/**
 * Writing what the crawler fetched. Parsed values only (crawler/parse.js): never a raw body.
 * Every function takes `q` (a transaction from db.tx) so a character's update lands whole or not at all.
 *
 * 0.10.0: every write is for one SCOPE { version, region } (default the primary: the existing pages). Ids that arrive
 * here are BLIZZARD's (a profile's id, a guild's, a ruleset's); each is mapped to Everstats' id (core/localIds.js:
 * the same number on the native version) and the function returns that id. A realm version's character and guild also
 * keep their realm slug, and the same slug on two realms or two versions never collides (characters_slug).
 */
const MAX_STATS_PER_CHARACTER = 5000;
const scopeOf = (scope) => ({ version: scope?.version ?? PRIMARY_SCOPE.version, region: scope?.region ?? PRIMARY_SCOPE.region });

/** A ruleset Blizzard named (id + name). → Everstats' id for it (a realm category of this version and region). */
export async function upsertRuleset(q, r, { listed = null, scope = null } = {}) {
  if (!r || !Number.isInteger(r.id)) return null;
  const s = scopeOf(scope);
  const id = await localId(q, { kind: 'ruleset', version: s.version, region: s.region, blizzardId: r.id });
  await q.query(
    `INSERT INTO rulesets (id, name, listed, game_version, region, blizzard_id) VALUES ($1, $2, coalesce($3, false), $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, listed = coalesce($3, rulesets.listed), updated_at = now()`,
    [id, String(r.name).slice(0, 60), listed, s.version, s.region, r.id],
  );
  return id;
}

/**
 * A realm category with no Blizzard id: a realm TYPE ("NORMAL", "PVP" …) on a version whose categories are realm types
 * (gameVersions.js realmCategory.source 'realm-type'). → Everstats' id for it.
 */
export async function upsertRealmCategory(q, { key, name }, { scope }) {
  const s = scopeOf(scope);
  const k = String(key).slice(0, 40);
  const known = await q.one('SELECT id FROM rulesets WHERE game_version = $1 AND region = $2 AND category_key = $3', [s.version, s.region, k]);
  if (known) {
    await q.query('UPDATE rulesets SET name = $2, updated_at = now() WHERE id = $1', [known.id, String(name ?? k).slice(0, 60)]);
    return known.id;
  }
  const row = await q.one(
    `INSERT INTO rulesets (id, name, listed, game_version, region, category_key) VALUES (nextval('local_ruleset_ids'), $1, true, $2, $3, $4)
     ON CONFLICT (game_version, region, category_key) WHERE category_key IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id`,
    [String(name ?? k).slice(0, 60), s.version, s.region, k],
  );
  return row.id;
}

/** `rulesetId` is already Everstats' id. → Everstats' id for the guild. */
export async function upsertGuild(q, g, rulesetId, { scope = null, realmSlug = null } = {}) {
  if (!g || !Number.isFinite(g.id) || !g.slug) return null;
  const s = scopeOf(scope);
  const id = await localId(q, { kind: 'guild', version: s.version, region: s.region, blizzardId: g.id });
  const slug = g.slug.toLowerCase();
  await q.query(
    `INSERT INTO guilds (id, slug, name, faction, ruleset_id, game_version, region, realm_slug, blizzard_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, faction = coalesce(EXCLUDED.faction, guilds.faction),
       ruleset_id = coalesce(EXCLUDED.ruleset_id, guilds.ruleset_id), realm_slug = coalesce(EXCLUDED.realm_slug, guilds.realm_slug), updated_at = now()`,
    [id, slug, g.name, g.faction, rulesetId, s.version, s.region, realmSlug, g.id],
  );
  // 0.5.0: every slug a guild is seen with, so /g/{old-slug} redirects to it (by id) after a rename.
  await q.query(
    `INSERT INTO guild_slugs (slug, guild_id) VALUES ($1, $2) ON CONFLICT (slug, guild_id) DO UPDATE SET seen_at = now()`,
    [slug, id],
  );
  return id;
}

/** A guild's totals need rebuilding (a member changed, joined or left): the worker's guild-totals job picks it up. */
export async function markGuildsDirty(q, ids) {
  const list = [...new Set(ids.filter((x) => x !== null && x !== undefined))];
  if (!list.length) return;
  await q.query('UPDATE guilds SET totals_dirty_at = now() WHERE id = ANY($1::bigint[])', [list]);
}

/**
 * The guild profile (200): header fields. The slug Blizzard answers with is the current one. `rulesetId` (Everstats')
 * overrides the profile's ruleset: a realm version's guild is graded within its realm's category. → Everstats' guild id.
 */
export async function storeGuildProfile(q, gp, { scope = null, rulesetId = undefined } = {}) {
  const category = rulesetId !== undefined ? rulesetId : await upsertRuleset(q, gp.ruleset, { scope });
  const id = await upsertGuild(q, { id: gp.id, slug: gp.slug, name: gp.name, faction: gp.faction }, category ?? null, { scope, realmSlug: gp.realm?.slug ?? null });
  await q.query(
    `UPDATE guilds SET profile_state = 'ok', profile_fetched_at = now(), member_count = $2, created_at_blizzard = $3 WHERE id = $1`,
    [id, gp.memberCount, gp.createdAt],
  );
  return id;
}

/**
 * The roster: replaces the guild's guild_roster rows (ids, rank numbers, levels; no names). `guildId` is Everstats';
 * member ids are Blizzard's and are mapped here (a member never fetched still gets its Everstats id, so a later fetch
 * finds it on the roster). → the members with `localId` added.
 */
export async function storeRoster(q, guildId, members, { scope = null } = {}) {
  const s = scopeOf(scope);
  await q.query('DELETE FROM guild_roster WHERE guild_id = $1', [guildId]);
  const seen = new Set();
  const list = members.filter((m) => !seen.has(m.id) && seen.add(m.id));
  const ids = await localIds(q, { kind: 'character', version: s.version, region: s.region, blizzardIds: list.map((m) => m.id) });
  for (const m of list) m.localId = ids.get(Number(m.id));
  if (list.length) {
    await q.query(
      `INSERT INTO guild_roster (guild_id, character_id, rank, level, fetched_at)
       SELECT $1, v.id, v.rank, v.level, now() FROM unnest($2::bigint[], $3::smallint[], $4::smallint[]) AS v(id, rank, level)`,
      [guildId, list.map((m) => m.localId), list.map((m) => m.rank), list.map((m) => (Number.isInteger(m.level) ? Math.min(m.level, 32767) : null))],
    );
  }
  await q.query('UPDATE guilds SET roster_checked_at = now(), roster_members = $2 WHERE id = $1', [guildId, list.length]);
  return list;
}

/** Frees a slug another character of the same version, region and realm held (Blizzard gave it to someone else). */
async function releaseSlug(q, s, realmSlug, slug, id) {
  await q.query(
    `UPDATE characters SET slug = NULL WHERE game_version = $1 AND region = $2 AND coalesce(realm_slug, '') = coalesce($3, '') AND slug = $4 AND id <> $5`,
    [s.version, s.region, realmSlug, slug, id],
  );
}

/** A character Blizzard named somewhere (an account list, a roster) without its profile: tracked as known. */
export async function upsertKnown(q, c, { source, ownerAccountId = null, scope = null }) {
  const s = scopeOf(scope);
  const id = await localId(q, { kind: 'character', version: s.version, region: s.region, blizzardId: c.id });
  const realmSlug = c.realmSlug ?? null;
  await releaseSlug(q, s, realmSlug, c.slug, id);
  return q.one(
    `INSERT INTO characters (id, slug, name, surname, faction, race, class, gender, level, account_level, profile_state, source, owner_account_id, owned_since, data_fetched_at,
                             game_version, region, realm_slug, blizzard_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'not_found', $11, $12, CASE WHEN $12::bigint IS NULL THEN NULL ELSE now() END, now(), $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug, name = EXCLUDED.name, surname = EXCLUDED.surname, realm_slug = coalesce(EXCLUDED.realm_slug, characters.realm_slug),
       faction = coalesce(characters.faction, EXCLUDED.faction), race = coalesce(characters.race, EXCLUDED.race),
       class = coalesce(characters.class, EXCLUDED.class), gender = coalesce(characters.gender, EXCLUDED.gender),
       level = GREATEST(characters.level, EXCLUDED.level),
       account_level = coalesce(EXCLUDED.account_level, characters.account_level),
       owner_account_id = coalesce(EXCLUDED.owner_account_id, characters.owner_account_id),
       owned_since = CASE WHEN EXCLUDED.owner_account_id IS NOT NULL AND characters.owner_account_id IS DISTINCT FROM EXCLUDED.owner_account_id THEN now() ELSE characters.owned_since END,
       -- Listed on its owner's Battle.net account: Blizzard returned it (a purged stub comes back as known).
       data_fetched_at = now(), purged_at = NULL,
       profile_state = CASE WHEN characters.profile_state = 'purged' THEN 'not_found' ELSE characters.profile_state END
     RETURNING id, profile_state, last_checked_at, stats_fetched_at`,
    [id, c.slug, c.name, c.surname ?? '', c.faction ?? null, c.race ?? null, c.class ?? null, c.gender ?? null, c.level ?? null,
      source === 'account' ? c.level ?? null : null, source, ownerAccountId, s.version, s.region, realmSlug, c.id],
  );
}

/**
 * The profile (200). `p.id` is Blizzard's. `rulesetId` (Everstats') is the realm category when the caller resolved it
 * (a realm version: its realm's type); else the profile's own ruleset. → { id (Everstats'), previous, guildId }
 */
export async function storeProfile(q, p, { source, scope = null, rulesetId = undefined, realmType = null }) {
  const s = scopeOf(scope);
  const id = await localId(q, { kind: 'character', version: s.version, region: s.region, blizzardId: p.id });
  const previous = await q.one('SELECT id, ruleset_id, guild_id, hidden, login_at_full, last_fetched_at, media_state FROM characters WHERE id = $1 FOR UPDATE', [id]);
  const category = rulesetId !== undefined ? rulesetId : await upsertRuleset(q, p.ruleset, { scope: s });
  const guildId = await upsertGuild(q, p.guild, category ?? null, { scope: s, realmSlug: p.guild?.realm?.slug ?? null });
  const realmSlug = p.realm?.slug ?? null;
  if (p.slug) await releaseSlug(q, s, realmSlug, p.slug, id);
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, race, class, gender, level, guild_id, last_login_at, profile_state, last_checked_at, source, data_fetched_at,
                             game_version, region, realm_slug, blizzard_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ok', now(), $13, now(), $14, $15, $16, $17)
     ON CONFLICT (id) DO UPDATE SET
       slug = coalesce(EXCLUDED.slug, characters.slug), name = EXCLUDED.name, surname = EXCLUDED.surname,
       ruleset_id = coalesce(EXCLUDED.ruleset_id, characters.ruleset_id), faction = EXCLUDED.faction, race = EXCLUDED.race,
       class = EXCLUDED.class, gender = EXCLUDED.gender, level = EXCLUDED.level, guild_id = EXCLUDED.guild_id,
       realm_slug = coalesce(EXCLUDED.realm_slug, characters.realm_slug),
       last_login_at = EXCLUDED.last_login_at, profile_state = 'ok', last_checked_at = now(),
       data_fetched_at = now(), missing_since = NULL, purged_at = NULL`,
    [id, p.slug, p.name, p.surname, category ?? null, p.faction, p.race, p.class, p.gender, p.level, guildId, p.lastLoginAt, source, s.version, s.region, realmSlug, p.id],
  );
  // 0.11.1: the realm's type (NORMAL, RP …) on the character: a board filter on a one-pool version, never a pool.
  if (realmType) await q.query('UPDATE characters SET realm_type = $2 WHERE id = $1 AND realm_type IS DISTINCT FROM $2', [id, String(realmType).slice(0, 40)]);
  // A ruleset change (a transfer, if Forever ever has them): every ranked copy follows the character.
  if (previous && category && previous.ruleset_id !== null && previous.ruleset_id !== category) {
    await q.query('UPDATE character_statistics SET ruleset_id = $2 WHERE character_id = $1', [id, category]);
  }
  // 0.5.0: its guild's totals (and its old guild's, after a move) are rebuilt from the new values by the worker.
  await markGuildsDirty(q, [guildId, previous?.guild_id]);
  return { id, previous, guildId };
}

/** The 404 case: a character whose profile Blizzard doesn't serve (yet). `ref` is { slug, realmSlug? }. */
export async function markProfileMissing(q, ref, { scope = null } = {}) {
  const s = scopeOf(scope);
  const { slug, realmSlug = null } = typeof ref === 'string' ? { slug: ref } : ref;
  // 0.4.2: a character Blizzard returned before and now doesn't (404: private, deleted, or not served for now) is
  // "missing": its current values come off every board and page at once (never shown as current when Blizzard no
  // longer returns them), and it is retried on the normal schedule. data_fetched_at keeps the date of the last success;
  // past the retention window the sweep strips its Blizzard data (retention/registry.js). One never fetched is
  // simply not found.
  const row = await q.one(
    `SELECT id, stats_fetched_at, guild_id FROM characters
      WHERE game_version = $1 AND region = $2 AND coalesce(realm_slug, '') = coalesce($3, '') AND slug = $4`,
    [s.version, s.region, realmSlug, slug],
  );

  if (!row) return;
  await markGuildsDirty(q, [row.guild_id]);
  if (row.stats_fetched_at) {
    await q.query('DELETE FROM character_statistics WHERE character_id = $1', [row.id]);
    await q.query('DELETE FROM stat_gains WHERE character_id = $1', [row.id]);
    // 0.6.0: and off the tier boards (its tier was graded from those values).
    await q.query('DELETE FROM character_category_tiers WHERE character_id = $1', [row.id]);
    await q.query('DELETE FROM character_tiers WHERE character_id = $1', [row.id]);
  }
  await q.query(
    `UPDATE characters SET last_checked_at = now(), missing_since = CASE WHEN stats_fetched_at IS NOT NULL THEN coalesce(missing_since, now()) ELSE missing_since END,
       profile_state = CASE WHEN stats_fetched_at IS NULL AND profile_state <> 'purged' THEN 'not_found' ELSE profile_state END
      WHERE id = $1`,
    [row.id],
  );
}

/**
 * Statistics, gear, attributes and media from a full fetch. `stats` null means the statistics endpoint didn't answer
 * (the old values stay, honestly dated by stats_fetched_at). media: { state: 'ok' | 'not_ready' | 'failed', assets }.
 */
export async function storeDetails(q, characterId, { stats, attributes, equipment, media, loginAt }) {
  const ch = await q.one('SELECT ruleset_id, hidden, game_version FROM characters WHERE id = $1', [characterId]);
  if (stats && ch.ruleset_id !== null) {
    // 0.10.0: Blizzard's statistic ids → Everstats' for the character's version (the same number on the native one).
    const ids = await recordStatistics(q, stats, { version: ch.game_version });
    const list = stats.slice(0, MAX_STATS_PER_CHARACTER).map((x) => ({ ...x, id: ids.get(Number(x.id)) })).filter((x) => Number.isSafeInteger(x.id));
    // 0.9.0: statistics Everstats counts from collections (ids from DERIVED_BASE) aren't in Blizzard's list: they stay.
    await q.query('DELETE FROM character_statistics WHERE character_id = $1 AND statistic_id < $3 AND NOT (statistic_id = ANY($2::bigint[]))', [characterId, list.map((s) => s.id), DERIVED_BASE]);
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
       equipment_version = CASE WHEN $4::jsonb IS NULL THEN equipment_version ELSE $8 END,
       media = CASE WHEN $5 = 'ok' THEN $6::jsonb ELSE media END,
       media_state = CASE WHEN $5 = 'ok' THEN 'ok' WHEN $5 = 'not_ready' AND media_state IS DISTINCT FROM 'ok' THEN 'not_ready'
                          WHEN $5 IS NULL THEN media_state WHEN media_state = 'ok' THEN 'ok' ELSE $5 END,
       media_fetched_at = CASE WHEN $5 = 'ok' THEN now() ELSE media_fetched_at END,
       last_fetched_at = now(), first_fetched_at = coalesce(first_fetched_at, now()), login_at_full = $7
     WHERE id = $1`,
    [characterId, Boolean(stats && ch.ruleset_id !== null), attributes ? JSON.stringify(attributes) : null, equipment ? JSON.stringify(equipment) : null,
      media?.state ?? null, media?.assets ? JSON.stringify(media.assets) : null, loginAt, EQUIPMENT_VERSION],
  );
}

/** Just the media (a refresh of an unchanged character whose render wasn't ready last time). */
export async function storeMedia(q, characterId, media) {
  await storeDetails(q, characterId, { stats: null, attributes: null, equipment: null, media, loginAt: (await q.one('SELECT login_at_full FROM characters WHERE id = $1', [characterId])).login_at_full });
}

/**
 * Today's snapshot (UTC day) from the character's current values, if it has none yet: one per character per day,
 * the first of the day. The first snapshot in a week becomes that week's baseline (the rolling baseline is chosen in
 * updateGains: the oldest snapshot still kept). → true if taken.
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
  await q.query(
    `INSERT INTO period_baselines (period, period_start, character_id, ruleset_id, hidden, taken_at, stat_ids, stat_values)
     VALUES ('week', $1, $2, $3, $4, $5, $6::int[], $7::float8[]) ON CONFLICT DO NOTHING`,
    [periodStart('week', at), characterId, ch.ruleset_id, ch.hidden, at, ids, values],
  );
  return true;
}

/**
 * Rebuilds the character's gains this week and over the rolling window: current value minus the baseline, > 0 only.
 * The rolling baseline is the character's OLDEST snapshot still inside the keep window (it moves forward a day each
 * day as the sweep deletes older ones; this runs on every daily check).
 */
export async function updateGains(q, characterId, { now = Date.now } = {}) {
  const ch = await q.one('SELECT ruleset_id, hidden, collections_first_at FROM characters WHERE id = $1', [characterId]);
  if (!ch || ch.ruleset_id === null) return;
  const { cutoff } = await retentionPolicy(q, now());
  const oldest = await q.one(
    'SELECT taken_at, stat_ids, stat_values FROM character_snapshots WHERE character_id = $1 AND taken_at >= $2 ORDER BY taken_at LIMIT 1',
    [characterId, cutoff],
  );
  if (oldest) {
    await q.query(
      `INSERT INTO period_baselines (period, period_start, character_id, ruleset_id, hidden, taken_at, stat_ids, stat_values)
       VALUES ('rolling', $1, $2, $3, $4, $5, $6::int[], $7::float8[])
       ON CONFLICT (period, period_start, character_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, hidden = EXCLUDED.hidden,
         taken_at = EXCLUDED.taken_at, stat_ids = EXCLUDED.stat_ids, stat_values = EXCLUDED.stat_values`,
      [ROLLING_START, characterId, ch.ruleset_id, ch.hidden, oldest.taken_at, oldest.stat_ids, oldest.stat_values],
    );
  }
  for (const period of ['week', 'rolling']) {
    const start = periodStart(period, now());
    const base = await q.one('SELECT taken_at FROM period_baselines WHERE period = $1 AND period_start = $2 AND character_id = $3', [period, start, characterId]);
    if (!base) continue;
    // 0.9.0: a collection count only has a gain once its baseline was taken AFTER collections were first fetched;
    // otherwise a character's first collections fetch would read as "412 appearances gained this week".
    const derivedOk = Boolean(ch.collections_first_at && new Date(ch.collections_first_at) <= new Date(base.taken_at));
    await q.query('DELETE FROM stat_gains WHERE period = $1 AND period_start = $2 AND character_id = $3', [period, start, characterId]);
    await q.query(
      `INSERT INTO stat_gains (period, period_start, statistic_id, ruleset_id, character_id, hidden, gain)
       SELECT $1, $2, cs.statistic_id, $4, $3, $5, cs.value - coalesce(b.value, 0)
         FROM character_statistics cs
         LEFT JOIN (SELECT unnest(stat_ids) AS id, unnest(stat_values) AS value FROM period_baselines
                     WHERE period = $1 AND period_start = $2 AND character_id = $3) b ON b.id = cs.statistic_id
        WHERE cs.character_id = $3 AND cs.value - coalesce(b.value, 0) > 0
          -- 0.10.0: a feed's board (stats/feeds.js) has a gain only once its baseline already held it, so the fetch that
          -- first brings a feed value in never reads as "gained 12,000 health this week". Other derived counts: as 0.9.0.
          AND (cs.statistic_id < $6
               -- 0.11.1: a season board (stats/seasons.js) the same way: a gain only once its baseline held it.
               OR (b.id IS NOT NULL AND EXISTS (SELECT 1 FROM statistics f WHERE f.id = cs.statistic_id AND (f.derived LIKE 'feed:%' OR f.derived LIKE 'season:%')))
               OR ($7::boolean AND NOT EXISTS (SELECT 1 FROM statistics f WHERE f.id = cs.statistic_id AND (f.derived LIKE 'feed:%' OR f.derived LIKE 'season:%'))))`,
      [period, start, characterId, ch.ruleset_id, ch.hidden, DERIVED_BASE, derivedOk],
    );
  }
}

/** Hides or shows a character everywhere it is ranked. */
export async function setHidden(q, characterId, hidden) {
  const ch = await q.one('UPDATE characters SET hidden = $2 WHERE id = $1 RETURNING guild_id', [characterId, hidden]);
  await q.query('UPDATE character_statistics SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
  await q.query('UPDATE stat_gains SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
  await q.query('UPDATE period_baselines SET hidden = $2 WHERE character_id = $1', [characterId, hidden]);
  // 0.6.0: hidden, it has no tier (and is on no tier board); shown again, it is graded at once.
  const { gradeCharacter } = await import('../tiers/store.js');
  await gradeCharacter(q, characterId);
  // 0.8.0: a hidden character is on no share card from this moment: every cached image showing it goes.
  if (hidden) {
    const { forgetCharacter } = await import('../cards/store.js');
    await forgetCharacter(q, characterId);
  }
  // 0.5.0: a hidden character counts toward no guild total from this moment, so its guild is rebuilt now, in the same
  // transaction, not on the worker's next pass.
  if (ch?.guild_id !== null && ch?.guild_id !== undefined) {
    const { rebuildGuildTotals } = await import('../stats/guildTotals.js');
    await rebuildGuildTotals(q, ch.guild_id);
  }
}
