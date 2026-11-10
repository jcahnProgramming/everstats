import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// 0.9.2: the leaderboards index showed blank names in some preview rows. It reads the top 3 of every board, then the
// characters behind them; that lookup stopped at 200 characters, so on a site with more boards than that, whoever fell
// past it was a rank and a value with no name. Fixture rows only (names say so).
let t;
before(async () => {
  t = await startApp();
});
after(async () => {
  await t.close();
});

test('every preview row on the leaderboards index has its character, however many boards there are', async () => {
  const q = t.db;
  await q.query("INSERT INTO rulesets (id, name, listed) VALUES (2, 'Fixture ruleset', true)");
  const BOARDS = 120;
  // 3 different characters at the top of each of 120 boards: 360 characters, well past the old 200.
  for (let s = 1; s <= BOARDS; s++) {
    await q.query("INSERT INTO statistics (id, name, category_path) VALUES ($1, $2, '[{\"id\":1,\"name\":\"Fixture\"}]')", [s, `Fixture statistic ${s}`]);
  }
  const ids = [];
  for (let i = 0; i < BOARDS * 3; i++) ids.push(10_000 + i);
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, profile_state, stats_fetched_at, level, source)
     SELECT id, 'fixture-' || id, 'Fixture', 'N' || id, 2, 'ok', now(), 20, 'lookup' FROM unnest($1::bigint[]) AS id`,
    [ids],
  );
  await q.query(
    `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
     SELECT 10000 + (s - 1) * 3 + k, s, 2, 10 - k, now() FROM generate_series(1, $1) AS s, generate_series(0, 2) AS k`,
    [BOARDS],
  );
  const idx = (await t.client().get('/api/leaderboards?ruleset=2')).json;
  const rows = idx.categories.flatMap((c) => c.boards.flatMap((b) => b.top));
  assert.equal(rows.length, BOARDS * 3);
  const blank = rows.filter((r) => !r.name || !r.slug);
  assert.deepEqual(blank, [], `${blank.length} preview rows had no character`);
});

test('0.10.4: a board where everyone with any is tied says so with the value they share; others carry no tied value', async () => {
  const q = t.db;
  await q.query("INSERT INTO statistics (id, name, category_path) VALUES (900, 'Fixture tied statistic', '[{\"id\":1,\"name\":\"Fixture\"}]')");
  await q.query(
    `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
     VALUES (10000, 900, 2, 7, now()), (10001, 900, 2, 7, now()), (10002, 900, 2, 7, now())`,
  );
  (await import('../stats/catalog.js')).clearCatalogCache(); // the statistic is new to this process
  const idx = (await t.client().get('/api/leaderboards?ruleset=2')).json;
  const boards = idx.categories.flatMap((c) => c.boards);
  const tied = boards.find((b) => b.id === 900);
  assert.equal(tied.tied, true);
  assert.equal(tied.tiedValue, 7);
  assert.equal(tied.nonzero, 3);
  assert.equal(boards.find((b) => b.id === 1).tiedValue, null);
});
