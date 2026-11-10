import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Blizzard's 30-day rule (retention/). Fixture rows only; nothing here came from Blizzard.
let t;
before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 404 }) });
});
after(() => t.close());

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

test('every table is classified: Blizzard data (with a sweep) or our own (with a reason). A new table fails this test', async () => {
  const { BLIZZARD, OURS } = await import('../retention/registry.js');
  const tables = (await t.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.table_name);
  const known = new Set([...BLIZZARD.map((b) => b.table), ...Object.keys(OURS)]);
  const unclassified = tables.filter((x) => !known.has(x));
  assert.deepEqual(unclassified, [], `Classify these in server/retention/registry.js (Blizzard data needs a sweep): ${unclassified.join(', ')}`);
  const both = BLIZZARD.map((b) => b.table).filter((x) => x in OURS);
  assert.deepEqual(both, []);
  const stale = [...known].filter((x) => !tables.includes(x));
  assert.deepEqual(stale, [], 'registry names a table that no longer exists');
});

test('0.10.4: three classes, one each. Only "Blizzard API data" is ever swept; player-uploaded data never is', async () => {
  const { BLIZZARD, PLAYER, OURS, CLASSES, classOf } = await import('../retention/registry.js');
  assert.deepEqual(Object.keys(CLASSES), ['blizzard', 'player', 'ours']);
  // Every entry on the sweep list is classed Blizzard API data; none is player-uploaded or ours.
  for (const e of BLIZZARD) {
    assert.equal(e.class, 'blizzard', `${e.table} is on the sweep list but not classed Blizzard API data`);
    assert.equal(classOf(e.table), 'blizzard');
    assert.equal(typeof e.sweep, 'function');
  }
  // A player-uploaded table is never registered for sweeping, never classed Blizzard, and never ours.
  for (const e of PLAYER) {
    assert.equal(e.class, 'player');
    assert.ok(!BLIZZARD.some((b) => b.table === e.table), `${e.table} is player-uploaded but registered for sweeping`);
    assert.ok(!Object.hasOwn(OURS, e.table), `${e.table} is player-uploaded and ours at once`);
    assert.equal(e.sweep, undefined, `${e.table} is player-uploaded and must not carry a sweep`);
    assert.ok(e.holds && e.owner && e.deletePath, `${e.table} needs holds, owner and deletePath`);
    // No Blizzard sweep may name it (the characters purge deletes child tables by name).
    for (const b of BLIZZARD) assert.ok(!String(b.sweep).includes(e.table), `${b.table}'s sweep touches player-uploaded ${e.table}`);
    // Deleting the account deletes it: its owner column references accounts ON DELETE CASCADE.
    const fk = await t.db.one(
      `SELECT count(*)::int AS n FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.constraint_name
        WHERE k.table_name = $1 AND k.column_name = $2 AND u.table_name = 'accounts' AND rc.delete_rule = 'CASCADE'`,
      [e.table, e.owner],
    );
    assert.equal(fk.n, 1, `${e.table}.${e.owner} must reference accounts ON DELETE CASCADE`);
    // And it hangs off no Blizzard table (a cascade from a swept row would delete it).
    const parents = await t.db.query(
      `SELECT u.table_name FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.constraint_name
        WHERE k.table_name = $1`,
      [e.table],
    );
    for (const { table_name: parent } of parents) assert.notEqual(classOf(parent), 'blizzard', `${e.table} cascades from Blizzard table ${parent}`);
  }
});

test('0.10.4: the sweep refuses, before deleting anything, a list with a player-uploaded or own table in it', async () => {
  const { BLIZZARD, assertSweepable } = await import('../retention/registry.js');
  const { runRetentionSweep } = await import('../retention/sweep.js');
  let ran = 0;
  const sweep = async () => { ran += 1; return 0; };
  const player = { table: 'addon_statistics', holds: 'test', class: 'player', sweep };
  const disguised = { table: 'addon_statistics', holds: 'test', class: 'blizzard', sweep }; // classed Blizzard but not in BLIZZARD
  const ours = { table: 'accounts', holds: 'test', class: 'blizzard', sweep }; // an own table dressed as Blizzard
  for (const bad of [player, disguised, ours]) {
    await assert.rejects(runRetentionSweep(t.db, { entries: [BLIZZARD[0], bad], log: { error() {} } }), /refusing to sweep/);
    assert.throws(() => assertSweepable([bad]), /refusing to sweep/);
  }
  assert.equal(ran, 0, 'nothing was swept');
  assert.equal(assertSweepable(BLIZZARD), BLIZZARD);
});

test('the window is one setting: 30 by default, never above 30 without a written-permission note (logged)', async () => {
  const { retentionPolicy } = await import('../retention/policy.js');
  const { setSetting } = await import('../admin/settings.js');
  const p = await retentionPolicy(t.db);
  assert.deepEqual([p.windowDays, p.keepDays, p.safetyDays], [30, 29, 1]);
  assert.equal(p.backups.blizzardData, false); // 0.5.0: backups hold none, so they don't eat into the window
  await assert.rejects(setSetting(t.db, 'retention.window', { days: 31 }), /written permission/);
  await assert.rejects(setSetting(t.db, 'retention.window', { days: 60, note: 'ok' }), /written permission/);
  await setSetting(t.db, 'retention.window', { days: 60, note: 'Email from Blizzard API team, 2027-01-05, ticket 12345: 60-day aggregation approved' });
  assert.equal((await retentionPolicy(t.db)).keepDays, 59);
  const logged = await t.db.one("SELECT detail FROM admin_events WHERE type = 'setting.changed' ORDER BY id DESC LIMIT 1");
  assert.match(logged.detail.value.note, /ticket 12345/);
  await setSetting(t.db, 'retention.window', { days: 30 });
  assert.equal((await retentionPolicy(t.db)).permission, null); // back at 30, the note goes with it
});

test('the sweep deletes every kind of Blizzard data past 29 days, keeps what is newer, and strips a character Blizzard stopped returning', async () => {
  const q = t.db;
  await q.query("INSERT INTO rulesets (id, name, listed, updated_at) VALUES (2, 'Fixture Ruleset', true, now()), (99, 'Fixture Old Ruleset', false, $1)", [ago(30)]);
  await q.query("INSERT INTO guilds (id, slug, name, updated_at) VALUES (1, 'fixture-guild', 'Fixture Guild', now()), (2, 'old-guild', 'Old Guild', $1)", [ago(30)]);
  await q.query("INSERT INTO accounts DEFAULT VALUES");
  const acct = (await q.one('SELECT id FROM accounts ORDER BY id DESC LIMIT 1')).id;
  // 7001: fresh. 7002: Blizzard last returned it 30 days ago (owned and hidden). 7003: gear 30 days old, profile fresh.
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, profile_state, source, data_fetched_at, last_fetched_at, stats_fetched_at, guild_id, owner_account_id, hidden, equipment, media, media_state, media_fetched_at)
     VALUES (7001, 'fresh-fixture', 'Fresh', 'Fixture', 2, 'ok', 'lookup', now(), now(), now(), 1, NULL, false, '[]', '{}', 'ok', now()),
            (7002, 'gone-fixture', 'Gone', 'Fixture', 2, 'ok', 'account', $1, $1, $1, 2, $2, true, '[]', '{}', 'ok', $1),
            (7003, 'stale-fixture', 'Stale', 'Fixture', 2, 'ok', 'lookup', now(), $1, now(), NULL, NULL, false, '[]', NULL, NULL, NULL)`,
    [ago(30), acct],
  );
  await q.query("INSERT INTO statistics (id, name, last_seen_at) VALUES (1, 'Fixture fresh stat', now()), (2, 'Fixture old stat', $1)", [ago(30)]);
  await q.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES (7001, 1, 2, 5, now()), (7002, 1, 2, 9, $1)', [ago(30)]);
  await q.query("INSERT INTO character_snapshots (character_id, day, taken_at, stat_ids, stat_values) VALUES (7001, $1, $2, '{1}', '{5}'), (7001, $3, $4, '{1}', '{3}')",
    [ago(1).toISOString().slice(0, 10), ago(1), ago(30).toISOString().slice(0, 10), ago(30)]);
  await q.query("INSERT INTO item_media (item_id, state, icon_url, fetched_at) VALUES (1, 'ok', 'https://render.worldofwarcraft.com/x.jpg', now()), (2, 'ok', 'https://render.worldofwarcraft.com/y.jpg', $1)", [ago(30)]);
  await q.query("INSERT INTO pin_rank_history (character_id, statistic_id, day, rank, population) VALUES (7001, 1, $1, 1, 1), (7001, 1, $2, 1, 1)", [ago(1).toISOString().slice(0, 10), ago(30).toISOString().slice(0, 10)]);
  await q.query("INSERT INTO discovery_runs (status, requested_at) VALUES ('done', $1)", [ago(30)]);
  const run = (await q.one('SELECT id FROM discovery_runs ORDER BY id DESC LIMIT 1')).id;
  await q.query("INSERT INTO discovery_responses (run_id, endpoint, subject_kind, path, auth, status, body, fetched_at) VALUES ($1, 'character.profile', 'character', '/x', 'app', 200, '{\"name\":\"Fixture\"}', $2)", [run, ago(30)]);
  await q.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision, reasoning, decided_at) VALUES (2, 'category', '\"Combat\"', 'approved', 'Blizzard files it under \"Kills\"', $1)", [ago(30)]);

  // Backups from before 0.5.0 hold Blizzard data: one taken 3 days 2 hours ago (goes), one 2 days ago (stays). A
  // 0.5.0 backup of our own data from long ago stays (the first of its month is kept indefinitely).
  const dir = mkdtempSync(join(tmpdir(), 'es-retention-'));
  for (const [name, age] of [['everstats-2026-01-01.dump', 3 * DAY + 2 * 3600_000], ['everstats-2026-01-02.dump', 2 * DAY], ['everstats-ours-2025-12-01.dump', 300 * DAY]]) {
    writeFileSync(join(dir, name), 'x');
    const at = new Date(Date.now() - age);
    utimesSync(join(dir, name), at, at);
  }
  const { runRetentionSweep } = await import('../retention/sweep.js');
  const { pruneBackups } = await import('../core/backup.js');
  const r = await runRetentionSweep(t.db, { processName: 'test', pruneBackups: () => pruneBackups(dir).length });
  assert.equal(r.problem, null);

  assert.deepEqual((await q.query('SELECT character_id FROM character_statistics ORDER BY 1')).map((x) => x.character_id), [7001]);
  assert.equal((await q.one('SELECT count(*)::int AS n FROM character_snapshots')).n, 1);
  assert.deepEqual((await q.query('SELECT item_id FROM item_media')).map((x) => x.item_id), [1]);
  assert.equal((await q.one('SELECT count(*)::int AS n FROM pin_rank_history')).n, 1);
  assert.equal(await q.one('SELECT id FROM discovery_runs WHERE id = $1', [run]), null);
  assert.equal((await q.one('SELECT count(*)::int AS n FROM discovery_responses')).n, 0);
  assert.deepEqual(await q.one('SELECT decision, value, reasoning FROM discovery_decisions WHERE statistic_id = 2'), { decision: 'approved', value: 'Combat', reasoning: '' }); // ours stays; quoted Blizzard text goes
  assert.deepEqual(await q.one('SELECT name, category_path FROM statistics WHERE id = 2'), { name: null, category_path: [] }); // unavailable, never invented
  assert.equal((await q.one('SELECT name FROM statistics WHERE id = 1')).name, 'Fixture fresh stat');
  // The gone character: a stub of OUR data only (id, owner, hidden), every Blizzard field gone.
  const gone = await q.one('SELECT slug, name, guild_id, ruleset_id, equipment, media, profile_state, owner_account_id, hidden FROM characters WHERE id = 7002');
  assert.deepEqual(gone, { slug: null, name: null, guild_id: null, ruleset_id: null, equipment: null, media: null, profile_state: 'purged', owner_account_id: acct, hidden: true });
  // The stale gear: gone; the fresh profile stays.
  assert.deepEqual(await q.one('SELECT name, equipment FROM characters WHERE id = 7003'), { name: 'Stale', equipment: null });
  assert.equal(await q.one("SELECT id FROM guilds WHERE slug = 'old-guild'"), null);
  assert.equal(await q.one('SELECT id FROM rulesets WHERE id = 99'), null);
  assert.deepEqual(readdirSync(dir).sort(), ['everstats-2026-01-02.dump', 'everstats-ours-2025-12-01.dump']);
  rmSync(dir, { recursive: true, force: true });

  // Nothing Blizzard-sourced is older than the keep window afterwards.
  const { retentionStatus } = await import('../retention/sweep.js');
  const status = await retentionStatus(t.db);
  assert.ok(Date.now() - Date.parse(status.oldestAt) < 26 * DAY, JSON.stringify(status.oldest));
  assert.equal(status.lastSweep.deleted.backups, 1);
  // A purged character leaves its owner's list until a sign-in brings it back (and keeps its hidden flag then).
  const { upsertKnown } = await import('../crawler/store.js');
  await t.db.tx((x) => upsertKnown(x, { id: 7002, slug: 'gone-fixture', name: 'Gone', surname: 'Fixture', level: 30 }, { source: 'account', ownerAccountId: acct }));
  assert.deepEqual(await q.one('SELECT name, profile_state, hidden FROM characters WHERE id = 7002'), { name: 'Gone', profile_state: 'not_found', hidden: true });
});

test('a character Blizzard stops returning comes off the boards at once and says so; it never shows old values as current', async () => {
  const { markProfileMissing } = await import('../crawler/store.js');
  await t.db.tx((x) => markProfileMissing(x, 'fresh-fixture'));
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM character_statistics WHERE character_id = 7001')).n, 0);
  const res = (await t.client().get('/api/characters/fresh-fixture')).json;
  assert.equal(res.status, 'missing');
  assert.ok(res.since);
});

test('log lines never carry a character or guild name (Blizzard data) from a request path', async () => {
  const { loggablePath } = await import('../core/errors.js');
  assert.equal(loggablePath('/api/characters/path-vexley?token=x'), '/api/characters/:name');
  assert.equal(loggablePath('/c/h%C3%A9ros-shade'), '/c/:name');
  assert.equal(loggablePath('/g/grandmas-only'), '/g/:name');
  assert.equal(loggablePath('/api/leaderboards/2/60'), '/api/leaderboards/2/60');
});
