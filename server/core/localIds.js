import { versionById } from './gameVersions.js';

/**
 * Everstats' ids (0.10.0). On the NATIVE version (gameVersions.js `nativeIds`, the one whose rows predate 0.10.0)
 * Everstats' id for a character, guild, realm category or statistic IS Blizzard's id: nothing that existed moved, and
 * every foreign key, URL, pin, award and snapshot keeps meaning what it meant.
 *
 * Every other version's Blizzard ids are mapped to ids allocated from their own sequences (migration 027), recorded in
 * blizzard_ids. The ranges never meet: a Retail character can't share an id with a Forever one, so per-character tables
 * (statistics, snapshots, gains, tiers, collections) need no version column to stay apart.
 *
 *   localId(q, { kind, version, region, scope?, blizzardId })   → Everstats' id (allocating on first sight)
 *   localIds(q, { kind, version, region, scope?, blizzardIds }) → Map(blizzardId → id), one statement for many
 *   knownLocalId(q, …)                                          → the id, or null when never seen (no allocation)
 */
const SEQUENCES = Object.freeze({ character: 'local_character_ids', guild: 'local_guild_ids', ruleset: 'local_ruleset_ids', statistic: 'local_statistic_ids' });
// Statistic ids are the same in every region of a version (one game, one data build): region '' for them.
const regionKey = (kind, region) => (kind === 'statistic' ? '' : String(region));
const native = (version) => Boolean(versionById(version)?.nativeIds);

function check(kind, version, blizzardId) {
  if (!SEQUENCES[kind]) throw new Error(`unknown id kind ${kind}`);
  if (!versionById(version)) throw new Error(`unknown game version ${version}`);
  if (!Number.isSafeInteger(Number(blizzardId))) throw new Error(`not a Blizzard id: ${blizzardId}`);
}

export async function localIds(q, { kind, version, region, scope = '', blizzardIds }) {
  const ids = [...new Set(blizzardIds.map(Number))];
  for (const id of ids) check(kind, version, id);
  if (native(version)) return new Map(ids.map((id) => [id, id]));
  if (!ids.length) return new Map();
  const reg = regionKey(kind, region);
  // Insert the unseen ones (each takes the next id from the kind's own sequence), then read them all.
  await q.query(
    `INSERT INTO blizzard_ids (kind, game_version, region, scope, blizzard_id, local_id)
     SELECT $1, $2, $3, $4, v.id, nextval('${SEQUENCES[kind]}')
       FROM unnest($5::bigint[]) AS v(id)
      WHERE NOT EXISTS (SELECT 1 FROM blizzard_ids b WHERE b.kind = $1 AND b.game_version = $2 AND b.region = $3 AND b.scope = $4 AND b.blizzard_id = v.id)
     ON CONFLICT DO NOTHING`,
    [kind, version, reg, scope, ids],
  );
  const rows = await q.query(
    'SELECT blizzard_id, local_id FROM blizzard_ids WHERE kind = $1 AND game_version = $2 AND region = $3 AND scope = $4 AND blizzard_id = ANY($5::bigint[]) LIMIT $6',
    [kind, version, reg, scope, ids, ids.length],
  );
  return new Map(rows.map((r) => [Number(r.blizzard_id), Number(r.local_id)]));
}

export async function localId(q, { kind, version, region, scope = '', blizzardId }) {
  return (await localIds(q, { kind, version, region, scope, blizzardIds: [blizzardId] })).get(Number(blizzardId));
}

export async function knownLocalId(q, { kind, version, region, scope = '', blizzardId }) {
  check(kind, version, blizzardId);
  if (native(version)) return Number(blizzardId);
  const row = await q.one(
    'SELECT local_id FROM blizzard_ids WHERE kind = $1 AND game_version = $2 AND region = $3 AND scope = $4 AND blizzard_id = $5',
    [kind, version, regionKey(kind, region), scope, Number(blizzardId)],
  );
  return row ? Number(row.local_id) : null;
}
