import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Letter tiers (0.6.0). The engine is tested pure; the rest on a real (in-memory) database with characters and
// statistics written directly (test fixtures, never shipped data) and decisions made through the real admin API, so
// "a statistic counts only once the owner approves it" is tested end to end.

// ---------------------------------------------------------------- the engine, pure
test('percentiles are mid-rank: ties share one, zeros share the bottom', async () => {
  const { percentiles } = await import('../tiers/engine.js');
  const p = percentiles(Float64Array.from([0, 0, 5, 5, 9]));
  assert.deepEqual([...p], [20, 20, 60, 60, 90]);
  assert.deepEqual([...percentiles(Float64Array.from([3]))], [50]);
});

test('letters follow the shares, ties share a letter, and a zero share gives nobody that letter', async () => {
  const { placeScores } = await import('../tiers/engine.js');
  const scores = Array.from({ length: 100 }, (_, i) => 100 - i);
  const r = placeScores(scores, { S: 5, A: 15, B: 30, C: 30, D: 20 });
  assert.deepEqual(r.counts, { S: 5, A: 15, B: 30, C: 30, D: 20 });
  assert.equal(r.cutoffs.S, 96);
  assert.equal(r.cutoffs.D, 1);
  const tied = placeScores([10, 10, 10, 1], { S: 5, A: 15, B: 30, C: 30, D: 20 });
  assert.deepEqual(tied.letters, ['S', 'S', 'S', 'C']); // rank 4 of 4: 75 % are above it
  const noS = placeScores([10, 9], { S: 0, A: 50, B: 0, C: 0, D: 50 });
  assert.deepEqual(noS.letters, ['A', 'D']);
  const unplaced = placeScores([null, 5], { S: 5, A: 15, B: 30, C: 30, D: 20 });
  assert.deepEqual(unplaced.letters, [null, 'S']);
});

test('a letter for a score placed against stored cutoffs', async () => {
  const { letterForScore } = await import('../stats/tiers.js');
  const cut = { S: 90, A: 70, B: 40, C: 20, D: 1 };
  assert.equal(letterForScore(95, cut), 'S');
  assert.equal(letterForScore(70, cut), 'A');
  assert.equal(letterForScore(0.5, cut), 'D');
  assert.equal(letterForScore(80, { S: null, A: 70, B: null, C: null, D: 5 }), 'A');
});

test('categories weigh the same, a category without a letter still counts its score, and the half rules hold', async () => {
  const { gradeRuleset } = await import('../tiers/engine.js');
  // Two overall categories: "big" with 4 statistics, "small" with 1. Character 0 tops the small one only.
  const plan = {
    statisticIds: [1, 2, 3, 4, 5],
    categories: [
      { key: 'big', label: 'Big', farmable: false, inOverall: true, statisticIds: [1, 2, 3, 4], overallIds: [1, 2, 3, 4] },
      { key: 'small', label: 'Small', farmable: false, inOverall: true, statisticIds: [5], overallIds: [5] },
    ],
    ungraded: [],
  };
  const n = 10;
  const v = (f) => Float64Array.from({ length: n }, (_, i) => f(i));
  const values = { 1: v((i) => i), 2: v((i) => i), 3: v((i) => i), 4: v((i) => i), 5: v((i) => (i === 0 ? 100 : 0)) };
  const settings = { shares: { S: 10, A: 20, B: 20, C: 30, D: 20 }, minPopulation: 5, categoryHalf: 50, overallHalf: 50 };
  const r = gradeRuleset({ characterIds: [...Array(n).keys()], valueOf: (id) => values[id], plan, settings });
  const c0 = r.characters[0];
  // Character 0 has nothing in "big" (0 of 4 above zero, needs 2): no letter there, but a letter in "small".
  assert.equal(c0.categories[0].letter, null);
  assert.equal(c0.categories[1].letter, 'S');
  // 1 of 2 overall categories lettered meets the 50 % rule; its overall score averages BOTH categories equally.
  assert.equal(c0.letter !== null, true);
  assert.equal(c0.score, Math.round(((c0.categories[0].overallPart + c0.categories[1].overallPart) / 2) * 1e6) / 1e6);
  // Raise the overall rule to 100 %: character 0 now needs both, so it is Unranked, with the reason.
  const strict = gradeRuleset({ characterIds: [...Array(n).keys()], valueOf: (id) => values[id], plan, settings: { ...settings, overallHalf: 100 } });
  assert.equal(strict.characters[0].letter, null);
  assert.equal(strict.characters[0].reason, 'few_categories');
  // Below the ruleset minimum nobody is graded.
  assert.equal(gradeRuleset({ characterIds: [1, 2], valueOf: () => null, plan, settings }).graded, false);
});

// 0.8.0: weighted categories.
const weightPlan = (counts) => ({
  categories: Object.entries(counts).map(([key, n]) => ({ key, label: key, inOverall: true, statisticIds: Array.from({ length: n }, (_, i) => i), overallIds: Array.from({ length: n }, (_, i) => i) })),
});

test('category weights follow the square root of their statistics and add up to 1', async () => {
  const { categoryWeights } = await import('../tiers/engine.js');
  // The counts the owner quoted for 0.8.0: Professions 27, Dungeons & Raids 14, Character 14, PvP 9, Combat 9, Adventure 4.
  const plan = weightPlan({ professions: 27, dungeons: 14, character: 14, pvp: 9, combat: 9, adventure: 4 });
  const w = categoryWeights(plan, { weighting: 'sqrt' });
  const pct = Object.fromEntries(w.map((x) => [x.key, Math.round(x.weight * 1000) / 10]));
  assert.deepEqual(pct, { professions: 25.1, dungeons: 18.1, character: 18.1, pvp: 14.5, combat: 14.5, adventure: 9.7 });
  assert.ok(Math.abs(w.reduce((n, x) => n + x.weight, 0) - 1) < 1e-12);
  // A grading stored before 0.8.0 (no weighting in its settings) keeps equal weights.
  assert.ok(categoryWeights(plan, {}).every((x) => Math.abs(x.weight - 1 / 6) < 1e-12));
});

test('a pinned weight is kept and the others share the rest by the formula; bad pins are refused in words', async () => {
  const { categoryWeights, weightsProblem } = await import('../tiers/engine.js');
  const plan = weightPlan({ a: 16, b: 4, c: 1 }); // √: 4, 2, 1
  const w = categoryWeights(plan, { weighting: 'sqrt', weights: { a: 50, gone: 30 } });
  assert.equal(w[0].weight, 0.5);
  assert.ok(Math.abs(w[1].weight - 0.5 * (2 / 3)) < 1e-12); // b and c share 50 % as 2 : 1
  assert.ok(Math.abs(w[2].weight - 0.5 * (1 / 3)) < 1e-12);
  assert.equal(w[0].pinned, 50);
  assert.equal(w[1].pinned, null);
  // Every category pinned: scaled to exactly 100.
  const all = categoryWeights(plan, { weighting: 'sqrt', weights: { a: 50, b: 30, c: 20 } });
  assert.deepEqual(all.map((x) => Math.round(x.weight * 100)), [50, 30, 20]);
  assert.equal(weightsProblem(plan, { a: 50, gone: 99 }), null); // a pin for a category not in the overall tier is ignored
  assert.match(weightsProblem(plan, { a: 60, b: 40 }), /leaves nothing for the 1 you didn’t pin/);
  assert.match(weightsProblem(plan, { a: 50, b: 30, c: 10 }), /must add up to 100% \(they add up to 90%\)/);
});

test('the overall score is the weighted average of the category parts', async () => {
  const { scoreCharacter } = await import('../tiers/engine.js');
  const plan = { statisticIds: [1, 2, 3, 4, 5], categories: [
    { key: 'big', label: 'Big', inOverall: true, statisticIds: [1, 2, 3, 4], overallIds: [1, 2, 3, 4] },
    { key: 'small', label: 'Small', inOverall: true, statisticIds: [5], overallIds: [5] },
  ] };
  const pct = { 1: 80, 2: 80, 3: 80, 4: 80, 5: 20 };
  const base = { categoryHalf: 50, overallHalf: 50 };
  const equal = scoreCharacter(plan, base, (id) => pct[id], () => true);
  assert.equal(equal.overallScore, 50);
  const weighted = scoreCharacter(plan, { ...base, weighting: 'sqrt' }, (id) => pct[id], () => true);
  assert.equal(weighted.overallScore, 60); // √4 : √1 = 2 : 1 → (80·2 + 20) / 3
});

test('a farmable category gets its own letter and never reaches the overall score', async () => {
  const { gradeRuleset } = await import('../tiers/engine.js');
  const plan = {
    statisticIds: [1, 2],
    categories: [
      { key: 'combat', label: 'Combat', farmable: false, inOverall: true, statisticIds: [1], overallIds: [1] },
      { key: 'social', label: 'Social', farmable: true, inOverall: false, statisticIds: [2], overallIds: [] },
    ],
    ungraded: [],
  };
  const settings = { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 2, categoryHalf: 50, overallHalf: 50 };
  const a = gradeRuleset({ characterIds: [1, 2, 3], valueOf: (id) => (id === 1 ? Float64Array.from([1, 2, 3]) : Float64Array.from([1, 2, 3])), plan, settings });
  const b = gradeRuleset({ characterIds: [1, 2, 3], valueOf: (id) => (id === 1 ? Float64Array.from([1, 2, 3]) : Float64Array.from([300, 2, 1])), plan, settings });
  assert.deepEqual(a.characters.map((c) => c.score), b.characters.map((c) => c.score));
  assert.notEqual(a.characters[0].categories[1].letter, b.characters[0].categories[1].letter);
});

// ---------------------------------------------------------------- on a database
let t;
let admin;
const RS = 2;
const N = 60;
const STATS = [
  [101, 'Creatures killed', 'Kills'],
  [102, 'Critters killed', 'Kills'],
  [103, 'Quests completed', 'Quests'],
  [104, 'Flight paths taken', 'Travel'],
  [105, 'Hugs given', 'Social'],
  [106, 'Total deaths', 'Deaths'],
];
// Letter-only names (a name never holds a digit): 1 → 'ab', 2 → 'ac', …
const code = (i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
const slugOf = (i) => `tester${code(i)}-fixture`;
const valueOf = (i, statId) => ({ 101: i * 10, 102: i % 7 === 0 ? 0 : i, 103: N + 1 - i, 104: i > 30 ? i : 0, 105: i, 106: i })[statId];

before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 404 }) });
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
  await t.db.query("INSERT INTO rulesets (id, name, listed) VALUES ($1, 'Normal', true)", [RS]);
  for (const [id, name, cat] of STATS) {
    await t.db.query('INSERT INTO statistics (id, name, category_path) VALUES ($1, $2, $3::jsonb)', [id, name, JSON.stringify([{ id: 1, name: cat }])]);
  }
  for (let i = 1; i <= N; i++) {
    await t.db.query(
      `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, data_fetched_at)
       VALUES ($1, $2, $3, 'Fixture', $4, 30, 'ok', 'lookup', now(), now(), now())`,
      [i, slugOf(i), `Tester${code(i)}`, RS],
    );
    for (const [id] of STATS) {
      const v = valueOf(i, id);
      if (v > 0) await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES ($1, $2, $3, $4, now())', [i, id, RS, v]);
    }
  }
});
after(() => t.close());

const decide = (statisticId, kind, decision = 'approved') => t.client().put('/api/admin/discovery/decisions', { combined: true, statisticId, kind, decision }, admin);
const gradeNow = async () => {
  const { gradeAll } = await import('../tiers/store.js');
  return gradeAll(t.db);
};
const tierOf = async (id) => t.db.one('SELECT * FROM character_tiers WHERE character_id = $1', [id]);

test('nothing approved: nothing counts, and the character page says so in words', async () => {
  const { countingNow } = await import('../tiers/store.js');
  const { counts, plan } = await countingNow(t.db, { fresh: true });
  assert.equal(plan.statisticIds.length, 0);
  assert.ok([...counts.statistics.values()].every((s) => s.role === 'undecided'));
  await gradeNow();
  const page = (await t.client().get(`/api/characters/${slugOf(N)}`)).json;
  assert.equal(page.tiers.status, 'graded');
  assert.equal(page.tiers.overall.letter, null);
  assert.match(page.tiers.overall.reason.text, /No category counts toward the overall tier yet/);
});

test('a statistic counts only once its category AND what it counts toward are approved', async () => {
  for (const id of [101, 102, 103, 104]) assert.equal((await decide(id, 'category')).status, 200);
  const { countingNow } = await import('../tiers/store.js');
  let { plan } = await countingNow(t.db, { fresh: true });
  assert.equal(plan.statisticIds.length, 0, 'a category alone counts nothing');
  for (const id of [101, 102, 103]) await decide(id, 'grading');
  ({ plan } = await countingNow(t.db, { fresh: true }));
  assert.deepEqual(plan.statisticIds.sort(), [101, 102, 103]);
  assert.deepEqual(plan.categories.map((c) => c.label).sort(), ['Adventure', 'Combat']);
});

test('a burst of decisions makes one pending grading, which waits for a quiet moment', async () => {
  const pending = await t.db.query("SELECT * FROM tier_runs WHERE status = 'pending'");
  assert.equal(pending.length, 1);
  // Migration 017 (0.8.0) asks for one grading with category weights; the decisions above join that same request.
  assert.deepEqual(pending[0].reasons, ['category weights (0.8.0)', 'decision']);
  const { dueReason, runDueTierWork, TIER_DEBOUNCE_MS } = await import('../tiers/store.js');
  // The first grading ever ran above (directly), but tier_runs has no 'done' row: inside the quiet period a pending
  // request still waits.
  await t.db.query("INSERT INTO tier_runs (status, finished_at) VALUES ('done', now())");
  assert.equal(await dueReason(t.db), null);
  const later = () => Date.now() + TIER_DEBOUNCE_MS + 1000;
  assert.deepEqual((await dueReason(t.db, { now: later })).reasons, ['category weights (0.8.0)', 'decision']);
  assert.match(await runDueTierWork(t.db, { now: later, log: { error() {} } }), /Graded 1 ruleset/);
  assert.equal((await t.db.query("SELECT 1 FROM tier_runs WHERE status = 'pending'")).length, 0);
});

test('letters follow the shares among everyone on the ruleset, and the page shows what fed them', async () => {
  const rows = await t.db.query('SELECT letter, count(*)::int AS n FROM character_tiers WHERE letter IS NOT NULL GROUP BY letter');
  const by = Object.fromEntries(rows.map((r) => [r.letter, r.n]));
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total <= N);
  assert.ok(by.S >= 1 && by.S <= Math.ceil(total * 0.05) + 1);
  const page = (await t.client().get(`/api/characters/${slugOf(N)}`)).json.tiers;
  assert.equal(page.status, 'graded');
  const combat = page.categories.find((c) => c.label === 'Combat');
  assert.equal(combat.counted, 2);
  assert.ok(combat.statistics.every((s) => Number.isFinite(s.percentile) && s.name));
  assert.ok(Number.isInteger(page.overall.rank) && page.overall.of === total);
});

test('the per-category half rule: one lucky statistic is not enough', async () => {
  // Character 7: Creatures killed 70, Critters killed 0 (7 % 7): 1 of 2 Combat statistics → meets 50 %.
  const seven = (await t.db.query("SELECT * FROM character_category_tiers WHERE character_id = 7 AND category_key = 'combat'"))[0];
  assert.equal(seven.nonzero, 1);
  assert.equal(seven.needed, 1);
  // At 100 % it needs both: no Combat letter for character 7, with the reason in words.
  assert.equal((await t.client().put('/api/admin/tiers/settings', { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 50, categoryHalf: 100, overallHalf: 50 }, admin)).status, 200);
  await gradeNow();
  const page = (await t.client().get(`/api/characters/${slugOf(7)}`)).json.tiers;
  const combat = page.categories.find((c) => c.label === 'Combat');
  assert.equal(combat.letter, null);
  assert.match(combat.reason.text, /at least 2 of this category’s 2 graded statistics \(has 1\)/);
  await t.client().put('/api/admin/tiers/settings', { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 }, admin);
});

test('rejecting a decision stops a statistic counting; bad and farmable statistics never reach the overall tier', async () => {
  await decide(103, 'grading', 'rejected');
  for (const id of [105, 106]) await decide(id, 'category');
  await decide(105, 'grading'); // Social: farmable, its own tier only
  await decide(106, 'grading'); // Total deaths: "no tier: leaderboard only"
  const { countingNow } = await import('../tiers/store.js');
  const { plan, counts } = await countingNow(t.db, { fresh: true });
  assert.ok(!plan.statisticIds.includes(103), 'rejected');
  assert.ok(!plan.statisticIds.includes(106), 'bad');
  assert.equal(counts.statistics.get(106).role, 'bad');
  const social = plan.categories.find((c) => c.label === 'Social');
  assert.equal(social.farmable, true);
  assert.equal(social.inOverall, false);
  assert.ok(!plan.categories.filter((c) => c.inOverall).some((c) => c.statisticIds.includes(105)));
  await gradeNow();
  const page = (await t.client().get(`/api/characters/${slugOf(N)}`)).json.tiers;
  assert.ok(page.categories.find((c) => c.label === 'Social').letter, 'Social has its own letter');
  assert.ok(!page.categories.some((c) => c.label === 'Deaths & mishaps'));
});

test('an approved duplicate is graded once; a pairing still undecided counts as nothing', async () => {
  const { whatCounts } = await import('../tiers/counting.js');
  const { loadCatalogFresh } = await import('../stats/catalog.js');
  await t.db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision) VALUES (102, 'duplicate', '{\"of\": 101}', 'approved')");
  const counts = whatCounts(await loadCatalogFresh(t.db));
  assert.equal(counts.statistics.get(102).role, 'duplicate');
  assert.equal(counts.statistics.get(101).role, 'counted');
  await t.db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision) VALUES (102, 'duplicate', '{\"of\": 101}', 'cleared')");
  assert.equal(whatCounts(await loadCatalogFresh(t.db)).statistics.get(102).role, 'counted');
});

test('one character is graded on its own against the stored cutoffs; nobody else moves', async () => {
  await gradeNow();
  const before1 = await tierOf(1);
  const others = await t.db.query('SELECT character_id, letter, computed_at FROM character_tiers WHERE character_id <> 1 ORDER BY character_id');
  for (const id of [101, 102, 105]) await t.db.query('UPDATE character_statistics SET value = 100000 WHERE character_id = 1 AND statistic_id = $1', [id]);
  await t.db.query("INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES (1, 102, $1, 100000, now()) ON CONFLICT (character_id, statistic_id) DO UPDATE SET value = 100000", [RS]);
  const { gradeCharacter } = await import('../tiers/store.js');
  const letter = await gradeCharacter(t.db, 1);
  const after1 = await tierOf(1);
  assert.notEqual(before1.letter, 'S');
  assert.equal(letter, 'S');
  assert.equal(after1.graded_by, 'character');
  assert.deepEqual(await t.db.query('SELECT character_id, letter, computed_at FROM character_tiers WHERE character_id <> 1 ORDER BY character_id'), others);
});

test('a hidden character has no tier and is on no tier board; shown again, it is graded at once', async () => {
  const { setHidden } = await import('../crawler/store.js');
  await t.db.tx((q) => setHidden(q, 1, true));
  assert.equal(await tierOf(1), null);
  const board = (await t.client().get(`/api/tiers/boards?ruleset=${RS}`)).json;
  assert.ok(!board.rows.some((r) => r.slug === slugOf(1)));
  await t.db.tx((q) => setHidden(q, 1, false));
  assert.equal((await tierOf(1)).letter, 'S');
});

test('the tier board: best first, ties share a rank, Unranked counted not listed, a category board too', async () => {
  const board = (await t.client().get(`/api/tiers/boards?ruleset=${RS}&limit=100`)).json;
  assert.equal(board.graded, true);
  assert.equal(board.rows.length, board.placed);
  assert.equal(board.placed + board.unranked, N);
  for (let i = 1; i < board.rows.length; i++) {
    assert.ok(board.rows[i].score <= board.rows[i - 1].score);
    if (board.rows[i].score === board.rows[i - 1].score) assert.equal(board.rows[i].rank, board.rows[i - 1].rank);
  }
  const social = (await t.client().get(`/api/tiers/boards?ruleset=${RS}&scope=social`)).json;
  assert.ok(social.rows.length > 0 && social.rows.every((r) => r.letter));
  assert.equal((await t.client().get(`/api/tiers/boards?ruleset=${RS}&scope=nope`)).status, 404);
});

test('admin: the preview changes nothing; shares must add up to 100; every change is logged', async () => {
  const before2 = await t.db.query('SELECT character_id, letter FROM character_tiers ORDER BY character_id');
  const c = t.client();
  const pv = await c.post('/api/admin/tiers/preview', { shares: { S: 50, A: 50, B: 0, C: 0, D: 0 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 }, admin);
  assert.equal(pv.status, 200);
  const normal = pv.json.preview.rulesets.find((r) => r.id === RS);
  assert.equal(normal.overall.B + normal.overall.C + normal.overall.D, 0);
  assert.deepEqual(await t.db.query('SELECT character_id, letter FROM character_tiers ORDER BY character_id'), before2);
  const bad = await c.put('/api/admin/tiers/settings', { shares: { S: 5, A: 15, B: 30, C: 30, D: 10 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 }, admin);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /add up to 100 \(they add up to 90\)/);
  const events = await t.db.query("SELECT detail FROM admin_events WHERE type = 'setting.changed' AND detail->>'key' = 'tiers.categoryHalf'");
  assert.ok(events.length >= 2);
  const state = (await c.get('/api/admin/tiers', admin)).json;
  assert.ok(state.summary.some((s) => s.label === 'Combat' && s.counted >= 1));
  assert.ok(state.categories.every((x) => Array.isArray(x.undecided)));
  // Without an admin session: the same plain 404 as every admin route.
  assert.equal((await t.client().get('/api/admin/tiers')).status, 404);
});

test('admin: category weights are listed, a pin is checked against the live categories, saved, logged and used', async () => {
  const c = t.client();
  const state = (await c.get('/api/admin/tiers', admin)).json;
  assert.ok(state.weights.length >= 1);
  assert.ok(Math.abs(state.weights.reduce((n, w) => n + w.weight, 0) - 1) < 1e-9);
  const key = state.weights[0].key;
  const base = { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 };
  if (state.weights.length === 1) {
    const bad = await c.put('/api/admin/tiers/settings', { ...base, weights: { [key]: 40 } }, admin);
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /must add up to 100%/);
  } else {
    const too = await c.put('/api/admin/tiers/settings', { ...base, weights: { [key]: 99.9, ...Object.fromEntries(state.weights.slice(1).map((w) => [w.key, 1])) } }, admin);
    assert.equal(too.status, 400);
  }
  assert.equal((await c.put('/api/admin/tiers/settings', { ...base, weights: { [key]: 120 } }, admin)).status, 400);
  const ok = await c.put('/api/admin/tiers/settings', { ...base, weights: state.weights.length === 1 ? {} : { [key]: 30 } }, admin);
  assert.equal(ok.status, 200);
  if (state.weights.length > 1) {
    assert.equal(ok.json.weights[0].pinned, 30);
    assert.equal(ok.json.weights[0].weight, 0.3);
    const logged = await t.db.query("SELECT detail FROM admin_events WHERE type = 'setting.changed' AND detail->>'key' = 'tiers.weights'");
    assert.ok(logged.length >= 1);
    await gradeNow();
    const stored = await t.db.one('SELECT settings FROM tier_rulesets WHERE ruleset_id = $1', [RS]);
    assert.equal(stored.settings.weighting, 'sqrt');
    assert.deepEqual(stored.settings.weights, { [key]: 30 });
    await c.put('/api/admin/tiers/settings', { ...base, weights: {} }, admin);
  }
  const how = (await t.client().get('/api/tiers/how')).json;
  assert.ok(how.weights.every((w) => w.pinned === null));
});

test('below the ruleset minimum nobody is graded, and the page says how many are tracked so far', async () => {
  await t.client().put('/api/admin/tiers/settings', { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 100, categoryHalf: 50, overallHalf: 50 }, admin);
  await gradeNow();
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM character_tiers')).n, 0);
  const page = (await t.client().get(`/api/characters/${slugOf(N)}`)).json.tiers;
  assert.equal(page.status, 'unranked');
  assert.equal(page.reason.text, `Tiers open once 100 characters are tracked on Normal (${N - 0} so far).`);
  const how = (await t.client().get('/api/tiers/how')).json;
  assert.equal(how.settings.minPopulation, 100);
  assert.ok(how.categories.some((c) => c.label === 'Social' && c.farmable && c.counted.length === 1));
  await t.client().put('/api/admin/tiers/settings', { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 }, admin);
});
