import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startDb } from './helpers.js';

// 0.11.1: precomputed ranks (stats/distribution.js) against the direct counts they replace (stats/boards.js `direct`,
// tiers/store.js livePercentiles without a build). OLD VERSUS NEW, on one database: every rank, "of N", count, max, min,
// population and tier percentile must be IDENTICAL when the build is current. Fixtures (test data, never shipped): ties,
// zeros (no row), hidden characters, characters below the tier level, a missing one, three realm categories and two
// game versions. Then the one accepted difference, asserted exactly: a value that FELL since the build.
//
// Not here: the Retail Roleplaying filter. It exists only on the `retail` branch (0.11.x); a filtered board is always
// counted directly (stats/boards.js), so it has no precomputed path to compare.

let t;
const RS = { normal: 2, pvp: 1, retail: 9001 };
const STATS = { forever: [201, 202, 203, 204], retail: [9301, 9302] };
const chars = []; // { id, rs, hidden, level, missing }

// A small deterministic generator: the same fixtures on every run.
let seed = 20261120;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor(seed / 256) % n; // the low bits of this generator repeat: use the higher ones
};

async function addCharacter({ id, rs, version, hidden = false, level = 30, missing = false }) {
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, data_fetched_at, hidden, missing_since, game_version, realm_slug)
     VALUES ($1, $2, $3, 'Fixture', $4, $5, 'ok', 'lookup', now(), now(), now(), $6, $7, $8, $9)`,
    [id, `c${id}-fixture`, `C${id}`, rs, level, hidden, missing ? new Date() : null, version, version === 'forever' ? null : 'area-52'],
  );
  chars.push({ id, rs, hidden, level, missing });
}
const setValue = (id, statId, rs, value, hidden = false) => t.db.query(
  `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, hidden, value, fetched_at) VALUES ($1, $2, $3, $4, $5, now())
   ON CONFLICT (character_id, statistic_id) DO UPDATE SET value = EXCLUDED.value`,
  [id, statId, rs, hidden, value],
);

before(async () => {
  t = await startDb();
  await t.db.query("INSERT INTO rulesets (id, name, listed) VALUES ($1, 'Normal', true), ($2, 'PvP', true)", [RS.normal, RS.pvp]);
  await t.db.query("INSERT INTO rulesets (id, name, listed, game_version, category_key) VALUES ($1, 'US realms', true, 'retail', 'region:us')", [RS.retail]);
  for (const id of STATS.forever) await t.db.query("INSERT INTO statistics (id, name, category_path) VALUES ($1, $2, '[]')", [id, `Fixture statistic ${id}`]);
  for (const id of STATS.retail) await t.db.query("INSERT INTO statistics (id, name, category_path, game_version) VALUES ($1, $2, '[]', 'retail')", [id, `Retail fixture ${id}`]);
  let id = 1000;
  const fill = async (rs, version, n, stats) => {
    for (let i = 0; i < n; i++) {
      id += 1;
      const hidden = i % 11 === 3;
      const level = i % 13 === 5 ? 7 : 30;
      const missing = i % 17 === 9;
      await addCharacter({ id, rs, version, hidden, level, missing });
      if (missing) continue; // a missing character's values are taken off (crawler/store.js markProfileMissing)
      for (const [k, statId] of stats.entries()) {
        // Many ties (a small range), about a third zeros (no row), and one statistic where everyone above zero is tied.
        const v = k === 3 ? (i % 3 === 0 ? 0 : 5) : rnd(3) === 0 ? 0 : 1 + rnd(k === 0 ? 6 : 40);
        if (v > 0) await setValue(id, statId, rs, v, hidden);
      }
    }
  };
  await fill(RS.normal, 'forever', 120, STATS.forever);
  await fill(RS.pvp, 'forever', 40, STATS.forever);
  await fill(RS.retail, 'retail', 60, STATS.retail);
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'features.precomputedRanks', true);
  const { clearFeatureCache } = await import('../features/registry.js');
  clearFeatureCache();
});
after(() => t.close());

const statsOf = (rs) => (rs === RS.retail ? STATS.retail : STATS.forever);
async function fresh() {
  const { activeBuild, buildDistribution, clearBuildMemo } = await import('../stats/distribution.js');
  const r = await buildDistribution(t.db, { force: true });
  assert.equal(r.built, true);
  clearBuildMemo();
  const b = await activeBuild(t.db);
  assert.ok(b, 'a build is active once the switch is on and one was built');
  return b;
}
const plain = (map) => [...map].map(([k, v]) => [Number(k), v.value, v.rank]).sort((a, b) => a[0] - b[0]);

test('with the switch off, or nothing built, everything is counted directly', async () => {
  const { activeBuild, clearBuildMemo } = await import('../stats/distribution.js');
  const { ranksAsOf } = await import('../stats/boards.js');
  clearBuildMemo();
  assert.equal(await activeBuild(t.db), null, 'nothing built yet: no build to read');
  assert.equal(await ranksAsOf(t.db), null);
});

test('old versus new: every rank, count, population and percentile is identical when the build is current', async () => {
  const boards = await import('../stats/boards.js');
  const { livePercentiles } = await import('../tiers/store.js');
  const build = await fresh();
  let ranksCompared = 0;
  for (const rs of Object.values(RS)) {
    // Populations and every board's counts.
    assert.equal(await boards.populationOf(t.db, rs, 'overall', { build }), await boards.direct.populationOf(t.db, rs));
    const oldCounts = await boards.direct.boardCounts(t.db, rs);
    const newCounts = await boards.boardCounts(t.db, rs, 'overall', { build });
    assert.equal(newCounts.population, oldCounts.population);
    const flat = (c) => [...c.byStat].map(([k, v]) => [Number(k), v.nonzero, v.max, v.min]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(flat(newCounts), flat(oldCounts), `board counts on ruleset ${rs}`);
    for (const statisticId of statsOf(rs)) {
      assert.deepEqual(await boards.statCounts(t.db, { statisticId, rulesetId: rs, build }), await boards.direct.statCounts(t.db, { statisticId, rulesetId: rs }), `statCounts ${rs}/${statisticId}`);
      // Ranks of values on the board, between its values, above its best and below its worst.
      const values = [0.5, 1, 2, 2.5, 3, 5, 6, 7, 17, 40, 41, 1000];
      const a = await boards.ranksFor(t.db, { statisticId, rulesetId: rs, values, build });
      const b = await boards.direct.ranksFor(t.db, { statisticId, rulesetId: rs, values });
      assert.deepEqual([...a].sort((x, y) => x[0] - y[0]), [...b].sort((x, y) => x[0] - y[0]), `ranksFor ${rs}/${statisticId}`);
    }
  }
  for (const c of chars) {
    // The character page: its rank on every board it is on. (A hidden character's own rows are read the same way; the
    // page decides not to show ranks for it.)
    const a = await boards.characterRanks(t.db, c.id, c.rs, { build });
    const b = await boards.direct.characterRanks(t.db, c.id, c.rs);
    assert.deepEqual(plain(a), plain(b), `characterRanks of ${c.id}`);
    ranksCompared += a.size;
    // One board at a time (pins, "your characters on this board"), and many at once.
    const ids = statsOf(c.rs);
    const many = await boards.ranksOnMany(t.db, { characterId: c.id, rulesetId: c.rs, statisticIds: ids, build });
    for (const statisticId of ids) {
      const one = await boards.rankOn(t.db, { characterId: c.id, statisticId, rulesetId: c.rs, build });
      const old = await boards.direct.rankOn(t.db, { characterId: c.id, statisticId, rulesetId: c.rs });
      assert.deepEqual(one, old, `rankOn ${c.id}/${statisticId}`);
      assert.deepEqual(many.get(statisticId), { value: old.value, rank: old.rank, withAny: old.withAny }, `ranksOnMany ${c.id}/${statisticId}`);
      // Zero is never ranked.
      if (old.value === 0) assert.equal(one.rank, null);
    }
    // Tier percentiles for one character (tiers/store.js): the build against a live count.
    const pNew = await livePercentiles(t.db, { characterId: c.id, rulesetId: c.rs, statisticIds: ids, build });
    const pOld = await livePercentiles(t.db, { characterId: c.id, rulesetId: c.rs, statisticIds: ids, build: null });
    assert.equal(pNew.population, pOld.population);
    assert.deepEqual([...pNew.pct].sort((x, y) => x[0] - y[0]), [...pOld.pct].sort((x, y) => x[0] - y[0]), `percentiles of ${c.id}`);
    assert.deepEqual([...pNew.nonzero].sort((x, y) => x[0] - y[0]), [...pOld.nonzero].sort((x, y) => x[0] - y[0]));
  }
  assert.ok(ranksCompared > 300, `compared ${ranksCompared} ranks`);
  // The fixtures really hold what the rules are about.
  const tied = await boards.direct.statCounts(t.db, { statisticId: 204, rulesetId: RS.normal });
  assert.ok(tied.nonzero > 10 && tied.min === tied.max, 'a board where everyone with any is tied');
  assert.ok(chars.some((c) => c.hidden) && chars.some((c) => c.level < 10) && chars.some((c) => c.missing));
});

test('ties share a rank, zeros are not ranked, hidden characters count for nothing, realm categories and versions stay apart', async () => {
  const boards = await import('../stats/boards.js');
  const build = await fresh();
  // Everyone tied on 204: all of them #1, "of" as many as have any.
  const c204 = await boards.statCounts(t.db, { statisticId: 204, rulesetId: RS.normal, build });
  const holder = (await t.db.one('SELECT character_id FROM character_statistics WHERE statistic_id = 204 AND ruleset_id = $1 AND NOT hidden LIMIT 1', [RS.normal])).character_id;
  const r = await boards.rankOn(t.db, { characterId: holder, statisticId: 204, rulesetId: RS.normal, build });
  assert.deepEqual([r.rank, r.withAny], [1, c204.nonzero]);
  // A hidden character's value moves nobody: make a hidden one the best by far.
  const hidden = chars.find((c) => c.hidden && c.rs === RS.normal && !c.missing);
  const top = (await t.db.one('SELECT character_id, value FROM character_statistics WHERE statistic_id = 202 AND ruleset_id = $1 AND NOT hidden ORDER BY value DESC, character_id LIMIT 1', [RS.normal]));
  await setValue(hidden.id, 202, RS.normal, 99999, true);
  const b2 = await fresh();
  assert.equal((await boards.rankOn(t.db, { characterId: top.character_id, statisticId: 202, rulesetId: RS.normal, build: b2 })).rank, 1);
  assert.equal((await boards.statCounts(t.db, { statisticId: 202, rulesetId: RS.normal, build: b2 })).max, top.value);
  // The same statistic on another realm category is another board; a Retail statistic has no board on Forever.
  const normal = await boards.statCounts(t.db, { statisticId: 201, rulesetId: RS.normal, build: b2 });
  const pvp = await boards.statCounts(t.db, { statisticId: 201, rulesetId: RS.pvp, build: b2 });
  assert.notEqual(normal.nonzero, pvp.nonzero);
  assert.equal((await boards.statCounts(t.db, { statisticId: 9301, rulesetId: RS.normal, build: b2 })).nonzero, 0);
  assert.ok((await boards.statCounts(t.db, { statisticId: 9301, rulesetId: RS.retail, build: b2 })).nonzero > 0);
});

test('the one accepted difference: a value that FELL since the build reads one place lower until the next build', async () => {
  const boards = await import('../stats/boards.js');
  // A visible character alone at the top of a board (500, where everyone else has 40 at most).
  const who = chars.find((c) => c.rs === RS.normal && !c.hidden && !c.missing);
  await setValue(who.id, 202, RS.normal, 500);
  const build = await fresh();
  const args = { characterId: who.id, statisticId: 202, rulesetId: RS.normal };
  assert.equal((await boards.rankOn(t.db, { ...args, build })).rank, 1);
  // Its value falls into the middle of the board after the build. Counted now, it is 1 + everyone above the new value.
  // The build still holds it at its OLD, higher value, so it counts itself among those above: exactly one place lower.
  await setValue(who.id, 202, RS.normal, 20.5);
  const live = await boards.direct.rankOn(t.db, args);
  const stale = await boards.rankOn(t.db, { ...args, build });
  assert.ok(live.rank > 1, 'it really fell below others');
  assert.equal(stale.value, live.value, 'the value shown is always the current one');
  assert.equal(stale.rank, live.rank + 1, 'one place lower than it is, never more');
  assert.equal(stale.withAny, live.withAny, '"of N" is unchanged: it was on the board and still is');
  // A value that ROSE since the build is right at once: its old self is below it, so it isn't counted above.
  await setValue(who.id, 202, RS.normal, 600);
  assert.equal((await boards.rankOn(t.db, { ...args, build })).rank, (await boards.direct.rankOn(t.db, args)).rank);
  // And the next build puts the fallen value right too.
  await setValue(who.id, 202, RS.normal, 20.5);
  const next = await fresh();
  assert.deepEqual(await boards.rankOn(t.db, { ...args, build: next }), await boards.direct.rankOn(t.db, args));
});

test('a build is skipped when no value changed, runs after one did, and the old copy stays whole for readers', async () => {
  const { buildDistribution, noteValuesChanged, activeBuild, clearBuildMemo } = await import('../stats/distribution.js');
  const boards = await import('../stats/boards.js');
  const first = await fresh();
  // Nothing noted since (the fact is older than the build, or absent): skipped. The far-future clock only keeps the
  // "noted in the last few seconds" allowance out of the way.
  await t.db.query("DELETE FROM pipeline_facts WHERE key = 'values_changed_at'");
  assert.deepEqual(await buildDistribution(t.db), { built: false, why: 'nothing changed since the last build' });
  await t.db.tx((q) => noteValuesChanged(q));
  const r = await buildDistribution(t.db);
  assert.equal(r.built, true);
  assert.notEqual(r.gen, first.gen, 'built into the other copy');
  // A reader still holding the previous build reads a whole copy: the same answers as before the switch.
  const stat = { statisticId: 201, rulesetId: RS.normal };
  assert.deepEqual(await boards.statCounts(t.db, { ...stat, build: first }), await boards.direct.statCounts(t.db, stat));
  clearBuildMemo();
  assert.equal((await activeBuild(t.db)).gen, r.gen);
});

test('retention: the new tables are Blizzard data, swept by their build time; the grading queue is ours', async () => {
  const { classOf, BLIZZARD } = await import('../retention/registry.js');
  for (const table of ['board_values_a', 'board_values_b', 'board_counts_a', 'board_counts_b', 'board_state', 'guild_board_top']) {
    assert.equal(classOf(table), 'blizzard', table);
    assert.equal(BLIZZARD.find((e) => e.table === table).fetched, 'built_at');
  }
  assert.equal(classOf('grading_queue'), 'ours');
  await fresh();
  // Past the cutoff everything derived goes, and readers fall back to counting directly.
  const future = new Date(Date.now() + 60_000);
  await t.db.tx(async (q) => {
    for (const e of BLIZZARD.filter((x) => /^board_/.test(x.table))) await e.sweep(q, future);
  });
  const { activeBuild, clearBuildMemo } = await import('../stats/distribution.js');
  clearBuildMemo();
  assert.equal(await activeBuild(t.db), null);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM board_values_a')).n + (await t.db.one('SELECT count(*)::int AS n FROM board_values_b')).n, 0);
});

test('guild badges: placements from the precomputed top of the guild boards equal the direct counts', async () => {
  const { placements } = await import('../guildBadges/rules.js');
  const { buildGuildTop } = await import('../stats/guildTop.js');
  const { OVERALL_START } = await import('../stats/guildTotals.js');
  const MIN = 5;
  // 16 guilds on two boards: ties at the top and in the middle, two guilds too small to be ranked (one of them with
  // the best total of all), and a second realm category that must not mix in.
  const guilds = [];
  for (let i = 1; i <= 16; i++) {
    const id = 7000 + i;
    const members = i === 4 || i === 9 ? 3 : 6 + (i % 4);
    const rs = i > 14 ? RS.pvp : RS.normal;
    await t.db.query('INSERT INTO guilds (id, slug, name, ruleset_id) VALUES ($1, $2, $3, $4)', [id, `g${id}`, `Guild ${id}`, rs]);
    const total = (stat) => (i === 4 ? 9000 : stat === 201 ? [500, 500, 400, 0, 300, 300, 300, 200, 0, 150, 140, 130, 120, 110, 100, 90][i - 1] : 50 + ((i * 37) % 9) * 10);
    for (const stat of [201, 202]) {
      await t.db.query(
        `INSERT INTO guild_totals (period, period_start, statistic_id, ruleset_id, guild_id, members, total, average, computed_at) VALUES ('overall', $1, $2, $3, $4, $5, $6, $7, now())`,
        [OVERALL_START, stat, rs, id, members, total(stat) || 1, (total(stat) || 1) / members],
      );
    }
    guilds.push({ id, rs });
  }
  assert.ok(await buildGuildTop(t.db, { minMembers: MIN }) > 0);
  const key = (rows, pick) => rows.filter(pick).map((r) => Number(r.statistic_id)).sort((a, b) => a - b);
  for (const minBoardGuilds of [1, 3, 12]) {
    for (const g of guilds) {
      const args = { guildId: g.id, rulesetId: g.rs, period: 'overall', minMembers: MIN, minBoardGuilds };
      const old = await placements(t.db, args);
      const top = await placements(t.db, { ...args, top: true });
      // What the rules ask (guildBadges/rules.js guildFacts): is it #1, and is it in the top ten of a board of more than ten.
      for (const [name, pick] of [
        ['champion by total', (r) => r.rank_total === 1], ['champion by average', (r) => r.rank_average === 1],
        ['top ten by total', (r) => r.rank_total <= 10 && r.ranked > 10], ['top ten by average', (r) => r.rank_average <= 10 && r.ranked > 10],
      ]) assert.deepEqual(key(top, pick), key(old, pick), `${name}: guild ${g.id}, boards of ${minBoardGuilds}+`);
      // And where both name a rank, it is the same rank, with the same number of ranked guilds.
      for (const r of top) {
        const o = old.find((x) => Number(x.statistic_id) === r.statistic_id);
        assert.ok(o, 'a top placement is a placement');
        assert.equal(r.ranked, o.ranked);
        if (r.rank_total !== Infinity) assert.equal(r.rank_total, o.rank_total);
        if (r.rank_average !== Infinity) assert.equal(r.rank_average, o.rank_average);
      }
    }
  }
  // The too-small guild with the best total is on nobody's board, and two guilds share #1.
  const first = await placements(t.db, { guildId: 7001, rulesetId: RS.normal, period: 'overall', minMembers: MIN, minBoardGuilds: 1, top: true });
  const second = await placements(t.db, { guildId: 7002, rulesetId: RS.normal, period: 'overall', minMembers: MIN, minBoardGuilds: 1, top: true });
  assert.equal(first.find((r) => r.statistic_id === 201).rank_total, 1);
  assert.equal(second.find((r) => r.statistic_id === 201).rank_total, 1);
  assert.deepEqual(await placements(t.db, { guildId: 7004, rulesetId: RS.normal, period: 'overall', minMembers: MIN, minBoardGuilds: 1, top: true }), []);
});
