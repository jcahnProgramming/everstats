import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { startApp } from './helpers.js';

// Release tools (0.10.3): snapshots and compare, the guided checklist, pause / resume, regrade, the maintenance banner.
// Characters and statistics are written directly (test fixtures, never shipped data).

let t;
let admin;
const RS = 9001;
const RS_OTHER = 1000001; // a realm category of another version (local ids start at 10^6)
before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 404 }) });
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
  await t.db.query("INSERT INTO rulesets (id, name, listed) VALUES ($1, 'Normal', true)", [RS]);
  await t.db.query("INSERT INTO rulesets (id, name, listed, game_version, region) VALUES ($1, 'Other realm type', true, 'retail', 'us')", [RS_OTHER]);
  for (const [id, name] of [[501, 'Fixture kills'], [502, 'Fixture quests']]) {
    await t.db.query('INSERT INTO statistics (id, name, category_path) VALUES ($1, $2, $3::jsonb)', [id, name, JSON.stringify([{ id: 1, name: 'Fixtures' }])]);
  }
  for (let i = 1; i <= 6; i++) await addCharacter(i, i === 1 ? 'path-vexley' : `fixture${'abcdef'[i - 1]}-tester`);
  // Another version's character: never in a Forever snapshot.
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, data_fetched_at, game_version, region)
     VALUES (1000000000000001, 'otherone-tester', 'Otherone', 'Tester', $1, 30, 'ok', 'lookup', now(), now(), now(), 'retail', 'us')`,
    [RS_OTHER],
  );
  await t.db.query("INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES (1000000000000001, 501, $1, 77, now())", [RS_OTHER]);
});
after(() => t.close());

async function addCharacter(i, slug, { trackedAgo = '1 day' } = {}) {
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, stats_fetched_at, last_fetched_at, data_fetched_at, tracked_since)
     VALUES ($1, $2, $3, 'Tester', $4, 30, 'ok', 'lookup', now(), now(), now(), now() - $5::interval)`,
    [i, slug, `Fixture${i}`, RS, trackedAgo],
  );
  await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES ($1, 501, $2, $3, now())', [i, RS, i * 10]);
  await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES ($1, 502, $2, $3, now())', [i, RS, i]);
  await t.db.query(
    `INSERT INTO character_tiers (character_id, ruleset_id, score, letter, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at)
     VALUES ($1, $2, $3, $4, 1, 1, 1, '{}', '{}', 'full', now())`,
    [i, RS, i * 10, i > 4 ? 'A' : 'C'],
  );
}

const c = () => t.client();
const events = async (type) => t.db.query('SELECT detail FROM admin_events WHERE type = $1 ORDER BY id', [type]);
const snap = async (label, v = 'forever') => c().post('/api/admin/release/snapshots', { label, version: v, region: 'us' }, admin);
const compare = async (a, b) => c().post('/api/admin/release/compare', { a, b }, admin);

test('without an admin session every release route is a plain 404', async () => {
  for (const [m, p] of [['get', '/api/admin/release/crawl'], ['post', '/api/admin/release/crawl'], ['get', '/api/admin/release/tiers'], ['post', '/api/admin/release/tiers'],
    ['get', '/api/admin/release/snapshots'], ['post', '/api/admin/release/snapshots'], ['post', '/api/admin/release/compare'], ['get', '/api/admin/release/runs'],
    ['post', '/api/admin/release/runs'], ['post', '/api/admin/release/runs/1/steps/pause'], ['get', '/api/admin/release/live'], ['get', '/api/admin/release/banner']]) {
    const res = await c()[m](p, m === 'get' ? undefined : {});
    assert.equal(res.status, 404, p);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
});

test('a snapshot needs a label, is scoped to its version and has the fingerprint’s checks', async () => {
  const bad = await snap('   ');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'label_required');
  const res = await snap('before 0.11.0');
  assert.equal(res.status, 200);
  assert.equal(res.json.snapshot.label, 'before 0.11.0');
  assert.equal(res.json.snapshot.characters, 6, 'the other version’s character is not counted');
  const full = (await c().get(`/api/admin/release/snapshots/${res.json.snapshot.id}`, admin)).json.snapshot;
  assert.equal(full.version, 'forever');
  assert.ok(full.appVersion);
  const d = full.data;
  assert.deepEqual(d.characters.total, 6);
  assert.deepEqual(d.rulesets, [{ id: RS, name: 'Normal' }]);
  assert.equal(d.values.n, 12);
  assert.ok(d.boards.every((b) => b.ruleset === RS));
  assert.deepEqual(d.tiers.distribution[RS], { A: 2, C: 4 });
  assert.equal(d.sample.found, true);
  assert.equal(d.sample.letter, 'C');
  const other = await snap('retail check', 'retail');
  const od = (await c().get(`/api/admin/release/snapshots/${other.json.snapshot.id}`, admin)).json.snapshot.data;
  assert.equal(od.characters.total, 1);
  assert.equal(od.values.n, 1);
  assert.equal(od.sample.slug, null);
  assert.match(od.sample.none, /no sample character/);
  const list = (await c().get('/api/admin/release/snapshots?v=forever&r=us', admin)).json.snapshots;
  assert.ok(list.every((s) => s.version === 'forever'));
  assert.equal((await events('release.snapshot')).length, 2);
});

test('two snapshots with nothing changed in between compare identical', async () => {
  const a = (await snap('same one')).json.snapshot;
  const b = (await snap('same two')).json.snapshot;
  const res = await compare(a.id, b.id);
  assert.equal(res.status, 200);
  assert.equal(res.json.compare.identical, true, JSON.stringify(res.json.compare.sections.filter((s) => !s.same)));
  assert.match(res.json.compare.summary, /^Identical/);
  const logged = (await events('release.compared')).at(-1).detail;
  assert.deepEqual(logged, { identical: true, a: a.id, b: b.id });
});

test('a new character is explained as a new character; an existing letter change is not', async () => {
  const a = (await snap('before new')).json.snapshot;
  await addCharacter(7, 'fixtureg-tester', { trackedAgo: '0 seconds' });
  const b = (await snap('after new')).json.snapshot;
  const r = (await compare(b.id, a.id)).json.compare; // either order: the older is "before"
  assert.equal(r.identical, false);
  assert.equal(r.a.id, a.id);
  assert.equal(r.onlyNewCharacters, true, r.summary);
  assert.match(r.summary, /new characters: 1 more tracked/);
  const chars = r.sections.find((s) => s.id === 'characters');
  assert.match(chars.lines[0], /6 → 7 \(up by 1\)/);
  assert.match(r.sections.find((s) => s.id === 'values').lines.join(' '), /same statistic values/);
  // Now an existing character's letter moves: no longer "only new characters".
  await t.db.query("UPDATE character_tiers SET letter = 'S' WHERE character_id = 2");
  const c2 = (await snap('after letter')).json.snapshot;
  const r2 = (await compare(a.id, c2.id)).json.compare;
  assert.equal(r2.onlyNewCharacters, false);
  assert.match(r2.summary, /letters changed/);
  await t.db.query("UPDATE character_tiers SET letter = 'C' WHERE character_id = 2");
});

test('past the retention window the data row is swept; the label stays and says so', async () => {
  const s = (await snap('old one')).json.snapshot;
  const fresh = (await snap('new one')).json.snapshot;
  await t.db.query("UPDATE release_snapshot_data SET taken_at = now() - interval '40 days' WHERE snapshot_id = $1", [s.id]);
  const { runRetentionSweep } = await import('../retention/sweep.js');
  await runRetentionSweep(t.db, { log: { error() {} } });
  const one = (await c().get(`/api/admin/release/snapshots/${s.id}`, admin)).json.snapshot;
  assert.equal(one.label, 'old one');
  assert.equal(one.hasData, false);
  assert.equal(one.data, null);
  const listed = (await c().get('/api/admin/release/snapshots?v=forever&r=us&limit=50', admin)).json.snapshots.find((x) => x.id === s.id);
  assert.equal(listed.hasData, false);
  const res = await compare(s.id, fresh.id);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'aged_out');
  assert.match(res.json.error, /30-day rule/);
});

test('pause and resume are the Features page’s Background crawl switch, with a reason', async () => {
  const { listFeatures } = await import('../features/registry.js');
  const { getSetting } = await import('../admin/settings.js');
  const noReason = await c().post('/api/admin/release/crawl', { on: false }, admin);
  assert.equal(noReason.status, 400);
  const off = await c().post('/api/admin/release/crawl', { on: false, reason: 'deploy 0.11.0' }, admin);
  assert.equal(off.status, 200);
  assert.equal(off.json.crawl.on, false);
  assert.equal(await getSetting(t.db, 'crawler.paused'), true);
  assert.equal((await listFeatures(t.db)).find((f) => f.id === 'crawl').on, false);
  assert.equal((await events('release.paused')).at(-1).detail.reason, 'deploy 0.11.0');
  const changed = (await events('setting.changed')).filter((e) => e.detail.key === 'crawler.paused').at(-1).detail;
  assert.equal(changed.value, true);
  const on = await c().post('/api/admin/release/crawl', { on: true, reason: 'deploy done' }, admin);
  assert.equal(on.json.crawl.on, true);
  assert.equal(await getSetting(t.db, 'crawler.paused'), false);
  assert.equal((await events('release.resumed')).length >= 1, true);
});

test('a regrade request is logged with its version and its progress is readable', async () => {
  const res = await c().post('/api/admin/release/tiers', { version: 'forever', region: 'us' }, admin);
  assert.equal(res.status, 200);
  const tiers = res.json.tiers;
  assert.equal(tiers.run.status, 'queued');
  assert.equal(tiers.gradesEveryVersion, true);
  const logged = (await events('tiers.regrade_requested')).at(-1).detail;
  assert.equal(logged.version, 'forever');
  assert.equal(logged.tierRun, tiers.run.id);
  // The worker's job picks it up after the debounce.
  const { runDueTierWork } = await import('../tiers/store.js');
  await runDueTierWork(t.db, { now: () => Date.now() + 31_000, log: { error() {} } });
  const after = (await c().get(`/api/admin/release/tiers?v=forever&r=us&run=${tiers.run.id}`, admin)).json.tiers;
  assert.equal(after.run.status, 'done');
  assert.equal(after.inFlight, null);
  assert.equal(after.last.id, tiers.run.id);
});

test('the checklist: before and after runs, each step recorded and in the audit log', async () => {
  const { runDueTierWork } = await import('../tiers/store.js');
  const start = await c().post('/api/admin/release/runs', { kind: 'before', label: '0.11.0', version: 'forever', region: 'us' }, admin);
  assert.equal(start.status, 200);
  const run = start.json.run;
  assert.deepEqual(run.steps.map((s) => [s.id, s.state]), [['pause', 'not_started'], ['regrade', 'not_started'], ['snapshot', 'not_started']]);
  assert.equal((await c().post('/api/admin/release/runs', { kind: 'after', label: 'x', version: 'forever', region: 'us' }, admin)).json.code, 'run_open');
  const step = (id, s, body = {}) => c().post(`/api/admin/release/runs/${id}/steps/${s}`, body, admin);
  assert.equal((await step(run.id, 'pause')).json.code, 'reason_required');
  let r = (await step(run.id, 'pause', { reason: 'deploying 0.11.0' })).json.run;
  assert.equal(r.steps[0].state, 'done');
  assert.match(r.steps[0].result, /paused/);
  r = (await step(run.id, 'regrade')).json.run;
  assert.equal(r.steps[1].state, 'working');
  await runDueTierWork(t.db, { now: () => Date.now() + 31_000, log: { error() {} } });
  r = (await c().get(`/api/admin/release/runs/${run.id}`, admin)).json.run;
  assert.equal(r.steps[1].state, 'done', r.steps[1].result);
  r = (await step(run.id, 'snapshot')).json.run;
  assert.equal(r.steps[2].state, 'done');
  assert.match(r.steps[2].result, /before 0\.11\.0/);
  const fin = await c().post(`/api/admin/release/runs/${run.id}/finish`, { abandoned: false }, admin);
  assert.equal(fin.json.run.open, false);

  const aft = (await c().post('/api/admin/release/runs', { kind: 'after', label: '0.11.0', version: 'forever', region: 'us' }, admin)).json.run;
  // No worker has reported: the version step fails and says why.
  let a = (await step(aft.id, 'version')).json.run;
  assert.equal(a.steps[0].state, 'failed');
  assert.match(a.steps[0].result, /worker/i);
  const { APP_VERSION } = await import('../core/version.js');
  await t.db.query("INSERT INTO worker_status (worker_id, version, started_at, last_tick_at, state) VALUES ('w1', $1, now(), now(), 'running')", [APP_VERSION]);
  a = (await step(aft.id, 'version')).json.run;
  assert.equal(a.steps[0].state, 'done', a.steps[0].result);
  assert.equal((await step(aft.id, 'compare')).json.run.steps[3].state, 'failed', 'compare needs this run’s snapshot first');
  a = (await step(aft.id, 'snapshot')).json.run;
  a = (await step(aft.id, 'compare')).json.run;
  assert.equal(a.steps[3].state, 'done');
  assert.equal(a.steps[3].identical, true, a.steps[3].result);
  a = (await step(aft.id, 'resume', { reason: 'deployed' })).json.run;
  assert.equal(a.steps[4].state, 'done');
  await c().post(`/api/admin/release/runs/${aft.id}/finish`, { abandoned: true }, admin);

  const started = await events('release.run_started');
  assert.deepEqual(started.map((e) => e.detail.kind).slice(-2), ['before', 'after']);
  const steps = (await events('release.step')).map((e) => e.detail);
  for (const s of ['pause', 'regrade', 'snapshot', 'version', 'compare', 'resume']) assert.ok(steps.some((x) => x.step === s), s);
  assert.ok(steps.every((x) => x.run && x.result));
  const finished = (await events('release.run_finished')).map((e) => e.detail);
  assert.deepEqual(finished.slice(-2), [{ run: run.id, abandoned: false }, { run: aft.id, abandoned: true }]);
  assert.ok((await events('release.compared')).some((e) => e.detail.run === aft.id));
  const runs = (await c().get('/api/admin/release/runs', admin)).json;
  assert.equal(runs.open, null);
  assert.ok(runs.recent.length >= 2);
});

test('the maintenance banner: validated, logged, and public only inside its window', async () => {
  const { bannerLive, createMaintenanceRouter } = await import('../release/maintenance.js');
  const put = (value, reason = 'planned maintenance') => c().put('/api/admin/settings/maintenance.banner', { value, reason }, admin);
  assert.equal((await put({ text: '<b>hi</b> there' })).status, 400);
  assert.equal((await put({ text: 'two\nlines here' })).status, 400);
  assert.equal((await put({ text: 'Maintenance soon', start: '2030-01-02T00:00:00Z', end: '2030-01-01T00:00:00Z' })).status, 400);
  // A small app around the public router (server/app.js mounts it under /api).
  const app = express();
  app.use('/api', createMaintenanceRouter({ db: t.db }));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const pub = async () => (await fetch(`http://127.0.0.1:${server.address().port}/api/maintenance`)).json();
  try {
    assert.deepEqual(await pub(), { banner: null }, 'off by default');
    const inside = { text: 'Everstats is down for maintenance at 15:00 UTC', start: new Date(Date.now() - 60_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString() };
    assert.equal((await put(inside)).status, 200);
    assert.deepEqual(await pub(), { banner: inside });
    const banner = (await c().get('/api/admin/release/banner', admin)).json.banner;
    assert.equal(banner.live, true);
    assert.equal(banner.reason, 'planned maintenance');
    const logged = (await events('setting.changed')).filter((e) => e.detail.key === 'maintenance.banner').at(-1).detail;
    assert.equal(logged.before, null);
    assert.equal(logged.reason, 'planned maintenance');
    await put({ ...inside, start: new Date(Date.now() + 3_600_000).toISOString(), end: null });
    assert.deepEqual(await pub(), { banner: null }, 'not before its start');
    await put({ ...inside, start: null, end: new Date(Date.now() - 1000).toISOString() });
    assert.deepEqual(await pub(), { banner: null }, 'not after its end');
    assert.equal(bannerLive({ text: 'open ended', start: null, end: null }), true);
    await put(null, 'over');
    assert.deepEqual(await pub(), { banner: null });
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('GET /api/maintenance is mounted on the real app', async () => {
  const res = await c().get('/api/maintenance');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { banner: null });
});
