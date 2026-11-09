#!/usr/bin/env node
/**
 * Measures leaderboard query times and snapshot storage at a realistic volume, in a THROWAWAY in-memory database
 * (PGlite, Postgres 17 compiled to WebAssembly, single-threaded): never the dev database, never production. The
 * characters are synthetic, made here and gone when the script ends; nothing is written anywhere.
 *
 *   node scripts/measure-boards.js [characters=10000] [statistics=112]
 *
 * PGlite is slower than a native Postgres 17 on the server, so these times are an upper bound.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
const CHARACTERS = Number(process.argv[2] ?? 10_000);
const STATISTICS = Number(process.argv[3] ?? 112);
const RULESETS = [1, 2, 3, 15];

const { createDb } = await import('../server/core/db.js');
const { prepareDatabase } = await import('../server/core/prepare.js');
const boards = await import('../server/stats/boards.js');
const { takeSnapshot } = await import('../server/crawler/store.js');

const pglite = await PGlite.create();
const port = 25_400 + Math.floor(Math.random() * 1000);
const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 8 });
await server.start();
const db = createDb({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 4 });
await prepareDatabase(db, { processName: 'measure', production: false });

const t0 = performance.now();
for (const id of RULESETS) await db.query('INSERT INTO rulesets (id, name, listed) VALUES ($1, $2, true)', [id, `Synthetic ruleset ${id}`]);
await db.query(`INSERT INTO statistics (id, name) SELECT g, 'Synthetic statistic ' || g FROM generate_series(1, $1) g`, [STATISTICS]);
await db.query(
  `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, last_checked_at)
   SELECT g, 'synthetic' || g || '-measure', 'Synthetic' || g, 'Measure', ($2::int[])[1 + (g % 4)], 10 + (g % 50), 'ok', 'lookup', now(), now(), now()
     FROM generate_series(1, $1) g`,
  [CHARACTERS, RULESETS],
);
// Each character has each statistic with probability 0.6 (Blizzard lists only what a character has), values skewed
// (most small, a few large), and many ties at small values, like the real samples.
await db.query(
  `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
   SELECT c.id, s.g, c.ruleset_id, floor(power(random(), 3) * (10 + s.g * 50)), now()
     FROM characters c CROSS JOIN generate_series(1, $1) s(g) WHERE random() < 0.6`,
  [STATISTICS],
);
await db.query('ANALYZE');
const rows = (await db.one('SELECT count(*)::int AS n FROM character_statistics')).n;
console.log(`Synthetic data: ${CHARACTERS.toLocaleString()} characters × ${STATISTICS} statistics → ${rows.toLocaleString()} value rows (${Math.round(performance.now() - t0)} ms to load)`);

async function time(label, fn, runs = 7) {
  const ms = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    out = await fn();
    ms.push(performance.now() - s);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(64)} median ${ms[Math.floor(runs / 2)].toFixed(1)} ms   (min ${ms[0].toFixed(1)}, max ${ms.at(-1).toFixed(1)})`);
  return out;
}

const STAT = Math.ceil(STATISTICS / 2);
const RS = 2;
console.log('\nQuery times:');
await time('board counts for one ruleset, every statistic (character page, index)', () => boards.boardCounts(db, RS));
await time('counts for one board (board page, pins)', () => boards.statCounts(db, { statisticId: STAT, rulesetId: RS }));
const first = await time('board page 1 (25 rows, shared ranks)', () => boards.boardPage(db, { statisticId: STAT, rulesetId: RS, limit: 25 }));
let cursor = first.next;
for (let i = 0; i < 19 && cursor; i++) cursor = (await boards.boardPage(db, { statisticId: STAT, rulesetId: RS, limit: 25, cursor })).next;
await time('board page 21 (cursor, rows 501–525)', () => boards.boardPage(db, { statisticId: STAT, rulesetId: RS, limit: 25, cursor }));
await time('one character: rank on every board of its ruleset', () => boards.characterRanks(db, 4242, RS));
await time('leaderboards index: top 3 of every board on a ruleset', () => db.query(
  `SELECT s.id, t.character_id, t.value FROM unnest($1::bigint[]) AS s(id)
    CROSS JOIN LATERAL (SELECT character_id, value FROM character_statistics WHERE statistic_id = s.id AND ruleset_id = $2 AND NOT hidden AND value > 0
                        ORDER BY value DESC, character_id LIMIT 3) t`,
  [Array.from({ length: STATISTICS }, (_, i) => i + 1), RS],
));
await time('rank of one value (pins, "your characters on this board")', () => boards.rankOn(db, { characterId: 4242, statisticId: STAT, rulesetId: RS }));

console.log('\nSnapshot storage:');
const s0 = performance.now();
for (let id = 1; id <= CHARACTERS; id++) await takeSnapshot(db, id);
const snap = await db.one(`SELECT count(*)::int AS n, pg_total_relation_size('character_snapshots') AS total, pg_relation_size('character_snapshots') AS heap,
                                  avg(pg_column_size(s.*))::int AS row_bytes, avg(array_length(stat_ids, 1))::int AS stats_per_row
                             FROM character_snapshots s`);
console.log(`${snap.n.toLocaleString()} snapshots (one day) in ${Math.round(performance.now() - s0)} ms: ${snap.stats_per_row} statistics per character on average`);
console.log(`  table + primary key: ${(snap.total / 1024 / 1024).toFixed(1)} MB → ${Math.round(snap.total / snap.n)} bytes per character per day (row alone: ${snap.row_bytes} bytes)`);
console.log(`  → ${((snap.total / snap.n) * 365 / 1024).toFixed(0)} KB per character per year; ${((snap.total * 365) / 1024 / 1024 / 1024).toFixed(2)} GB per year for ${CHARACTERS.toLocaleString()} characters`);

await db.close();
await server.stop();
await pglite.close();
