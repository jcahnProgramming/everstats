#!/usr/bin/env node
/**
 * Measures the guild pages and guild boards (0.5.0) at a realistic volume, in a THROWAWAY database: by default an
 * in-memory PGlite (Postgres 17 compiled to WebAssembly, single-threaded), never the dev database, never production.
 * The characters and guilds are synthetic, made here and gone when the script ends.
 *
 *   node scripts/measure-guilds.js [characters=10000] [guilds=500] [statistics=112]
 *   MEASURE_DATABASE_URL=postgres://… node scripts/measure-guilds.js     a scratch database you made for this (it is
 *                                                                        filled with synthetic rows: never a real one)
 *
 * It times the real HTTP routes (the web app on a local port): a guild page, its top members, a guild board (total,
 * average, weekly), the guild boards index and /guilds; and the worker's rebuild of every guild's totals. PGlite is
 * slower than a native Postgres 17, so its times are an upper bound.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
process.env.PUBLIC_ORIGIN ??= 'http://localhost:3000';
const CHARACTERS = Number(process.argv[2] ?? 10_000);
const GUILDS = Number(process.argv[3] ?? 500);
const STATISTICS = Number(process.argv[4] ?? 112);
const RS = 2;

const { createDb } = await import('../server/core/db.js');
const { prepareDatabase } = await import('../server/core/prepare.js');
const { rebuildDueGuilds } = await import('../server/stats/guildTotals.js');
const { periodStart, ROLLING_START } = await import('../server/stats/periods.js');
const { createApp } = await import('../server/app.js');

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

const t0 = performance.now();
const week = periodStart('week', Date.now());
await db.query("INSERT INTO rulesets (id, name, listed) VALUES (1, 'Synthetic ruleset 1', true), (2, 'Synthetic ruleset 2', true)");
await db.query(`INSERT INTO statistics (id, name) SELECT g, 'Synthetic statistic ' || g FROM generate_series(1, $1) g`, [STATISTICS]);
// Guild sizes skewed like real ones: a few big, many small (1 … ~120 members), all on ruleset 2.
await db.query(
  `INSERT INTO guilds (id, slug, name, faction, ruleset_id, roster_checked_at, roster_members, profile_state, profile_fetched_at, member_count)
   SELECT g, 'synthetic-guild-' || g, 'Synthetic Guild ' || g, CASE WHEN g % 2 = 0 THEN 'Horde' ELSE 'Alliance' END, $2, now(), 0, 'ok', now(), 0
     FROM generate_series(1, $1) g`,
  [GUILDS, RS],
);
await db.query(
  `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, guild_id, profile_state, source, stats_fetched_at, last_fetched_at, last_checked_at, data_fetched_at)
   SELECT c, 'synthetic' || c || '-measure', 'Synthetic' || c, 'Measure', $3, 10 + (c % 50),
          1 + floor(power(random(), 2) * $2)::int, 'ok', 'guild', now(), now(), now(), now()
     FROM generate_series(1, $1) c`,
  [CHARACTERS, GUILDS, RS],
);
await db.query(`INSERT INTO guild_roster (guild_id, character_id, rank, level, fetched_at) SELECT guild_id, id, (id % 4)::smallint, level, now() FROM characters`);
await db.query('UPDATE guilds g SET roster_members = (SELECT count(*) FROM guild_roster r WHERE r.guild_id = g.id)');
await db.query(
  `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
   SELECT c.id, s.g, c.ruleset_id, floor(power(random(), 3) * (10 + s.g * 50)), now()
     FROM characters c CROSS JOIN generate_series(1, $1) s(g) WHERE random() < 0.6`,
  [STATISTICS],
);
// A week of gains: every character has a baseline this week and in the rolling window; ~30% of values grew.
for (const [period, start] of [['week', week], ['rolling', ROLLING_START]]) {
  await db.query(
    `INSERT INTO period_baselines (period, period_start, character_id, ruleset_id, taken_at, stat_ids, stat_values)
     SELECT $1, $2, id, ruleset_id, now(), '{}', '{}' FROM characters`,
    [period, start],
  );
  await db.query(
    `INSERT INTO stat_gains (period, period_start, statistic_id, ruleset_id, character_id, gain)
     SELECT $1, $2, statistic_id, ruleset_id, character_id, 1 + floor(random() * 20) FROM character_statistics WHERE random() < 0.3`,
    [period, start],
  );
}
await db.query("INSERT INTO pipeline_facts (key, at) VALUES ('first_snapshot_at', now() - interval '40 days')");
await db.query('ANALYZE');
const rows = (await db.one('SELECT count(*)::int AS n FROM character_statistics')).n;
console.log(`Synthetic data: ${CHARACTERS.toLocaleString()} characters in ${GUILDS} guilds × ${STATISTICS} statistics → ${rows.toLocaleString()} value rows (${Math.round(performance.now() - t0)} ms to load)`);
console.log(`Database: ${pglite ? 'PGlite in memory (an upper bound)' : 'the scratch database in MEASURE_DATABASE_URL'}`);

const r0 = performance.now();
const rebuilt = await rebuildDueGuilds(db, { limit: GUILDS });
const rebuildMs = performance.now() - r0;
await db.query('ANALYZE');
const totals = (await db.one('SELECT count(*)::int AS n FROM guild_totals')).n;
console.log(`\nGuild totals (the worker's guild-totals job): ${rebuilt} guilds rebuilt in ${Math.round(rebuildMs)} ms (${(rebuildMs / rebuilt).toFixed(1)} ms per guild) → ${totals.toLocaleString()} rows`);

const app = createApp({ db, onHeader: null });
const server = await new Promise((res) => {
  const s = app.listen(0, '127.0.0.1', () => res(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
async function time(label, path, runs = 7) {
  const ms = [];
  let body;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    const res = await fetch(base + path, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
    body = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    ms.push(performance.now() - s);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(66)} median ${ms[Math.floor(runs / 2)].toFixed(1)} ms   (min ${ms[0].toFixed(1)}, max ${ms.at(-1).toFixed(1)})`);
  return body;
}
const big = await db.one("SELECT g.slug, count(*)::int AS n FROM guilds g JOIN characters c ON c.guild_id = g.id GROUP BY g.slug ORDER BY n DESC LIMIT 1");
const STAT = Math.ceil(STATISTICS / 2);
console.log(`\nRoute times (the biggest guild: ${big.n} tracked members):`);
await time('guild page: header, counts, totals, placements, roster', `/api/guilds/${big.slug}`);
await time('guild page: top 5 members of every statistic (overall)', `/api/guilds/${big.slug}/top`);
await time('guild page: top 5 members of every statistic (this week)', `/api/guilds/${big.slug}/top?period=week`);
await time('guild-only board: one statistic, every member', `/api/guilds/${big.slug}/boards/${STAT}`);
await time('guild board page 1, by total', `/api/guild-boards/${RS}/${STAT}`);
await time('guild board page 1, by average', `/api/guild-boards/${RS}/${STAT}?mode=average`);
await time('guild board page 1, this week, by total', `/api/guild-boards/${RS}/${STAT}?period=week`);
await time('guild boards index: top 3 guilds of every board on a ruleset', `/api/guild-boards?ruleset=${RS}`);
await time('/guilds: the largest guilds on a ruleset', `/api/guilds?ruleset=${RS}`);
await time('search: guilds and characters by name', '/api/search?q=synthetic%20guild%201');

await new Promise((res) => server.close(res));
await db.close();
if (socket) await socket.stop();
if (pglite) await pglite.close();
