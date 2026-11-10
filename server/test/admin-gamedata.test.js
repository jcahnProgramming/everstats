import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// 0.10.3 admin rework, game data pages (Tiers, Discovery): the server changes behind them. Tiers: per version from the
// switcher (?v=), each setting's default for the rows, the admin's reason in the audit log, and "Grade everyone now"
// answering with the grading it queued, which /api/admin/tiers/runs then follows to done with what it did on the
// version. Discovery: run lists, the catalog and decisions per version, and the endpoint probe matrix. Fixtures are
// written directly (test data, never shipped).

let t;
let admin;
const RS = 2;
const N = 60;
const STATS = [[101, 'Creatures killed', 'Kills'], [102, 'Critters killed', 'Kills'], [103, 'Quests completed', 'Quests']];
const code = (i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));

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
      [i, `tester${code(i)}-fixture`, `Tester${code(i)}`, RS],
    );
    for (const [id] of STATS) {
      await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES ($1, $2, $3, $4, now())', [i, id, RS, i * (id - 100)]);
    }
  }
});
after(() => t.close());

const decide = (statisticId, kind, extra = {}) => t.client().put('/api/admin/discovery/decisions', { combined: true, statisticId, kind, decision: 'approved', ...extra }, admin);
const BASE = { shares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, minPopulation: 50, categoryHalf: 50, overallHalf: 50 };

test('tiers: the version comes from ?v= too, each setting row gets its default, and an unknown version is refused', async () => {
  const c = t.client();
  const s = (await c.get('/api/admin/tiers?v=forever&r=us', admin)).json;
  assert.equal(s.version, 'forever');
  const pop = s.meta.find((m) => m.key === 'grading.minPopulation');
  assert.equal(pop.default, 50);
  assert.ok(pop.label && pop.help);
  assert.equal(pop.updatedAt, null);
  assert.deepEqual(s.meta.map((m) => m.key).sort(), ['grading.minPopulation', 'tiers.categoryHalf', 'tiers.overallHalf', 'tiers.shares', 'tiers.weights']);
  assert.equal((await c.get('/api/admin/tiers?v=retail', admin)).json.version, 'retail');
  assert.equal((await c.get('/api/admin/tiers?v=nonsense', admin)).status, 400);
  assert.equal((await t.client().get('/api/admin/tiers/runs')).status, 404, 'behind the admin gate');
});

test('tiers: Save and regrade puts the admin’s reason (and the value before) into each change’s audit-log entry', async () => {
  const r = await t.client().put('/api/admin/tiers/settings', { ...BASE, categoryHalf: 60, version: 'forever', reason: 'Testing the save bar' }, admin);
  assert.equal(r.status, 200);
  const ev = (await t.db.query("SELECT detail FROM admin_events WHERE type = 'setting.changed' ORDER BY id DESC LIMIT 1"))[0].detail;
  assert.equal(ev.key, 'tiers.categoryHalf');
  assert.equal(ev.value, 60);
  assert.equal(ev.before, 50);
  assert.equal(ev.reason, 'Testing the save bar');
  // Per version: another version's change is stored under its own key and logged with the version.
  assert.equal((await t.client().put('/api/admin/tiers/settings', { ...BASE, minPopulation: 70, version: 'retail', reason: 'Retail minimum' }, admin)).status, 200);
  const ev2 = (await t.db.query("SELECT detail FROM admin_events WHERE type = 'setting.changed' ORDER BY id DESC LIMIT 1"))[0].detail;
  assert.equal(ev2.version, 'retail');
  assert.equal(ev2.reason, 'Retail minimum');
  assert.equal((await t.client().get('/api/admin/tiers?v=forever', admin)).json.settings.minPopulation, 50, 'Forever untouched');
  await t.client().put('/api/admin/tiers/settings', { ...BASE, version: 'forever', reason: 'Back' }, admin);
});

test('tiers: Grade everyone now answers with the grading it queued, and /tiers/runs follows it to done with its result', async () => {
  for (const [id] of STATS) {
    assert.equal((await decide(id, 'category')).status, 200);
    assert.equal((await decide(id, 'grading')).status, 200);
  }
  const c = t.client();
  const r = await c.post('/api/admin/tiers/regrade', { version: 'forever' }, admin);
  assert.equal(r.status, 200);
  assert.ok(Number.isInteger(Number(r.json.runId)), 'the run it queued or joined');
  const queued = r.json.runs.find((x) => Number(x.id) === Number(r.json.runId));
  assert.equal(queued.status, 'pending');
  assert.ok(queued.reasons.includes('admin asked'));
  assert.equal(r.json.rulesets.length, 1);
  assert.equal(r.json.rulesets[0].eligible, N);
  const ev = (await t.db.query("SELECT detail FROM admin_events WHERE type = 'tiers.regrade_requested' ORDER BY id DESC LIMIT 1"))[0].detail;
  assert.deepEqual(ev, { version: 'forever', run: Number(r.json.runId) });

  // Asking again while it waits joins the same grading.
  assert.equal(Number((await c.post('/api/admin/tiers/regrade', { version: 'forever' }, admin)).json.runId), Number(r.json.runId));

  // The worker runs it once the quiet period has passed: the page's poll sees it done, with what it did on Forever.
  const { runDueTierWork, TIER_DEBOUNCE_MS } = await import('../tiers/store.js');
  await runDueTierWork(t.db, { now: () => Date.now() + TIER_DEBOUNCE_MS + 1000, log: { error() {} } });
  const runs = (await c.get('/api/admin/tiers/runs?v=forever', admin)).json;
  const done = runs.runs.find((x) => Number(x.id) === Number(r.json.runId));
  assert.equal(done.status, 'done');
  assert.ok(Number.isFinite(done.ms));
  assert.equal(done.here.rulesets, 1);
  assert.equal(done.here.graded, 1);
  assert.equal(done.here.characters, N);
  const lettered = ['S', 'A', 'B', 'C', 'D', 'unranked'].reduce((n, l) => n + done.here.letters[l], 0);
  assert.equal(lettered, N);
  assert.ok(done.here.letters.S >= 1);
  // Another version's view of the same grading: none of its realm categories were in it.
  const retail = (await c.get('/api/admin/tiers/runs?v=retail', admin)).json;
  assert.equal(retail.rulesets.length, 0);
  assert.deepEqual(retail.runs.find((x) => Number(x.id) === Number(r.json.runId)).here, { rulesets: 0, graded: 0, characters: 0, letters: null });
});

test('tier groups: the switcher’s ?v= picks the version', async () => {
  const g = (await t.client().get('/api/admin/discovery/groups?v=retail&r=us', admin)).json;
  assert.equal(g.version, 'retail');
  assert.equal((await t.client().get('/api/admin/discovery/groups?v=forever', admin)).json.version, 'forever');
});

test('discovery: the run list narrows by version, region and kind, and names the run in flight anywhere', async () => {
  const add = (status, kind, version, region = 'us') => t.db.one(
    'INSERT INTO discovery_runs (status, options, game_version, region) VALUES ($1, $2::jsonb, $3, $4) RETURNING id',
    [status, JSON.stringify(kind === 'probe' ? { kind: 'probe', version, region } : { primary: { name: 'Path', surname: 'Vexley', slug: 'path-vexley' } }), version, region],
  );
  const d1 = await add('done', 'discovery', 'forever');
  const p1 = await add('done', 'probe', 'forever');
  const p2 = await add('running', 'probe', 'retail');
  const c = t.client();
  const ids = async (q) => (await c.get(`/api/admin/discovery?${q}`, admin)).json.runs.map((r) => Number(r.id));
  assert.deepEqual(await ids('v=forever&r=us&kind=discovery'), [Number(d1.id)]);
  assert.deepEqual(await ids('v=forever&r=us&kind=probe'), [Number(p1.id)]);
  assert.deepEqual(await ids('version=retail&region=us&kind=probe'), [Number(p2.id)]);
  assert.deepEqual(await ids('v=retail&r=eu'), []);
  assert.equal((await ids('')).length, 3, 'no filter: every run, as before');
  const list = (await c.get('/api/admin/discovery?v=forever&kind=discovery', admin)).json;
  assert.equal(Number(list.active.id), Number(p2.id));
  assert.equal(list.active.version, 'retail');
  assert.equal(list.runs[0].version, 'forever');
  assert.equal((await c.get('/api/admin/discovery?v=nonsense', admin)).status, 400);
  await t.db.query("UPDATE discovery_runs SET status = 'stopped' WHERE id = $1", [p2.id]);
});

test('discovery: the combined catalog and its decisions follow the version; a decision records it', async () => {
  await t.db.query("INSERT INTO statistics (id, name, category_path, game_version, blizzard_id) VALUES (1000000001, 'Retail creatures killed', $1::jsonb, 'retail', 101)", [JSON.stringify([{ id: 1, name: 'Kills' }])]);
  const c = t.client();
  const all = (await c.get('/api/admin/discovery/catalog', admin)).json;
  assert.ok(all.catalog.some((s) => s.statisticId === 101) && all.catalog.some((s) => s.statisticId === 1000000001), 'no version: everything, as before');
  const forever = (await c.get('/api/admin/discovery/catalog?v=forever', admin)).json;
  assert.ok(forever.catalog.some((s) => s.statisticId === 101));
  assert.ok(!forever.catalog.some((s) => s.statisticId === 1000000001));
  const retail = (await c.get('/api/admin/discovery/catalog?v=retail', admin)).json;
  assert.deepEqual(retail.catalog.map((s) => s.statisticId), [1000000001]);
  assert.equal(retail.combined, null, 'discovery runs are the primary version’s');
  // A retail statistic isn't in Forever's view, so a decision made from it is refused there…
  assert.equal((await decide(1000000001, 'category', { version: 'forever' })).status, 404);
  // …and accepted in its own, stored with its version.
  assert.equal((await decide(1000000001, 'category', { version: 'retail' })).status, 200);
  const row = await t.db.one("SELECT game_version FROM discovery_decisions WHERE statistic_id = 1000000001 AND kind = 'category' ORDER BY id DESC LIMIT 1");
  assert.equal(row.game_version, 'retail');
  const csv = await c.get('/api/admin/discovery/catalog/export.csv?version=retail', admin);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Retail creatures killed/);
  assert.doesNotMatch(csv.text, /Quests completed/);
});

test('discovery: the endpoint probe matrix shows each version’s newest finished probe, endpoint by endpoint', async () => {
  const summary = (outcomes) => ({
    areas: [{ id: 'char', label: 'Character' }],
    entries: Object.entries(outcomes).map(([id, [outcome, status]]) => ({
      id, area: 'char', template: `/profile/wow/character/{C}/${id}`, outcome, skipped: outcome === 'skipped' ? 'no id to try' : null,
      best: status ? 1 : null, attempts: status ? [{ responseId: 1, status }] : [],
    })),
  });
  const add = (version, status, outcomes) => t.db.one(
    "INSERT INTO discovery_runs (status, options, game_version, region, summary, finished_at) VALUES ($1, $2::jsonb, $3, 'us', $4::jsonb, now()) RETURNING id",
    [status, JSON.stringify({ kind: 'probe', version, region: 'us' }), version, JSON.stringify(summary(outcomes))],
  );
  await add('forever', 'done', { a: ['answered', 200], b: ['not found', 404] }); // older: replaced by the next one
  const f = await add('forever', 'done', { a: ['answered', 200], b: ['answered', 200] });
  const r = await add('retail', 'stopped', { a: ['answered', 200], b: ['skipped', null] });
  await add('classic', 'failed', { a: ['answered', 200] }); // failed: no column
  const m = (await t.client().get('/api/admin/discovery/probe-matrix?region=us', admin)).json;
  assert.equal(m.region, 'us');
  const v = Object.fromEntries(m.versions.map((x) => [x.id, x.run]));
  assert.equal(Number(v.forever.id), Number(f.id));
  assert.equal(Number(v.retail.id), Number(r.id));
  assert.equal(v.classic, null);
  const b = m.rows.find((x) => x.id === 'b');
  assert.deepEqual(b.cells.forever, { outcome: 'answered', status: 200, skipped: null });
  assert.deepEqual(b.cells.retail, { outcome: 'skipped', status: null, skipped: 'no id to try' });
  assert.deepEqual(m.areas, [{ id: 'char', label: 'Character' }]);
  assert.equal((await t.client().get('/api/admin/discovery/probe-matrix')).status, 404, 'behind the admin gate');
});
