#!/usr/bin/env node
/**
 * Measures the letter tiers (0.6.0) at a realistic volume, in a THROWAWAY database: by default an in-memory PGlite
 * (Postgres 17 compiled to WebAssembly, single-threaded), never the dev database, never production. The characters,
 * values and decisions are synthetic, made here and gone when the script ends.
 *
 *   node scripts/measure-tiers.js [characters=10000] [statistics=112]
 *   MEASURE_DATABASE_URL=postgres://… node scripts/measure-tiers.js     a scratch database you made for this (it is
 *                                                                       filled with synthetic rows: never a real one)
 *
 * It times: a full grading of the ruleset (load, compute, write), the compute alone (the admin preview), one
 * character graded on its own (what follows every fetch), the character page's tier block, a tier board page and a
 * category board page. PGlite is slower than a native Postgres 17, so its times are an upper bound.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
process.env.PUBLIC_ORIGIN ??= 'http://localhost:3000';
const CHARACTERS = Number(process.argv[2] ?? 10_000);
const STATISTICS = Number(process.argv[3] ?? 112);
const RS = 2;

const { createDb } = await import('../server/core/db.js');
const { prepareDatabase } = await import('../server/core/prepare.js');
const { gradeAll, gradeCharacter, previewTiers, tierSettings } = await import('../server/tiers/store.js');
const { characterTierView, tierBoard } = await import('../server/tiers/view.js');

let pglite = null;
let socket = null;
let url = process.env.MEASURE_DATABASE_URL;
if (!url) {
  pglite = await PGlite.create();
  const port = 25_400 + Math.floor(Math.random() * 1000);
  socket = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 8 });
  await socket.start();
  url = `postgres://postgres@127.0.0.1:${port}/postgres`;
}
const db = createDb({ url, max: 4 });
await prepareDatabase(db, { processName: 'measure', production: false });

// Blizzard's top-level categories, so the real suggestion rules sort them (Deaths → bad, Social → farmable).
const PATHS = ['Kills', 'Quests', 'Travel', 'Skills', 'Dungeons & Raids', 'Character', 'Player vs. Player', 'Social', 'Deaths'];
const t0 = performance.now();
await db.query("INSERT INTO rulesets (id, name, listed) VALUES ($1, 'Synthetic ruleset', true)", [RS]);
await db.query(
  `INSERT INTO statistics (id, name, category_path)
   SELECT g, 'Synthetic statistic ' || g, jsonb_build_array(jsonb_build_object('id', 1, 'name', ($2::text[])[1 + g % array_length($2::text[], 1)]))
     FROM generate_series(1, $1) g`,
  [STATISTICS, PATHS],
);
await db.query(
  `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, last_checked_at, data_fetched_at)
   SELECT c, 'synthetic' || c || '-measure', 'Synthetic' || c, 'Measure', $2, 10 + (c % 50), 'ok', 'guild', now(), now(), now(), now()
     FROM generate_series(1, $1) c`,
  [CHARACTERS, RS],
);
await db.query(
  `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
   SELECT c.id, s.g, c.ruleset_id, 1 + floor(power(random(), 3) * (10 + s.g * 50)), now()
     FROM characters c CROSS JOIN generate_series(1, $1) s(g) WHERE random() < 0.6`,
  [STATISTICS],
);
// The owner's decisions, as if every suggestion had been approved: category + what it counts toward.
const { loadCatalogFresh } = await import('../server/stats/catalog.js');
const catalog = await loadCatalogFresh(db);
for (const s of catalog.statistics.values()) {
  await db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision) VALUES ($1, 'category', $2::jsonb, 'approved')", [s.id, JSON.stringify(s.category)]);
  await db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision) VALUES ($1, 'grading', $2::jsonb, 'approved')", [s.id, JSON.stringify(s.grading)]);
}
const values = (await db.one('SELECT count(*)::int AS n FROM character_statistics')).n;
console.log(`[measure] ${CHARACTERS} characters, ${STATISTICS} statistics, ${values} values, set up in ${Math.round(performance.now() - t0)} ms`);

const time = async (label, fn, runs = 1) => {
  const ms = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    out = await fn();
    ms.push(performance.now() - s);
  }
  ms.sort((a, b) => a - b);
  console.log(`[measure] ${label}: ${runs === 1 ? `${Math.round(ms[0])} ms` : `median ${Math.round(ms[Math.floor(ms.length / 2)])} ms, worst ${Math.round(ms.at(-1))} ms (${runs} runs)`}`);
  return out;
};

const full = await time('full grading (load + compute + write)', () => gradeAll(db));
console.log(`[measure]   counted statistics: ${full.counted}; overall letters: ${JSON.stringify(full.rulesets[0].distribution?.overall)}`);
await time('full grading again (rows replaced)', () => gradeAll(db));
const settings = await tierSettings(db);
await time('admin preview (load + compute, nothing written)', () => previewTiers(db, settings));
const ids = (await db.query('SELECT id FROM characters ORDER BY random() LIMIT 20')).map((r) => Number(r.id));
let k = 0;
await time('one character graded on its own (after its fetch)', () => gradeCharacter(db, ids[k++ % ids.length]), 20);
const rows = await db.query('SELECT * FROM characters WHERE id = ANY($1::bigint[])', [ids]);
let j = 0;
await time('character page tier block', () => characterTierView(db, rows[j++ % rows.length]), 20);
await time('tier board, first page (50)', () => tierBoard(db, { rulesetId: RS, scope: 'overall', limit: 50 }), 10);
const key = full.rulesets[0].distribution ? Object.keys(full.rulesets[0].distribution).find((x) => x !== 'overall') : null;
if (key) await time(`category board "${key}", first page (50)`, () => tierBoard(db, { rulesetId: RS, scope: key, limit: 50 }), 10);

await db.close();
if (socket) await socket.stop();
if (pglite) await pglite.close();
