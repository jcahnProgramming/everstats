// Precomputed ranks against direct counts, on the real data (0.11.1). Read-only: nothing is written.
//
//   docker exec everstats node server/tools/rank-parity.js          200 characters, spread over every realm category
//   docker exec everstats node server/tools/rank-parity.js 1000     more of them
//
// For each sampled character it reads every rank the character page shows BOTH ways (stats/boards.js: from the last
// distribution build, and counted directly now) and the tier percentiles both ways, and counts the differences. Run it
// with the background crawl paused and right after a build (Admin → Data → Crawler → Worker jobs → "Board ranks"), so
// nothing moved in between: every count must then be 0. With the crawl running a few differences are expected (values
// that changed since the build) and it says how old the build is.
//
// Prints counts, ids and timings only: no character names and no Blizzard values.
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { boardCounts, characterRanks, direct } from '../stats/boards.js';
import { activeBuild } from '../stats/distribution.js';
import { livePercentiles } from '../tiers/store.js';

const db = createDb({ url: config.databaseUrl, max: 2 });
try {
  const build = await activeBuild(db);
  if (!build) {
    console.log('No distribution build to compare: turn on Features → Precomputed ranks and wait for the first build (Worker jobs → Board ranks).');
    process.exitCode = 2;
  } else {
    const want = Math.max(1, Math.min(5000, Number.parseInt(process.argv[2] ?? '200', 10) || 200));
    const ageS = Math.round((Date.now() - new Date(build.builtAt).getTime()) / 1000);
    console.log(`Build ${build.gen.toUpperCase()} from ${new Date(build.builtAt).toISOString()} (${ageS} s old). Sampling ${want} character(s).`);
    const rulesets = await db.query(
      `SELECT r.id, (SELECT count(*)::int FROM characters c WHERE c.ruleset_id = r.id AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden AND c.missing_since IS NULL) AS n
         FROM rulesets r ORDER BY r.id LIMIT 400`,
    );
    const total = rulesets.reduce((s, r) => s + r.n, 0) || 1;
    const out = { characters: 0, ranks: 0, rankDiffs: 0, countDiffs: 0, percentileDiffs: 0, populationDiffs: 0, directMs: 0, builtMs: 0 };
    for (const rs of rulesets.filter((r) => r.n > 0)) {
      const take = Math.max(1, Math.round((want * rs.n) / total));
      // Evenly spread by id: no ORDER BY random() over the whole table.
      const ids = (await db.query(
        `SELECT id FROM (SELECT c.id, row_number() OVER (ORDER BY c.id) AS k FROM characters c
                          WHERE c.ruleset_id = $1 AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden AND c.missing_since IS NULL) x
          WHERE x.k % $2 = 0 ORDER BY id LIMIT $3`,
        [rs.id, Math.max(1, Math.floor(rs.n / take)), take],
      )).map((r) => Number(r.id));
      const oldCounts = await direct.boardCounts(db, rs.id);
      const newCounts = await boardCounts(db, rs.id, 'overall', { build });
      if (oldCounts.population !== newCounts.population) out.populationDiffs += 1;
      for (const [id, o] of oldCounts.byStat) {
        const n = newCounts.byStat.get(id);
        if (!n || n.nonzero !== o.nonzero || n.max !== o.max || n.min !== o.min) out.countDiffs += 1;
      }
      for (const [id] of newCounts.byStat) if (!oldCounts.byStat.has(id)) out.countDiffs += 1;
      const plan = (await db.one("SELECT plan->'statisticIds' AS ids FROM tier_rulesets WHERE ruleset_id = $1 AND graded", [rs.id]))?.ids ?? [];
      for (const id of ids) {
        let t0 = Date.now();
        const a = await direct.characterRanks(db, id, rs.id);
        out.directMs += Date.now() - t0;
        t0 = Date.now();
        const b = await characterRanks(db, id, rs.id, { build });
        out.builtMs += Date.now() - t0;
        out.characters += 1;
        for (const [stat, x] of a) {
          out.ranks += 1;
          const y = b.get(stat);
          if (!y || y.rank !== x.rank) out.rankDiffs += 1;
        }
        if (plan.length) {
          const p1 = await livePercentiles(db, { characterId: id, rulesetId: rs.id, statisticIds: plan, build: null });
          const p2 = await livePercentiles(db, { characterId: id, rulesetId: rs.id, statisticIds: plan, build });
          if (p1.population !== p2.population) out.populationDiffs += 1;
          for (const [stat, v] of p1.pct) if (p2.pct.get(stat) !== v) out.percentileDiffs += 1;
        }
      }
    }
    console.log(`Characters compared:        ${out.characters}`);
    console.log(`Ranks compared:             ${out.ranks}`);
    console.log(`Ranks that differ:          ${out.rankDiffs}`);
    console.log(`Board counts that differ:   ${out.countDiffs}`);
    console.log(`Percentiles that differ:    ${out.percentileDiffs}`);
    console.log(`Populations that differ:    ${out.populationDiffs}`);
    console.log(`Character page ranks, per character: ${Math.round(out.directMs / Math.max(1, out.characters))} ms counted directly, ${Math.round(out.builtMs / Math.max(1, out.characters))} ms from the build`);
    const diffs = out.rankDiffs + out.countDiffs + out.percentileDiffs + out.populationDiffs;
    console.log(diffs === 0 ? 'IDENTICAL: every rank, count, population and percentile matches.' : `DIFFERENT in ${diffs} place(s). With the crawl running that is expected for values that changed since the build; with it paused and a fresh build it should be 0.`);
    process.exitCode = diffs === 0 ? 0 : 1;
  }
} finally {
  await db.close();
}
