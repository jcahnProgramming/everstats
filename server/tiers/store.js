import { getSetting } from '../admin/settings.js';
import { PRIMARY_VERSION, enabledVersions } from '../core/gameVersions.js';
import { loadCatalog, loadCatalogFresh } from '../stats/catalog.js';
import { isGraded, letterForScore } from '../stats/tiers.js';
import { gradingPlan, whatCounts } from './counting.js';
import { distributionOf, gradeRuleset, percentileOf, scoreCharacter } from './engine.js';
import { activeBuild, percentileRowsFrom } from '../stats/distribution.js';

/**
 * Tiers in the database (0.6.0). The maths is tiers/engine.js; what counts is tiers/counting.js (the owner's
 * decisions, read live). Two ways a character is graded:
 *
 *   FULL       every tier-eligible character of every ruleset at once, in the worker (job 'tiers'): percentiles,
 *              scores, letters, ranks, and each ruleset's cutoffs (the lowest score that earned each letter). Runs
 *              when a decision or tier setting changed (debounced: TIER_DEBOUNCE_MS of quiet, so a burst of decisions
 *              makes one grading), after the daily refresh has drained, when a ruleset crosses the minimum, and at
 *              least every FULL_EVERY_MS.
 *   CHARACTER  one character, right after its own fetch (crawler/fetch.js): its percentiles are counted LIVE against
 *              everyone's current values, with the plan and settings of the ruleset's last full grading, and its
 *              scores are placed against that grading's cutoffs. Nobody else's letter moves until the next full
 *              grading, because a letter depends on everyone's scores: re-placing the whole ruleset for every lookup
 *              would cost a full grading each time. The character page says which kind graded it, and when.
 *
 * Tier-eligible (ELIGIBLE): level 10+, statistics fetched, not hidden, not missing, profile ok: the same characters
 * the boards rank (character boards exclude hidden and missing ones the same way).
 *
 * 0.11.1: CHARACTER grading left the fetch. It ran after every full fetch, walking every counted board (2.9 s each on
 * production, 31 % of the database's load), and it raced the full grading: both inserted the same character's rows and
 * one of them failed with a unique violation (49 failed gradings in eight days, each one starting over 15 s later).
 *   - A fetch only NOTES the character (grading_queue) when a counted value moved, its standing changed (new, back
 *     from missing, crossed level 10, moved realm category) or it has no tier yet: noteForGrading.
 *   - The worker's 'grade-queue' job grades the noted characters in batches, never while a full grading is running.
 *     A person waiting on a look-up is still graded at once.
 *   - With the "Precomputed ranks" switch on, a character's percentiles are read from the last distribution build
 *     (stats/distribution.js: a few minutes old at most) instead of being counted live. The maths is the same; the
 *     FULL grading always reads the raw values and stays exact.
 *   - Every tier row is written as an upsert, so two writers can no longer collide.
 *   - A full grading that fails waits before it is tried again: 1 minute, doubling to an hour (FAIL_BACKOFF_*).
 */
export const TIER_DEBOUNCE_MS = 30_000;
export const FULL_EVERY_MS = 6 * 60 * 60 * 1000;
export const AFTER_REFRESH_MIN_MS = 60 * 60 * 1000;
export const STALE_RUN_MS = 30 * 60 * 1000;
export const FAIL_BACKOFF_MS = 60 * 1000;
export const FAIL_BACKOFF_MAX_MS = 60 * 60 * 1000;
/** How long after `failures` failed gradings in a row the next one may start. */
export const failBackoffMs = (failures) => (failures <= 0 ? 0 : Math.min(FAIL_BACKOFF_MAX_MS, FAIL_BACKOFF_MS * 2 ** Math.min(failures - 1, 20)));
const MAX_CHARACTERS = 2_000_000;
const WRITE_BATCH = 2000;

export const ELIGIBLE = `c.ruleset_id = $1 AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden AND c.missing_since IS NULL
  AND c.profile_state = 'ok' AND c.level >= 10`;

/**
 * The tier settings now (admin settings), for one game version (0.10.0: the tier settings are per version; the primary
 * version's are the values it always had).
 */
export async function tierSettings(db, version = PRIMARY_VERSION.id) {
  const opt = { version };
  return {
    shares: await getSetting(db, 'tiers.shares', opt),
    minPopulation: await getSetting(db, 'grading.minPopulation', opt),
    categoryHalf: await getSetting(db, 'tiers.categoryHalf', opt),
    overallHalf: await getSetting(db, 'tiers.overallHalf', opt),
    // 0.8.0: weighted categories. Stored with each grading, so a one-character grading uses the same weighting as
    // the full grading it is placed against (a grading stored without it was graded with equal weights).
    weighting: 'sqrt',
    weights: await getSetting(db, 'tiers.weights', opt),
  };
}

/** What counts, from the catalog and the owner's decisions. fresh: bypass this process's 60-second catalog cache. */
export async function countingNow(db, { fresh = false, version = PRIMARY_VERSION.id } = {}) {
  const catalog = fresh ? await loadCatalogFresh(db, { version }) : await loadCatalog(db, { version });
  const counts = whatCounts(catalog);
  return { catalog, counts, plan: gradingPlan(counts) };
}

export async function eligibleCount(db, rulesetId) {
  return (await db.one(`SELECT count(*)::int AS n FROM characters c WHERE ${ELIGIBLE}`, [rulesetId])).n;
}

/**
 * Realm categories (rulesets) with tier-eligible characters, or with tiers stored from before. → [{ id, version }]
 * 0.10.0: a category belongs to one game version and region; it is graded with that version's plan and settings.
 */
async function rulesetsToGrade(db) {
  const rows = await db.query(
    `SELECT id, game_version FROM rulesets r WHERE EXISTS (SELECT 1 FROM characters c WHERE c.ruleset_id = r.id AND c.stats_fetched_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM tier_rulesets t WHERE t.ruleset_id = r.id)
      ORDER BY id LIMIT 400`,
  );
  return rows.map((r) => ({ id: r.id, version: r.game_version }));
}

/** Every counted statistic's values on a ruleset, for the eligible characters → { ids, valueOf }. */
async function loadRuleset(db, rulesetId, statisticIds) {
  const ids = (await db.query(`SELECT c.id FROM characters c WHERE ${ELIGIBLE} ORDER BY c.id LIMIT $2`, [rulesetId, MAX_CHARACTERS])).map((r) => Number(r.id));
  const pos = new Map(ids.map((id, i) => [id, i]));
  const values = new Map();
  // One row per statistic with its non-zero values as arrays: far fewer rows to parse than one per value.
  for (let k = 0; k < statisticIds.length; k += 50) {
    const rows = await db.query(
      `SELECT statistic_id, array_agg(character_id::float8) AS ids, array_agg(value) AS vals FROM character_statistics
        WHERE ruleset_id = $1 AND statistic_id = ANY($2::bigint[]) AND NOT hidden AND value > 0
        GROUP BY statistic_id LIMIT 1000`,
      [rulesetId, statisticIds.slice(k, k + 50)],
    );
    for (const r of rows) {
      const v = new Float64Array(ids.length);
      for (let j = 0; j < r.ids.length; j++) {
        const i = pos.get(r.ids[j]);
        if (i !== undefined) v[i] = r.vals[j];
      }
      values.set(Number(r.statistic_id), v);
    }
  }
  return { ids, valueOf: (id) => values.get(id) ?? null };
}

const planForStore = (plan) => ({
  statisticIds: plan.statisticIds,
  categories: plan.categories,
  ungraded: plan.ungraded,
});
const pgArray = (xs) => `{${xs.join(',')}}`;

/** Writes one ruleset's full grading (replaces everything stored for it), in one transaction. */
async function writeRuleset(q, rulesetId, result, { plan, settings, at }) {
  await q.query('DELETE FROM character_category_tiers WHERE ruleset_id = $1', [rulesetId]);
  await q.query('DELETE FROM character_tiers WHERE ruleset_id = $1', [rulesetId]);
  await q.query(
    `INSERT INTO tier_rulesets (ruleset_id, population, graded, settings, plan, scopes, computed_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (ruleset_id) DO UPDATE SET population = EXCLUDED.population, graded = EXCLUDED.graded, settings = EXCLUDED.settings,
       plan = EXCLUDED.plan, scopes = EXCLUDED.scopes, computed_at = EXCLUDED.computed_at`,
    [rulesetId, result.population, result.graded, JSON.stringify(settings), JSON.stringify(planForStore(plan)), JSON.stringify(result.scopes), at],
  );
  if (!result.graded) return;
  const chars = result.characters;
  for (let k = 0; k < chars.length; k += WRITE_BATCH) {
    const b = chars.slice(k, k + WRITE_BATCH);
    await q.query(
      `INSERT INTO character_tiers (character_id, ruleset_id, score, letter, reason, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at)
       SELECT v.id, $1, v.score, v.letter, v.reason, v.lettered, v.needed, v.total, $10::bigint[], v.pcts::real[], 'full', $11
         FROM unnest($2::bigint[], $3::float8[], $4::text[], $5::text[], $6::smallint[], $7::smallint[], $8::smallint[], $9::text[])
              AS v(id, score, letter, reason, lettered, needed, total, pcts)
       -- 0.11.1: a one-character grading may have written this character since the DELETE above (this row wins)
       ON CONFLICT (character_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, score = EXCLUDED.score, letter = EXCLUDED.letter,
         reason = EXCLUDED.reason, lettered = EXCLUDED.lettered, needed = EXCLUDED.needed, total = EXCLUDED.total, stat_ids = EXCLUDED.stat_ids,
         stat_pcts = EXCLUDED.stat_pcts, graded_by = 'full', computed_at = EXCLUDED.computed_at`,
      [rulesetId, b.map((c) => c.id), b.map((c) => c.score), b.map((c) => c.letter), b.map((c) => c.reason), b.map((c) => c.lettered),
        b.map((c) => c.needed), b.map((c) => c.total), b.map((c) => pgArray(c.statPcts)), plan.statisticIds, at],
    );
    const rows = b.flatMap((c) => c.categories.map((cat) => ({ id: c.id, ...cat })));
    await q.query(
      `INSERT INTO character_category_tiers (character_id, category_key, ruleset_id, score, overall_part, letter, nonzero, needed, counted, computed_at)
       SELECT v.id, v.key, $1, v.score, v.part, v.letter, v.nonzero, v.needed, v.counted, $10
         FROM unnest($2::bigint[], $3::text[], $4::float8[], $5::float8[], $6::text[], $7::smallint[], $8::smallint[], $9::smallint[])
              AS v(id, key, score, part, letter, nonzero, needed, counted)
       ON CONFLICT (character_id, category_key) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, score = EXCLUDED.score, overall_part = EXCLUDED.overall_part,
         letter = EXCLUDED.letter, nonzero = EXCLUDED.nonzero, needed = EXCLUDED.needed, counted = EXCLUDED.counted, computed_at = EXCLUDED.computed_at`,
      [rulesetId, rows.map((r) => r.id), rows.map((r) => r.key), rows.map((r) => r.score), rows.map((r) => r.overallPart), rows.map((r) => r.letter),
        rows.map((r) => r.nonzero), rows.map((r) => r.needed), rows.map((r) => r.counted), at],
    );
  }
}

/**
 * Grades every ruleset (FULL). `settings` and `counting` default to the live ones; `write: false` computes without
 * storing anything (the admin preview). → { rulesets: [{ rulesetId, population, graded, distribution, ms }], ms }
 */
export async function gradeAll(db, { settings = null, counting = null, write = true, now = Date.now, version = null } = {}) {
  const started = now();
  // `settings` / `counting` (the admin preview, tests) are the primary version's; every other version's come from
  // its own decisions and settings. `version` limits the grading to one version (a preview; nothing else is touched).
  const perVersion = new Map();
  async function forVersion(v) {
    if (!perVersion.has(v)) {
      // 0.10.3: given settings belong to the version asked for (a preview of one version), else the primary's.
      const own = v === (version ?? PRIMARY_VERSION.id);
      perVersion.set(v, {
        s: own && settings ? settings : await tierSettings(db, v),
        plan: (own && counting ? counting : await countingNow(db, { fresh: true, version: v })).plan,
      });
    }
    return perVersion.get(v);
  }
  const out = [];
  const all = await rulesetsToGrade(db);
  const listed = version ? all.filter((r) => r.version === version) : all;
  const rulesets = listed.map((r) => r.id);
  for (const { id: rulesetId, version: v } of listed) {
    const { s, plan } = await forVersion(v);
    const t0 = Date.now();
    const { ids, valueOf } = await loadRuleset(db, rulesetId, plan.statisticIds);
    const result = gradeRuleset({ characterIds: ids, valueOf, plan, settings: s });
    if (write) await db.tx((q) => writeRuleset(q, rulesetId, result, { plan, settings: s, at: new Date(now()) }));
    out.push({ rulesetId, version: v, population: result.population, graded: result.graded, distribution: result.graded ? distributionOf(result, plan) : null, ms: Date.now() - t0 });
  }
  if (write && rulesets.length && !version) {
    // A character that moved ruleset, or a ruleset nobody is on any more, leaves no stale rows behind.
    await db.query('DELETE FROM character_category_tiers WHERE NOT (ruleset_id = ANY($1::int[]))', [rulesets]);
    await db.query('DELETE FROM character_tiers WHERE NOT (ruleset_id = ANY($1::int[]))', [rulesets]);
    await db.query('DELETE FROM tier_rulesets WHERE NOT (ruleset_id = ANY($1::int[]))', [rulesets]);
  }
  // "counted" is the primary version's (or the one asked for): what the admin's Tiers page shows.
  const counted = (await forVersion(version ?? PRIMARY_VERSION.id)).plan.statisticIds.length;
  return { rulesets: out, ms: now() - started, counted };
}

/**
 * A character's live percentiles in the given statistics against everyone eligible on its ruleset now.
 * → { population, pct: Map(id → percentile), nonzero: Map(id → bool) }
 */
export async function livePercentiles(q, { characterId, rulesetId, statisticIds, build = undefined }) {
  // 0.11.1: from the distribution build when there is one (the same counts, as of that build, with the eligible
  // population counted in the same pass); else counted now, as before.
  const b = build !== undefined ? build : await activeBuild(q);
  const eligibleAtBuild = b ? b.populations?.[String(rulesetId)]?.eligible : undefined;
  const fromBuild = b && eligibleAtBuild !== undefined;
  const population = fromBuild ? eligibleAtBuild : await eligibleCount(q, rulesetId);
  // One pass over each statistic's non-zero values (the board's partial index): how many have any, how many are
  // strictly above this character, and how many share its value.
  const rows = fromBuild ? await percentileRowsFrom(q, b, { characterId, rulesetId, statisticIds }) : statisticIds.length ? await q.query(
    `SELECT s.id AS statistic_id, coalesce(m.value, 0) AS v, x.nonzero, x.above, x.equal
       FROM unnest($3::bigint[]) AS s(id)
       LEFT JOIN character_statistics m ON m.character_id = $1 AND m.statistic_id = s.id AND NOT m.hidden
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS nonzero, count(*) FILTER (WHERE o.value > coalesce(m.value, 0))::int AS above,
                count(*) FILTER (WHERE o.value = m.value)::int AS equal
           FROM character_statistics o WHERE o.statistic_id = s.id AND o.ruleset_id = $2 AND NOT o.hidden AND o.value > 0) x
      LIMIT 5000`,
    [characterId, rulesetId, statisticIds],
  ) : [];
  const pct = new Map();
  const nonzero = new Map();
  for (const r of rows) {
    const id = Number(r.statistic_id);
    const zeros = Math.max(0, population - r.nonzero);
    const has = r.v > 0;
    const equal = has ? Math.max(1, r.equal) : zeros;
    const below = has ? zeros + Math.max(0, r.nonzero - r.above - equal) : 0;
    pct.set(id, percentileOf({ below, equal, population }));
    nonzero.set(id, has);
  }
  return { population, pct, nonzero };
}

/**
 * Grades one character (CHARACTER), against its ruleset's last full grading: that grading's plan, settings and
 * cutoffs, with the character's percentiles counted live. Not eligible, or the ruleset not graded: its rows go.
 * Takes a db or a transaction. → the letter, or null.
 */
export async function gradeCharacter(q, characterId, { now = Date.now, build = undefined } = {}) {
  const c = await q.one('SELECT id, ruleset_id FROM characters WHERE id = $1', [characterId]);
  const drop = async () => {
    await q.query('DELETE FROM character_category_tiers WHERE character_id = $1', [characterId]);
    await q.query('DELETE FROM character_tiers WHERE character_id = $1', [characterId]);
    return null;
  };
  if (!c || c.ruleset_id === null) return drop();
  const eligible = await q.one(`SELECT 1 AS x FROM characters c WHERE ${ELIGIBLE} AND c.id = $2`, [c.ruleset_id, characterId]);
  if (!eligible) return drop();
  const tr = await q.one('SELECT * FROM tier_rulesets WHERE ruleset_id = $1', [c.ruleset_id]);
  if (!tr?.graded) return drop();
  const plan = tr.plan;
  const settings = tr.settings;
  const live = await livePercentiles(q, { characterId, rulesetId: c.ruleset_id, statisticIds: plan.statisticIds, build });
  if (!isGraded(live.population, settings.minPopulation)) return drop();
  const s = scoreCharacter(plan, settings, (id) => live.pct.get(id) ?? 0, (id) => live.nonzero.get(id) ?? false);
  const cats = s.categories.map((cat) => ({ ...cat, letter: cat.eligible ? letterForScore(cat.score, tr.scopes[cat.key]?.cutoffs) : null }));
  const lettered = plan.categories.reduce((k, pc, i) => k + (pc.inOverall && cats[i].letter ? 1 : 0), 0);
  const letter = s.overallScore !== null && lettered >= s.overallNeeded ? letterForScore(s.overallScore, tr.scopes.overall?.cutoffs) : null;
  const reason = letter ? null : s.overallScore === null ? 'no_categories' : 'few_categories';
  const at = new Date(now());
  // 0.11.1: upserts, and only the categories it no longer has are removed: a full grading writing the same character at
  // the same moment can't collide with this (it used to: unique violation 23505).
  await q.query('DELETE FROM character_category_tiers WHERE character_id = $1 AND NOT (category_key = ANY($2::text[]))', [characterId, cats.map((x) => x.key)]);
  await q.query(
    `INSERT INTO character_tiers (character_id, ruleset_id, score, letter, reason, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bigint[], $10::real[], 'character', $11)
     ON CONFLICT (character_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, score = EXCLUDED.score, letter = EXCLUDED.letter,
       reason = EXCLUDED.reason, lettered = EXCLUDED.lettered, needed = EXCLUDED.needed, total = EXCLUDED.total, stat_ids = EXCLUDED.stat_ids,
       stat_pcts = EXCLUDED.stat_pcts, graded_by = 'character', computed_at = EXCLUDED.computed_at`,
    [characterId, c.ruleset_id, s.overallScore, letter, reason, lettered, s.overallNeeded, s.overallCategories, plan.statisticIds,
      plan.statisticIds.map((id) => Math.round((live.pct.get(id) ?? 0) * 100) / 100), at],
  );
  if (cats.length) {
    await q.query(
      `INSERT INTO character_category_tiers (character_id, category_key, ruleset_id, score, overall_part, letter, nonzero, needed, counted, computed_at)
       SELECT $1, v.key, $2, v.score, v.part, v.letter, v.nonzero, v.needed, v.counted, $10
         FROM unnest($3::text[], $4::float8[], $5::float8[], $6::text[], $7::smallint[], $8::smallint[], $9::smallint[]) AS v(key, score, part, letter, nonzero, needed, counted)
       ON CONFLICT (character_id, category_key) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, score = EXCLUDED.score, overall_part = EXCLUDED.overall_part,
         letter = EXCLUDED.letter, nonzero = EXCLUDED.nonzero, needed = EXCLUDED.needed, counted = EXCLUDED.counted, computed_at = EXCLUDED.computed_at`,
      [characterId, c.ruleset_id, cats.map((x) => x.key), cats.map((x) => x.score), cats.map((x) => x.overallPart), cats.map((x) => x.letter),
        cats.map((x) => x.nonzero), cats.map((x) => x.needed), cats.map((x) => x.counted), at],
    );
  }
  return letter;
}

// The statistics a realm category's last full grading counted, remembered a minute per process: a fetch asks whether
// any value that moved is one of them.
const COUNTED_MEMO_MS = 60_000;
const countedMemo = new Map();
export async function countedIdsOf(db, rulesetId) {
  const hit = countedMemo.get(rulesetId);
  if (hit && Date.now() - hit.at < COUNTED_MEMO_MS) return hit.ids;
  const row = await db.one("SELECT plan->'statisticIds' AS ids FROM tier_rulesets WHERE ruleset_id = $1 AND graded", [rulesetId]);
  const ids = new Set((Array.isArray(row?.ids) ? row.ids : []).map(Number));
  countedMemo.set(rulesetId, { at: Date.now(), ids });
  return ids;
}
export const clearCountedMemo = () => countedMemo.clear();

/**
 * After a fetch wrote a character's values: does its tier need grading again? Only when a statistic its realm category
 * counts moved (`changed`: the ids that did), when `force` says its standing changed, or when it has no tier row yet.
 * Then it is graded at once (`inline`: a person is waiting on the page) or noted for the worker's batch.
 * → 'graded' | 'queued' | null (nothing to do)
 */
export async function noteForGrading(db, characterId, { changed = new Set(), force = false, inline = false, now = Date.now } = {}) {
  const c = await db.one('SELECT ruleset_id FROM characters WHERE id = $1', [characterId]);
  if (!c) return null;
  let need = force;
  if (!need && c.ruleset_id !== null && changed.size) {
    const counted = await countedIdsOf(db, c.ruleset_id);
    for (const id of changed) if (counted.has(Number(id))) { need = true; break; }
  }
  if (!need) need = !(await db.one('SELECT 1 AS x FROM character_tiers WHERE character_id = $1', [characterId]));
  if (!need) return null;
  if (inline) {
    await gradeCharacter(db, characterId, { now });
    await db.query('DELETE FROM grading_queue WHERE character_id = $1', [characterId]);
    return 'graded';
  }
  await db.query('INSERT INTO grading_queue (character_id) VALUES ($1) ON CONFLICT (character_id) DO UPDATE SET queued_at = now()', [characterId]);
  return 'queued';
}

/**
 * The worker's 'grade-queue' job body: grades noted characters, oldest first, for at most `budgetMs`, `concurrency` at
 * a time. Never while a full grading is running (it would grade them all anyway, and the two would write the same
 * rows); a note taken before a full grading started is dropped when that grading finishes. → { graded, left }
 */
export async function gradeQueued(db, { now = Date.now, budgetMs = 20_000, limit = 500, concurrency = 1, log = console } = {}) {
  if (await db.one("SELECT 1 AS x FROM tier_runs WHERE status = 'running' LIMIT 1")) return { graded: 0, left: null, waiting: 'a full grading is running' };
  // Read before the list: a note taken again after this moment stays in the queue for the next pass.
  const readAt = (await db.one('SELECT now() AS t')).t;
  const rows = await db.query('SELECT character_id FROM grading_queue ORDER BY queued_at, character_id LIMIT $1', [limit]);
  const t0 = Date.now();
  // One build for the whole batch (null: the switch is off or nothing is built, so each is counted directly).
  const build = await activeBuild(db);
  let graded = 0;
  let next = 0;
  async function lane() {
    while (next < rows.length && Date.now() - t0 < budgetMs) {
      const r = rows[next];
      next += 1;
      try {
        await gradeCharacter(db, r.character_id, { now, build });
      } catch (err) {
        log.error(`[tiers] character grading failed: ${err.code ?? err.name}`);
      }
      // Gone from the queue unless it was noted again meanwhile.
      await db.query('DELETE FROM grading_queue WHERE character_id = $1 AND queued_at < $2', [r.character_id, readAt]);
      graded += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 4)) }, lane));
  const left = (await db.one('SELECT count(*)::int AS n FROM grading_queue')).n;
  return { graded, left, waiting: null };
}

/**
 * Asks for a full grading (a decision or a tier setting changed). One pending request at a time: a request while one
 * is pending pushes its time forward, so a burst of decisions becomes one grading once TIER_DEBOUNCE_MS pass quietly.
 */
export async function requestTierRecompute(q, reason) {
  const r = String(reason).slice(0, 80);
  const bumped = await q.query(
    `UPDATE tier_runs SET requested_at = now(), reasons = CASE WHEN $1 = ANY(reasons) THEN reasons ELSE (reasons || ARRAY[$1])[1:20] END
      WHERE status = 'pending' RETURNING id`,
    [r],
  );
  if (bumped.length) return bumped[0].id;
  const made = await q.query("INSERT INTO tier_runs (status, reasons) VALUES ('pending', ARRAY[$1]) ON CONFLICT DO NOTHING RETURNING id", [r]);
  return made[0]?.id ?? null;
}

/** Why a full grading is due now, or null. */
export async function dueReason(db, { now = Date.now } = {}) {
  // 0.11.1: after a failed grading the next one waits (1 minute, doubling to an hour), whatever asked for it. Until
  // now a failure left the last good grading "6 hours old", so the job started over on its next 15-second tick.
  const wait = await failureWait(db, { now });
  if (wait.waitMs > 0) return null;
  const pending = await db.one("SELECT id, reasons, requested_at FROM tier_runs WHERE status = 'pending' LIMIT 1");
  if (pending && now() - new Date(pending.requested_at).getTime() >= TIER_DEBOUNCE_MS) return { pendingId: pending.id, reasons: pending.reasons };
  const last = await db.one("SELECT finished_at FROM tier_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1");
  if (!last) return { reasons: ['first grading'] };
  const age = now() - new Date(last.finished_at).getTime();
  if (age >= FULL_EVERY_MS) return { reasons: ['scheduled'] };
  // A ruleset that crossed the minimum (either way) since the last full grading.
  // 0.10.0: each version's categories against that version's own minimum.
  for (const v of enabledVersions()) {
    const minPopulation = await getSetting(db, 'grading.minPopulation', { version: v.id });
    const crossed = await db.one(
      `SELECT r.id FROM rulesets r LEFT JOIN tier_rulesets t ON t.ruleset_id = r.id
        WHERE r.game_version = $2 AND coalesce(t.graded, false) <> ((SELECT count(*) FROM characters c WHERE ${ELIGIBLE.replace(/\$1/g, 'r.id')}) >= $1)
        LIMIT 1`,
      [minPopulation, v.id],
    );
    if (crossed) return { reasons: ['a ruleset crossed the minimum'] };
  }
  // After the daily refresh: nothing of it left in the queue, and characters fetched since the last grading.
  if (age >= AFTER_REFRESH_MIN_MS) {
    const { PRIORITY } = await import('../crawler/queue.js');
    const busy = await db.one("SELECT 1 AS x FROM crawl_queue WHERE state IN ('queued', 'running') AND priority = $1 LIMIT 1", [PRIORITY.daily]);
    const fetched = await db.one('SELECT 1 AS x FROM characters WHERE stats_fetched_at > $1 LIMIT 1', [last.finished_at]);
    if (!busy && fetched) return { reasons: ['after the daily refresh'] };
  }
  return null;
}

/**
 * Failed gradings in a row since the last one that finished, and how long the next attempt still has to wait.
 * → { failures, waitMs, nextAt, problem }
 */
export async function failureWait(db, { now = Date.now } = {}) {
  const rows = await db.query("SELECT status, finished_at, problem FROM tier_runs WHERE status IN ('done', 'failed') ORDER BY id DESC LIMIT 30");
  let failures = 0;
  for (const r of rows) {
    if (r.status !== 'failed') break;
    failures += 1;
  }
  if (!failures) return { failures: 0, waitMs: 0, nextAt: null, problem: null };
  const nextAt = new Date(rows[0].finished_at ?? now()).getTime() + failBackoffMs(failures);
  return { failures, waitMs: Math.max(0, nextAt - now()), nextAt: new Date(nextAt), problem: rows[0].problem ?? null };
}

/** The worker's tiers job body: a full grading when one is due. → summary text. */
export async function runDueTierWork(db, { now = Date.now, log = console } = {}) {
  await db.query(
    "UPDATE tier_runs SET status = 'failed', finished_at = now(), problem = 'The worker stopped during this grading.' WHERE status = 'running' AND started_at < now() - ($1 || ' milliseconds')::interval",
    [String(STALE_RUN_MS)],
  );
  const due = await dueReason(db, { now });
  if (!due) {
    const wait = await failureWait(db, { now });
    return wait.waitMs > 0 ? `Grading failed ${wait.failures} time(s) in a row (${wait.problem ?? 'error'}): next try at ${wait.nextAt.toISOString().slice(11, 16)} UTC` : null;
  }
  const run = due.pendingId
    ? await db.one("UPDATE tier_runs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", [due.pendingId])
    : await db.one("INSERT INTO tier_runs (status, reasons, started_at) VALUES ('running', $1::text[], now()) RETURNING id", [due.reasons]);
  if (!run) return null;
  try {
    const startedAt = (await db.one('SELECT started_at FROM tier_runs WHERE id = $1', [run.id]))?.started_at ?? new Date(now());
    const result = await gradeAll(db, { now });
    // Every character noted before this grading began has just been graded with everyone else.
    await db.query('DELETE FROM grading_queue WHERE queued_at < $1', [startedAt]);
    clearCountedMemo();
    const summary = {
      counted: result.counted,
      rulesets: result.rulesets.map((r) => ({ rulesetId: r.rulesetId, population: r.population, graded: r.graded, overall: r.distribution?.overall ?? null, ms: r.ms })),
    };
    await db.query("UPDATE tier_runs SET status = 'done', finished_at = now(), ms = $2, summary = $3::jsonb WHERE id = $1", [run.id, result.ms, JSON.stringify(summary)]);
    return `Graded ${result.rulesets.length} ruleset(s) in ${result.ms} ms (${due.reasons.join(', ')})`;
  } catch (err) {
    log.error(`[tiers] grading failed: ${err.code ?? err.name}`);
    await db.query("UPDATE tier_runs SET status = 'failed', finished_at = now(), problem = $2 WHERE id = $1", [run.id, String(err.code ?? err.name).slice(0, 300)]);
    return 'Grading failed';
  }
}

/** The preview for the admin: what each ruleset's letters would be with `settings`, nothing written. */
export async function previewTiers(db, settings, { version = PRIMARY_VERSION.id } = {}) {
  const counting = await countingNow(db, { fresh: true, version });
  const result = await gradeAll(db, { settings, counting, write: false, version });
  const names = new Map((await db.query('SELECT id, name FROM rulesets LIMIT 100')).map((r) => [r.id, r.name]));
  const labels = new Map(counting.plan.categories.map((c) => [c.key, c.label]));
  return {
    ms: result.ms,
    counted: result.counted,
    rulesets: result.rulesets.map((r) => ({
      id: r.rulesetId,
      name: names.get(r.rulesetId) ?? null,
      population: r.population,
      graded: r.graded,
      overall: r.distribution?.overall ?? null,
      categories: r.distribution ? Object.entries(r.distribution).filter(([k]) => k !== 'overall').map(([key, d]) => ({ key, label: labels.get(key) ?? key, letters: d })) : [],
    })),
  };
}

/** Overall letters for a list of characters (pages that list characters): Map(id → letter | null). */
export async function lettersFor(db, characterIds) {
  const ids = [...new Set(characterIds.filter((x) => x !== null && x !== undefined).map(Number))];
  if (!ids.length) return new Map();
  const rows = await db.query('SELECT character_id, letter FROM character_tiers WHERE character_id = ANY($1::bigint[]) LIMIT 5000', [ids]);
  return new Map(rows.map((r) => [Number(r.character_id), r.letter]));
}
