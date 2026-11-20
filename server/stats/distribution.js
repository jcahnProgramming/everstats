import { featureOn } from '../features/registry.js';
import { getSetting } from '../admin/settings.js';

/**
 * Precomputed board distributions (0.11.1, the "Precomputed ranks" feature switch).
 *
 * Before this, every rank was counted by walking the board: a character page walked one board per statistic the
 * character has (measured on production: 8.4 s and 10.6 million buffers for one page), a tier grading walked every
 * counted board (2.9 s per fetch), and "how many have any" scanned the whole table. The cost grew with characters ×
 * boards, and so did the number of times it ran.
 *
 * Now the worker builds, every `boards.refreshMinutes` and only when a value changed since the last build:
 *
 *   board_values_{a|b}  one row per board (realm category + statistic) per DISTINCT value above zero held by a visible
 *                       character: n = how many hold it, above = how many are strictly above it
 *   board_counts_{a|b}  per board: nonzero (how many have any), max, min
 *   board_state         the current copy, when it was built, and each realm category's populations from the same pass
 *
 * A build fills the copy that is NOT in use, then points board_state at it in the same transaction. The old copy is left
 * alone until the next build starts (minutes later), so a reader that picked it up a moment before the switch still
 * reads a whole, consistent copy. Nothing is updated in place: no dead rows, and the tables are UNLOGGED (no WAL; empty
 * after a crash, when readers fall back to counting directly until the next build).
 *
 * Reading a rank (ties share, zero is never ranked, hidden characters count for nothing: all as stats/boards.js says):
 *
 *   rank(v)   = 1 + (above + n) of the smallest stored value greater than v      (one index probe; 1 when none is)
 *   equal(v)  = n of the row whose value is v                                    (0 when nobody held it at the build)
 *   nonzero, max, min, populations                                               from the same build
 *
 * So a rank and its "of N" always come from one build and cannot disagree. What changes (the owner's decision,
 * 2026-11-20): overall ranks, "of N" and percentiles are AS OF THE BUILD, up to about `boards.refreshMinutes` old, and
 * pages say "Ranks as of HH:MM". One edge: a character whose value FELL since the build is still counted in the build
 * at its old, higher value, so it can read one place lower than it is until the next build (server/test/
 * distribution.test.js asserts exactly this). Weekly and rolling boards are not precomputed: they are read live, rank
 * and count at the same moment, as before.
 *
 * A board is keyed by (ruleset_id, statistic_id). A `rulesets` row is a realm category of ONE game version and region
 * and a statistic belongs to one game version, so that key is (version, region, realm category, statistic).
 *
 * Retention: every row is derived from current Blizzard values and carries built_at; the tables are in the registry's
 * Blizzard class and swept by it. A build replaces everything, so nothing in them is ever older than the last build.
 */
export const FEATURE_ID = 'precomputed-ranks';
export const VALUES_CHANGED_FACT = 'values_changed_at';
/** A build runs at least this often even when no change was noted (a safety net for a missed note). */
export const FORCE_EVERY_MS = 6 * 60 * 60 * 1000;
const BUILD_LOCK = 7201;
const BUILD_TIMEOUT_MS = 120_000;
// A change is noted at most every NOTE_GAP_S seconds (one hot row); the build allows for that gap when it decides
// whether anything changed since it last started.
const NOTE_GAP_S = 10;
const GENS = Object.freeze(['a', 'b']);
const MEMO_MS = 2000;
const memo = new WeakMap();
let seq = 0;

/** A statistic value changed, appeared or went (or a character was hidden, shown, purged): the next build is due. */
export async function noteValuesChanged(q) {
  await q.query(
    `INSERT INTO pipeline_facts (key, at) VALUES ($1, now())
     ON CONFLICT (key) DO UPDATE SET at = now() WHERE pipeline_facts.at < now() - ($2 || ' seconds')::interval`,
    [VALUES_CHANGED_FACT, String(NOTE_GAP_S)],
  );
}

/** Forget what activeBuild remembered (after a build in this process; tests, between a build and a read). */
export function clearBuildMemo() {
  seq += 1;
}

/**
 * The build readers should use now: { gen, builtAt, populations } or null (the switch is off, or nothing is built yet:
 * read directly). Remembered for two seconds per pool so a page that reads forty ranks asks once.
 */
export async function activeBuild(db) {
  const hit = memo.get(db);
  if (hit && hit.seq === seq && Date.now() - hit.at < MEMO_MS) return hit.build;
  let build = null;
  if (await featureOn(db, FEATURE_ID)) {
    const row = await db.one('SELECT gen, built_at, populations FROM board_state WHERE id = 1');
    if (row && GENS.includes(row.gen)) build = { gen: row.gen, builtAt: row.built_at, populations: row.populations ?? {} };
  }
  memo.set(db, { at: Date.now(), seq, build });
  return build;
}

const T = (build) => ({ values: `board_values_${build.gen}`, counts: `board_counts_${build.gen}` });

/** 1 + how many are strictly above `expr` on the board (rulesetParam, statisticExpr), as SQL. */
const rankSql = (build, rulesetParam, statisticExpr, expr) =>
  `coalesce((SELECT d.above + d.n FROM ${T(build).values} d WHERE d.ruleset_id = ${rulesetParam} AND d.statistic_id = ${statisticExpr} AND d.value > ${expr} ORDER BY d.value LIMIT 1), 0)`;

/** A population of this build, or undefined when the build didn't count that one (the caller then counts directly). */
export function populationFrom(build, rulesetId, { derived = false, population = null } = {}) {
  const p = build.populations?.[String(rulesetId)];
  if (!p) return 0; // no character of that realm category existed at the build
  if (!derived && !population) return p.tracked;
  if (derived && !population) return p.collections;
  if (derived && population === 'hunters') return p.hunters;
  return undefined;
}

export async function boardCountsFrom(db, build, rulesetId) {
  const rows = await db.query(`SELECT statistic_id, nonzero, max, min FROM ${T(build).counts} WHERE ruleset_id = $1 LIMIT 20000`, [rulesetId]);
  return { population: populationFrom(build, rulesetId), byStat: new Map(rows.map((r) => [r.statistic_id, { nonzero: r.nonzero, max: r.max, min: r.min }])) };
}

export async function statCountsFrom(db, build, { statisticId, rulesetId }) {
  const row = await db.one(`SELECT nonzero, max, min FROM ${T(build).counts} WHERE ruleset_id = $1 AND statistic_id = $2`, [rulesetId, statisticId]);
  return { nonzero: row?.nonzero ?? 0, max: row?.max ?? null, min: row?.min ?? null };
}

export async function ranksForFrom(db, build, { statisticId, rulesetId, values }) {
  const out = new Map();
  if (!values.length) return out;
  const rows = await db.query(
    `SELECT v.value, ${rankSql(build, '$1', '$2', 'v.value')} + 1 AS rank FROM unnest($3::float8[]) AS v(value)`,
    [rulesetId, statisticId, values],
  );
  for (const r of rows) out.set(r.value, r.rank);
  return out;
}

export async function characterRanksFrom(db, build, characterId, rulesetId) {
  return db.query(
    `SELECT cs.statistic_id, cs.value, cs.text, cs.blizzard_updated_at, cs.fetched_at,
            CASE WHEN cs.value > 0 THEN ${rankSql(build, '$2', 'cs.statistic_id', 'cs.value')} + 1 END AS rank
       FROM character_statistics cs WHERE cs.character_id = $1 LIMIT 5000`,
    [characterId, rulesetId],
  );
}

/** One character on many boards in one query: Map(statisticId → { value, rank (null at zero), withAny }). */
export async function ranksOnManyFrom(db, build, { characterId, rulesetId, statisticIds }) {
  const out = new Map();
  if (!statisticIds.length) return out;
  const rows = await db.query(
    `SELECT s.id AS statistic_id, coalesce(cs.value, 0) AS value, coalesce(bc.nonzero, 0) AS nonzero,
            CASE WHEN cs.value > 0 THEN ${rankSql(build, '$2', 's.id', 'cs.value')} + 1 END AS rank
       FROM unnest($3::bigint[]) AS s(id)
       LEFT JOIN character_statistics cs ON cs.character_id = $1 AND cs.statistic_id = s.id
       LEFT JOIN ${T(build).counts} bc ON bc.ruleset_id = $2 AND bc.statistic_id = s.id
      LIMIT 5000`,
    [characterId, rulesetId, statisticIds],
  );
  for (const r of rows) out.set(Number(r.statistic_id), { value: r.value, rank: r.rank, withAny: r.nonzero });
  return out;
}

/**
 * What tiers/store.js livePercentiles counts, from the build: per statistic the character's value, how many have any,
 * how many are strictly above it and how many share it. Same columns, same meaning.
 */
export async function percentileRowsFrom(db, build, { characterId, rulesetId, statisticIds }) {
  if (!statisticIds.length) return [];
  return db.query(
    `SELECT s.id AS statistic_id, coalesce(m.value, 0) AS v, coalesce(bc.nonzero, 0) AS nonzero,
            ${rankSql(build, '$2', 's.id', 'coalesce(m.value, 0)')} AS above,
            coalesce((SELECT d.n FROM ${T(build).values} d WHERE d.ruleset_id = $2 AND d.statistic_id = s.id AND d.value = m.value), 0) AS equal
       FROM unnest($3::bigint[]) AS s(id)
       LEFT JOIN character_statistics m ON m.character_id = $1 AND m.statistic_id = s.id AND NOT m.hidden
       LEFT JOIN ${T(build).counts} bc ON bc.ruleset_id = $2 AND bc.statistic_id = s.id
      LIMIT 5000`,
    [characterId, rulesetId, statisticIds],
  );
}

/**
 * Builds the distribution into the copy that is not in use and switches to it. One build at a time (advisory lock);
 * skipped when no value changed since the last build started (unless `force`, or the last build is FORCE_EVERY_MS old).
 * → { built: true, rows, ms, gen } | { built: false, why }
 */
export async function buildDistribution(db, { now = Date.now, force = false } = {}) {
  const t0 = Date.now();
  return db.tx(async (q) => {
    if (!(await q.one('SELECT pg_try_advisory_xact_lock($1) AS ok', [BUILD_LOCK])).ok) return { built: false, why: 'another build is running' };
    const state = await q.one('SELECT gen, started_at, built_at FROM board_state WHERE id = 1');
    if (state && !force) {
      const changed = (await q.one('SELECT at FROM pipeline_facts WHERE key = $1', [VALUES_CHANGED_FACT]))?.at ?? null;
      const startedMs = new Date(state.started_at).getTime();
      const stale = now() - new Date(state.built_at).getTime() >= FORCE_EVERY_MS;
      if (!stale && (!changed || new Date(changed).getTime() < startedMs - (NOTE_GAP_S + 5) * 1000)) return { built: false, why: 'nothing changed since the last build' };
    }
    const gen = state?.gen === 'a' ? 'b' : 'a';
    const started = new Date(now());
    // The build's own memory and time limit: its hash and sort need about 220 MB on production (measured 2026-11-20),
    // far more than the server-wide work_mem should be. SET LOCAL ends with this transaction.
    await q.query("SET LOCAL work_mem = '256MB'");
    await q.query(`SET LOCAL statement_timeout = ${BUILD_TIMEOUT_MS}`);
    await q.query(`TRUNCATE board_values_${gen}, board_counts_${gen}`);
    await q.query(
      `INSERT INTO board_values_${gen} (ruleset_id, statistic_id, value, n, above, built_at)
       SELECT ruleset_id, statistic_id, value, count(*)::int,
              coalesce(sum(count(*)) OVER (PARTITION BY ruleset_id, statistic_id ORDER BY value DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::int,
              $1
         FROM character_statistics WHERE NOT hidden AND value > 0
        GROUP BY ruleset_id, statistic_id, value`,
      [started],
    );
    await q.query(
      `INSERT INTO board_counts_${gen} (ruleset_id, statistic_id, nonzero, max, min, built_at)
       SELECT ruleset_id, statistic_id, sum(n)::int, max(value), min(value), $1 FROM board_values_${gen} GROUP BY ruleset_id, statistic_id`,
      [started],
    );
    await q.query(`ANALYZE board_values_${gen}`);
    await q.query(`ANALYZE board_counts_${gen}`);
    // The populations of the same pass: tracked (every board's "of everyone"), with collections fetched (a collection
    // count's board), hunters among those, and tier-eligible (tiers/store.js ELIGIBLE, written out here).
    const pops = await q.query(
      `SELECT ruleset_id,
              count(*) FILTER (WHERE stats_fetched_at IS NOT NULL AND NOT hidden)::int AS tracked,
              count(*) FILTER (WHERE stats_fetched_at IS NOT NULL AND NOT hidden AND collections_fetched_at IS NOT NULL)::int AS collections,
              count(*) FILTER (WHERE stats_fetched_at IS NOT NULL AND NOT hidden AND collections_fetched_at IS NOT NULL AND class = 'Hunter')::int AS hunters,
              count(*) FILTER (WHERE stats_fetched_at IS NOT NULL AND NOT hidden AND missing_since IS NULL AND profile_state = 'ok' AND level >= 10)::int AS eligible
         FROM characters WHERE ruleset_id IS NOT NULL GROUP BY ruleset_id LIMIT 1000`,
    );
    const populations = Object.fromEntries(pops.map((r) => [String(r.ruleset_id), { tracked: r.tracked, collections: r.collections, hunters: r.hunters, eligible: r.eligible }]));
    const rows = (await q.one(`SELECT count(*)::int AS n FROM board_values_${gen}`)).n;
    const ms = Date.now() - t0;
    await q.query(
      `INSERT INTO board_state (id, gen, started_at, built_at, ms, value_rows, populations) VALUES (1, $1, $2, now(), $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET gen = EXCLUDED.gen, started_at = EXCLUDED.started_at, built_at = EXCLUDED.built_at, ms = EXCLUDED.ms,
         value_rows = EXCLUDED.value_rows, populations = EXCLUDED.populations`,
      [gen, started, ms, rows, JSON.stringify(populations)],
    );
    return { built: true, rows, ms, gen };
  }).finally(() => clearBuildMemo());
}

/** The worker's job body: build when the switch is on and the interval has passed. → summary text and whether it built. */
export async function runDistributionJob(db, { now = Date.now } = {}) {
  if (!(await featureOn(db, FEATURE_ID))) return { summary: 'Off (Features → Precomputed ranks): ranks are counted directly', worked: false };
  const minutes = await getSetting(db, 'boards.refreshMinutes');
  const state = await db.one('SELECT built_at, ms, value_rows FROM board_state WHERE id = 1');
  if (state && now() - new Date(state.built_at).getTime() < minutes * 60 * 1000) {
    return { summary: `Built ${new Date(state.built_at).toISOString().slice(11, 16)} UTC: ${state.value_rows} values in ${state.ms} ms`, worked: false, lastWorkAt: state.built_at };
  }
  const r = await buildDistribution(db, { now });
  if (!r.built) return { summary: state ? `Not rebuilt: ${r.why}` : `Not built: ${r.why}`, worked: false, lastWorkAt: state?.built_at ?? null };
  return { summary: `Built ${r.rows} values in ${r.ms} ms`, worked: true };
}
