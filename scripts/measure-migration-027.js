#!/usr/bin/env node
/**
 * Measures migration 027 (0.10.0: game versions and regions) on REAL-SHAPED data, in a THROWAWAY in-memory database
 * (PGlite, Postgres 17 compiled to WebAssembly, single-threaded): never the dev database, never production. Every row
 * is synthetic, made here and gone when the script ends. It migrates to 026, fills the tables at the live site's shape
 * (scaled by the argument), takes a fingerprint of every table 027 must NOT change, times 027 alone, then checks:
 *   - every character, guild, ruleset and statistic is Forever / US with blizzard_id = id (and no realm);
 *   - the tables 027 doesn't touch (statistics values, snapshots, baselines, gains, tiers) are byte-for-byte the same;
 *   - the same slug can now exist on a second version (the new unique key), and an old crawl_queue key still works.
 *
 *   node scripts/measure-migration-027.js [characters=5000] [statsPerCharacter=300] [snapshotDays=29]
 *
 * PGlite is slower than the server's native Postgres 17, so the time is an upper bound.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
const CHARACTERS = Number(process.argv[2] ?? 5000);
const PER = Number(process.argv[3] ?? 300);
const DAYS = Number(process.argv[4] ?? 29);
const STATISTICS = 1200;
const GUILDS = Math.max(10, Math.round(CHARACTERS / 9));

const { createDb } = await import('../server/core/db.js');
const { runMigrations } = await import('../server/core/migrations.js');
const { migrations } = await import('../server/core/schema.js');

const pglite = await PGlite.create();
const port = 26_400 + Math.floor(Math.random() * 1000);
const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 8 });
await server.start();
const db = createDb({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 2 });
const log = console.log;
console.log = () => {};
const i027 = migrations.findIndex((m) => m.id === '027_game_versions');
await runMigrations(db, migrations.slice(0, i027));
console.log = log;

const t0 = performance.now();
for (const id of [1, 2, 3, 15]) await db.query("INSERT INTO rulesets (id, name, listed) VALUES ($1, 'Synthetic ruleset', true)", [id]);
await db.query("INSERT INTO statistics (id, name, category_path) SELECT g, 'Synthetic statistic ' || g, '[]' FROM generate_series(1, $1) g", [STATISTICS]);
await db.query("INSERT INTO statistics (id, name, category_path, derived) SELECT 2000000000 + g, 'Synthetic count ' || g, '[]', 'synthetic-' || g FROM generate_series(1, 14) g");
await db.query("INSERT INTO guilds (id, slug, name, ruleset_id) SELECT 900000 + g, 'synthetic-guild-' || g, 'Synthetic Guild', 2 FROM generate_series(1, $1) g", [GUILDS]);
await db.query(
  `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, last_checked_at, guild_id)
   SELECT 10000000 + g, 'synthetic' || g || '-measure', 'Synthetic', 'Measure', (ARRAY[1,2,3,15])[1 + g % 4], 10 + g % 50, 'ok', 'lookup', now(), now(), now(), 900001 + g % $2
     FROM generate_series(1, $1) g`,
  [CHARACTERS, GUILDS],
);
await db.query(
  `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
   SELECT c.id, s, c.ruleset_id, (c.id * s) % 997 + 1, now() FROM characters c, generate_series(1, $1) s`,
  [PER],
);
for (let d = 0; d < DAYS; d++) {
  await db.query(
    `INSERT INTO character_snapshots (character_id, day, taken_at, level, stat_ids, stat_values)
     SELECT c.id, (now() - ($1 || ' days')::interval)::date, now() - ($1 || ' days')::interval, c.level,
            (SELECT array_agg(s ORDER BY s) FROM generate_series(1, $2) s), (SELECT array_agg(((c.id * s) % 997 + 1)::float8 ORDER BY s) FROM generate_series(1, $2) s)
       FROM characters c`,
    [String(d), PER],
  );
}
await db.query(
  `INSERT INTO stat_gains (period, period_start, statistic_id, ruleset_id, character_id, hidden, gain)
   SELECT 'week', date_trunc('week', now()), s, c.ruleset_id, c.id, false, s FROM characters c, generate_series(1, 40) s`,
);
await db.query("INSERT INTO crawl_queue (kind, key, mode, priority) SELECT 'character', slug, 'check', 4 FROM characters LIMIT 2000");
await db.query("INSERT INTO item_media (item_id, state, icon_url) SELECT g, 'ok', NULL FROM generate_series(1, 6000) g");
await db.query("INSERT INTO collection_catalog (kind, id, name, data) SELECT 'appearance', g, 'Synthetic', '{}' FROM generate_series(1, 60000) g");
await db.query("INSERT INTO collection_catalog_state (kind, state) VALUES ('appearance', 'ok'), ('mount', 'ok'), ('namespace', 'ok')");
await db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision) SELECT g, 'category', '\"Combat\"', 'approved' FROM generate_series(1, 400) g");
const fillMs = performance.now() - t0;

const fingerprint = async () => {
  const out = {};
  for (const [t, cols] of [
    ['character_statistics', 'character_id, statistic_id, ruleset_id, value'],
    ['character_snapshots', 'character_id, day, stat_ids, stat_values'],
    ['stat_gains', 'period, period_start, statistic_id, character_id, gain'],
    ['period_baselines', 'period, period_start, character_id, stat_ids'],
    ['character_tiers', 'character_id, letter, score'],
  ]) {
    out[t] = (await db.one(`SELECT count(*)::bigint AS n, md5(coalesce(string_agg(row(${cols})::text, '|' ORDER BY ${cols.split(',')[0]}, ${cols.split(',')[1]}), '')) AS h FROM ${t}`));
  }
  return out;
};
const before = await fingerprint();
const sizes = await db.query(
  `SELECT relname AS t, pg_total_relation_size(c.oid) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY bytes DESC LIMIT 8`,
);

const t1 = performance.now();
console.log = () => {};
await runMigrations(db, migrations.slice(0, i027 + 1));
console.log = log;
const migrateMs = performance.now() - t1;

const after = await fingerprint();
const checks = {
  untouched: JSON.stringify(before) === JSON.stringify(after),
  charactersForeverUs: (await db.one("SELECT count(*)::int AS n FROM characters WHERE game_version = 'forever' AND region = 'us' AND blizzard_id = id AND realm_slug IS NULL")).n === CHARACTERS,
  guilds: (await db.one("SELECT count(*)::int AS n FROM guilds WHERE game_version = 'forever' AND blizzard_id = id")).n === GUILDS,
  statistics: (await db.one("SELECT count(*)::int AS n FROM statistics WHERE game_version = 'forever' AND ((derived IS NULL AND blizzard_id = id) OR (derived IS NOT NULL AND source = 'collections'))")).n === STATISTICS + 14,
  queueKept: (await db.one("SELECT count(*)::int AS n FROM crawl_queue WHERE game_version = 'forever' AND region = 'us'")).n === Math.min(2000, CHARACTERS),
};
// The same slug on a second version: allowed now.
await db.query("INSERT INTO characters (id, slug, name, profile_state, source, game_version, region, realm_slug, blizzard_id) VALUES (1000000000000001, 'synthetic1-measure', 'X', 'not_found', 'lookup', 'retail', 'us', 'area-52', 10000001)");
checks.sameSlugOtherVersion = true;
await db.query("DELETE FROM characters WHERE game_version = 'retail'");

// The rollback (scripts/rollback-027.sql): 0.9.2's own statements must work again, nothing it keeps may change, and 027
// must apply cleanly a second time.
const { readFileSync } = await import('node:fs');
const t2 = performance.now();
await db.query(readFileSync(new URL('./rollback-027.sql', import.meta.url), 'utf8'));
const rollbackMs = performance.now() - t2;
await db.query("INSERT INTO crawl_queue (kind, key, mode, priority) VALUES ('character', 'synthetic1-measure', 'full', 1) ON CONFLICT (kind, key) WHERE state IN ('queued', 'running') DO UPDATE SET priority = 1");
await db.query("INSERT INTO item_media (item_id, state) VALUES (1, 'ok') ON CONFLICT (item_id) DO UPDATE SET state = 'ok'");
await db.query("INSERT INTO collection_catalog (kind, id, name, data) VALUES ('appearance', 1, 'x', '{}') ON CONFLICT (kind, id) DO NOTHING");
await db.query("INSERT INTO collection_catalog_state (kind, state) VALUES ('mount', 'ok') ON CONFLICT (kind) DO NOTHING");
checks.rollbackKeepsData = JSON.stringify(await fingerprint()) === JSON.stringify(before);
console.log = () => {};
await runMigrations(db, migrations.slice(0, i027 + 1));
console.log = log;
checks.reapplies = (await db.one("SELECT count(*)::int AS n FROM characters WHERE game_version = 'forever' AND blizzard_id = id")).n === CHARACTERS;
checks.rollbackMs = Math.round(rollbackMs);

console.log(JSON.stringify({
  characters: CHARACTERS, statisticsPerCharacter: PER, snapshotDays: DAYS, guilds: GUILDS,
  rows: { character_statistics: Number(before.character_statistics.n), character_snapshots: Number(before.character_snapshots.n), stat_gains: Number(before.stat_gains.n) },
  largestTables: sizes.map((s) => ({ table: s.t, mb: Math.round(Number(s.bytes) / 1e5) / 10 })),
  fillSeconds: Math.round(fillMs / 100) / 10,
  migration027Ms: Math.round(migrateMs),
  checks,
}, null, 2));
await db.close?.();
await server.stop();
await pglite.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
