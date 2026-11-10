import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

/**
 * 0.10.3: the admin Data pages (Crawler, Collections & catalogs, Backups), Data retention and Settings endpoints
 * (server/admin/data.js).
 */
let t;
before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 200 }) });
});
after(() => t.close());

const admin = async () => {
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

const GETS = ['/api/admin/data/crawler', '/api/admin/data/jobs', '/api/admin/data/renderer', '/api/admin/data/collections', '/api/admin/data/backups',
  '/api/admin/data/retention?fresh=1', '/api/admin/data/retention/sweeps', '/api/admin/data/settings', '/api/admin/data/keys', '/api/admin/data/proxies'];

test('without an admin session every data route is a plain 404', async () => {
  const c = t.client();
  for (const p of GETS) {
    const res = await c.get(p);
    assert.equal(res.status, 404, p);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
  for (const [m, p] of [['put', '/api/admin/data/keys/discord'], ['post', '/api/admin/data/keys/discord/remove']]) {
    const res = await c[m](p, { reason: 'test reason' });
    assert.equal(res.status, 404, p);
  }
});

test('every data route answers for the admin, and an unknown version is refused', async () => {
  const h = await admin();
  const c = t.client();
  for (const p of GETS) {
    const res = await c.get(p, h);
    assert.equal(res.status, 200, `${p}: ${res.text}`);
  }
  assert.equal((await c.get('/api/admin/data/crawler?v=nope&r=us', h)).status, 400);
  assert.equal((await c.get('/api/admin/data/retention?v=forever&r=xx', h)).status, 400);
});

test('every kind of stored Blizzard data has a retention row', async () => {
  const { BLIZZARD } = await import('../retention/registry.js');
  const { RETENTION_KINDS } = await import('../admin/data.js');
  const covered = new Set(RETENTION_KINDS.map((k) => k.table));
  for (const e of BLIZZARD) assert.ok(covered.has(e.table), `${e.table} has no row on the Data retention page`);
  // And every row's count query runs (a typo in a join would show as a problem on the page).
  const res = await t.client().get('/api/admin/data/retention?fresh=1', await admin());
  for (const k of res.json.kinds) assert.equal(k.problem, null, `${k.id}: ${k.problem}`);
});

test('retention buckets: rows land in the right expiry bucket, and other versions are left out', async () => {
  const q = t.db;
  await q.query("INSERT INTO rulesets (id, name, listed, updated_at) VALUES (2, 'Fixture Ruleset', true, now()) ON CONFLICT DO NOTHING");
  const keep = 29;
  // Expiry = fetched + 29 days. Ages chosen inside each bucket.
  const rows = [
    [9101, ago(keep * DAY - 30 * 60 * 1000)], // expires in 30 min → next hour
    [9102, ago(keep * DAY - 5 * 60 * 60 * 1000)], // 5 h → next 24 h
    [9103, ago(keep * DAY - 3 * DAY)], // 3 days → next 7 days
    [9104, ago(DAY)], // 28 days → rest of the window
    [9105, ago(2 * DAY)], // rest
    [9106, ago(keep * DAY + 10 * 60 * 1000)], // already past keep: due for the sweep
  ];
  for (const [id, at] of rows) {
    await q.query(
      `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, data_fetched_at)
       VALUES ($1, $2, 'Fixture', 'Bucket', 2, 20, 'ok', 'lookup', $3)`,
      [id, `fixture-bucket-${id}`, at],
    );
  }
  // Another version's character never counts on Forever's page.
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, data_fetched_at, game_version, region, blizzard_id)
     VALUES (1000000000009107, 'fixture-retail', 'Fixture', 'Retail', 2, 20, 'ok', 'lookup', $1, 'retail', 'us', 9107)`,
    [ago(keep * DAY - 30 * 60 * 1000)],
  );
  const h = await admin();
  const res = await t.client().get('/api/admin/data/retention?v=forever&r=us&fresh=1', h);
  assert.equal(res.status, 200);
  const k = res.json.kinds.find((x) => x.id === 'characters');
  assert.equal(k.rows, 6);
  assert.equal(k.overdue, 1);
  assert.equal(k.nextHour, 1);
  assert.equal(k.next24h, 1);
  assert.equal(k.next7d, 1);
  assert.equal(k.rest, 2);
  assert.equal(k.width, 'scoped');
  assert.equal(new Date(k.oldest).getTime(), rows[5][1].getTime());
  // Within Blizzard's 30 days, so the page says WITHIN the window (the one past 29 days is just due for the sweep).
  assert.equal(res.json.status.state, 'within');
  assert.equal(res.json.rule.keepDays, 29);
  assert.ok(res.json.ours.length > 10 && res.json.ours.every((o) => o.reason));

  const retail = await t.client().get('/api/admin/data/retention?v=retail&r=us&fresh=1', h);
  const rk = retail.json.kinds.find((x) => x.id === 'characters');
  assert.equal(rk.rows, 1);
  assert.equal(rk.nextHour, 1);
  // A kind that can't be scoped says so.
  assert.equal(retail.json.kinds.find((x) => x.id === 'collection_sharing').width, 'all');

  // Older than Blizzard's 30 days anywhere → OUTSIDE the window.
  await q.query('UPDATE characters SET data_fetched_at = $1 WHERE id = 9106', [ago(31 * DAY)]);
  const out = await t.client().get('/api/admin/data/retention?fresh=1', h);
  assert.equal(out.json.status.state, 'outside');
  assert.ok(out.json.status.overByMs > 0);
  // The counts are kept a minute per scope (the page says when they were counted); ?fresh=1 counts again.
  const memo1 = await t.client().get('/api/admin/data/retention?v=retail&r=us', h);
  const memo2 = await t.client().get('/api/admin/data/retention?v=retail&r=us', h);
  assert.equal(memo1.json.countedAt, memo2.json.countedAt);
  await q.query('DELETE FROM characters WHERE id BETWEEN 9101 AND 9106 OR id = 1000000000009107');
});

test('sweep history is paged, newest first, and problems are flagged', async () => {
  const q = t.db;
  await q.query('DELETE FROM retention_sweeps');
  for (let i = 0; i < 25; i += 1) {
    await q.query(
      `INSERT INTO retention_sweeps (process, window_days, cutoff, started_at, finished_at, deleted, problem)
       VALUES ('worker', 30, now(), now() - ($1 || ' hours')::interval, now() - ($1 || ' hours')::interval + interval '40 seconds', $2::jsonb, $3)`,
      [String(25 - i), JSON.stringify({ characters: i, item_media: 2 }), i === 20 ? 'item_media: 40P01' : null],
    );
  }
  const h = await admin();
  const c = t.client();
  const p1 = await c.get('/api/admin/data/retention/sweeps?limit=10', h);
  assert.equal(p1.json.sweeps.length, 10);
  assert.ok(p1.json.next);
  assert.ok(p1.json.sweeps[0].id > p1.json.sweeps[1].id);
  assert.equal(p1.json.sweeps[0].durationMs, 40_000);
  const bad = p1.json.sweeps.find((s) => s.state === 'problems');
  assert.ok(bad && bad.problem.includes('item_media'));
  const p3 = await c.get(`/api/admin/data/retention/sweeps?limit=10&before=${p1.json.next}`, h);
  assert.equal(p3.json.sweeps.length, 10);
  assert.ok(p3.json.sweeps[0].id < p1.json.sweeps.at(-1).id);
  // limit is capped
  assert.ok((await c.get('/api/admin/data/retention/sweeps?limit=100000', h)).json.sweeps.length <= 100);
  assert.equal((await c.get('/api/admin/data/retention/sweeps?before=abc', h)).status, 400);
});

test('backup history says why each file is kept, by the prune rule', async () => {
  const { keepReasons } = await import('../core/backup.js');
  const files = [];
  // 20 nightly backups ending today, across two months.
  for (let i = 0; i < 20; i += 1) {
    const d = new Date(Date.UTC(2026, 10, 10) - i * DAY).toISOString().slice(0, 10);
    files.push({ name: `everstats-ours-${d}.dump`, takenAt: Date.parse(`${d}T04:00:00Z`) });
  }
  files.push({ name: 'everstats-2026-11-09.dump', takenAt: Date.parse('2026-11-09T04:00:00Z') }); // legacy, 1 day old
  files.push({ name: 'everstats-2026-10-01.dump', takenAt: Date.parse('2026-10-01T04:00:00Z') }); // legacy, too old
  const why = keepReasons(files, { now: Date.parse('2026-11-10T12:00:00Z'), nightly: 14, monthly: true });
  assert.equal(why.get('everstats-ours-2026-11-10.dump'), 'nightly');
  assert.equal(why.get('everstats-ours-2026-11-01.dump'), 'nightly+monthly');
  assert.equal(why.get('everstats-ours-2026-10-22.dump'), 'monthly'); // the first of October in the list
  assert.equal(why.get('everstats-ours-2026-10-25.dump'), 'goes');
  assert.equal(why.get('everstats-2026-11-09.dump'), 'legacy');
  assert.equal(why.get('everstats-2026-10-01.dump'), 'goes');
  // The dev site's rule: 3 nightly, no monthly copies.
  const dev = keepReasons(files, { now: Date.parse('2026-11-10T12:00:00Z'), nightly: 3, monthly: false });
  assert.equal(dev.get('everstats-ours-2026-11-08.dump'), 'nightly');
  assert.equal(dev.get('everstats-ours-2026-11-01.dump'), 'goes');

  // Through the endpoint: a failed run is flagged, a same-day re-run replaces the earlier one.
  const q = t.db;
  await q.query('DELETE FROM backup_runs');
  await q.query(`INSERT INTO backup_runs (trigger, outcome, started_at, finished_at, file_name, bytes) VALUES
    ('nightly', 'ok', now() - interval '2 days', now() - interval '2 days', 'everstats-ours-2026-11-08.dump', 1000),
    ('nightly', 'failed', now() - interval '1 day', now() - interval '1 day', NULL, NULL),
    ('manual', 'ok', now() - interval '3 hours', now() - interval '3 hours', 'everstats-ours-2026-11-10.dump', 1100),
    ('nightly', 'ok', now() - interval '1 hour', now() - interval '1 hour', 'everstats-ours-2026-11-10.dump', 1200)`);
  const res = await t.client().get('/api/admin/data/backups?limit=3', await admin());
  assert.equal(res.status, 200);
  const [newest, replaced, failed] = res.json.history;
  assert.equal(newest.kept.code, 'nightly');
  assert.equal(replaced.kept.code, 'replaced');
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.kept, null);
  assert.ok(res.json.next);
  assert.ok(res.json.commands[0].includes('server/tools/backup.js now'));
  const rest = await t.client().get(`/api/admin/data/backups?limit=3&before=${res.json.next}`, await admin());
  assert.equal(rest.json.history.length, 1);
  assert.equal(rest.json.history[0].kept.code, 'nightly+monthly'); // the earliest November file the log knows
});

test('the keys response never carries a key, and removing one needs a reason that reaches the log', async () => {
  const h = await admin();
  const c = t.client();
  const secret = 'another-secret-value-987654321';
  const saved = await c.put('/api/admin/data/keys/discord', { clientId: '223456789012345678', clientSecret: secret, reason: 'rotating the fixture' }, h);
  assert.equal(saved.status, 200, saved.text);
  const keys = await c.get('/api/admin/data/keys', h);
  for (const text of [saved.text, keys.text]) {
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('223456789012345678'));
    assert.ok(!text.includes('5678')); // not even a last four
  }
  const d = keys.json.credentials.find((x) => x.id === 'discord');
  assert.equal(d.state, 'configured');
  assert.equal(d.source, 'database');

  const noReason = await c.post('/api/admin/data/keys/discord/remove', { reason: '' }, h);
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, 'reason_required');
  const removed = await c.post('/api/admin/data/keys/discord/remove', { reason: 'key leaked in a fixture' }, h);
  assert.equal(removed.status, 200);
  assert.equal(removed.json.credential.source === 'database', false);
  const log = await t.db.query("SELECT type, detail FROM admin_events WHERE type LIKE 'credential.%' ORDER BY id DESC LIMIT 2");
  assert.equal(log[0].type, 'credential.removed');
  assert.equal(log[0].detail.reason, 'key leaked in a fixture');
  assert.equal(log[1].detail.reason, 'rotating the fixture');
  assert.ok(!JSON.stringify(log).includes(secret));
});

test('crawler, jobs, renderer, collections, settings and proxies answer in the shape the pages draw', async () => {
  const h = await admin();
  const c = t.client();
  await t.db.query(`INSERT INTO worker_status (worker_id, version, started_at, last_tick_at, state, jobs) VALUES ('fixture-worker', '0.0.0', now(), now() - interval '10 minutes', 'idle', $1::jsonb)
                    ON CONFLICT (worker_id) DO UPDATE SET last_tick_at = EXCLUDED.last_tick_at, jobs = EXCLUDED.jobs`,
  [JSON.stringify([{ id: 'backup', label: 'Backups', everyMs: 60_000, lastStartedAt: new Date().toISOString(), lastFinishedAt: new Date().toISOString(), lastOutcome: 'failed', lastSummary: 'Error (ENOENT)' }])]);
  const jobs = await c.get('/api/admin/data/jobs', h);
  // A worker whose heartbeat is 10 minutes old is NOT running: "Not responding", and its jobs' state is unknown.
  assert.equal(jobs.json.workers[0].state, 'not_responding');
  assert.equal(jobs.json.workers[0].jobs[0].state, 'unknown');
  await t.db.query("UPDATE worker_status SET last_tick_at = now() WHERE worker_id = 'fixture-worker'");
  const live = await c.get('/api/admin/data/jobs', h);
  assert.equal(live.json.workers[0].jobs[0].state, 'failed');

  await t.db.query("INSERT INTO crawl_queue (kind, key, priority, state) VALUES ('character', 'fixture-queued', 1, 'queued')");
  const crawler = await c.get('/api/admin/data/crawler', h);
  assert.equal(crawler.json.queue.length, 5);
  assert.equal(crawler.json.queue[0].queued, 1);
  assert.ok(crawler.json.queue[0].oldest);
  assert.ok(crawler.json.versions.some((v) => v.id === 'forever' && v.queued === 1));
  assert.equal(typeof crawler.json.switches.crawl.on, 'boolean');
  assert.ok(crawler.json.backfill);
  const retail = await c.get('/api/admin/data/crawler?v=retail&r=us', h);
  assert.equal(retail.json.queue[0].queued, 0);
  assert.equal(retail.json.backfill, null);

  const renderer = await c.get('/api/admin/data/renderer', h);
  assert.equal(typeof renderer.json.on, 'boolean');
  assert.equal(typeof renderer.json.cache.bytes, 'number');

  const coll = await c.get('/api/admin/data/collections', h);
  assert.ok(Array.isArray(coll.json.catalogs));
  assert.ok(coll.json.legacy && coll.json.refreshes && coll.json.tracked);

  const settings = await c.get('/api/admin/data/settings', h);
  const keys = settings.json.settings.map((s) => s.key);
  for (const k of ['crawler.requestsPerSecond', 'crawler.versionShares', 'guilds.minMembers', 'retention.window']) assert.ok(keys.includes(k), k);
  assert.ok(settings.json.versions.some((v) => v.primary));

  const proxies = await c.get('/api/admin/data/proxies', h);
  assert.ok('trustedProxies' in proxies.json && 'check' in proxies.json && 'sources' in proxies.json);
});
