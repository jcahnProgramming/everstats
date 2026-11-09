import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startDb } from './helpers.js';

// Backups (core/backup.js). Tests have no pg_dump: a fake runner stands in for pg_dump / pg_restore at the file level.
// Real folders in a temp directory, a real (PGlite) database for the run log.
const URL_ = 'postgres://everstats:s3cret%2Fpw@everstats-db:5432/everstats';
const day = (iso) => Date.parse(`${iso}T05:00:00Z`);

// What pg_restore --list prints for a 0.5.0 backup: our tables' data and the stubs, no Blizzard table data.
const OURS_LISTING = '3; 0 16390 TABLE DATA public _migrations everstats\n4; 0 16400 TABLE DATA public accounts everstats\n5; 0 16500 TABLE DATA backup_stubs characters everstats\n';

function fakeExec({ dumpFails = false, listOutput = OURS_LISTING, calls = [], onDump = null } = {}) {
  return async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env });
    if (cmd === 'pg_dump') {
      if (dumpFails) throw Object.assign(new Error('pg_dump failed: connection refused'), { code: 'BACKUP_STEP_FAILED' });
      if (onDump) await onDump();
      writeFileSync(args.find((a) => a.startsWith('--file=')).slice(7), 'PGDMP fake archive');
      return { stdout: '' };
    }
    if (cmd === 'pg_restore' && args[0] === '--list') return { stdout: listOutput };
    return { stdout: '' };
  };
}

let d;
const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'es-backup-'));
  dirs.push(dir);
  return dir;
};
before(async () => {
  d = await startDb();
});
after(async () => {
  await d.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('backups of our own data: the newest 14 nightly plus the first of each month, kept indefinitely; a pre-0.5.0 dump (Blizzard data) still goes after 3 days', async () => {
  const { planPrune } = await import('../core/backup.js');
  const now = Date.parse('2026-11-30T12:00:00Z');
  const ours = (date) => ({ name: `everstats-ours-${date}.dump`, date, takenAt: Date.parse(`${date}T04:05:00Z`), legacy: false });
  const legacy = (iso) => ({ name: `everstats-${iso.slice(0, 10)}.dump`, date: iso.slice(0, 10), takenAt: Date.parse(iso), legacy: true });
  const nights = Array.from({ length: 30 }, (_, i) => ours(`2026-11-${String(30 - i).padStart(2, '0')}`)); // 30 nights of November
  const backups = [...nights, ours('2026-10-01'), ours('2026-10-15'), ours('2025-01-07'), legacy('2026-11-28T04:05:00Z'), legacy('2026-11-27T04:05:00Z')];
  const removed = planPrune(backups, { now });
  // Kept: 17–30 November (14 nightly), 1 November (first of its month), 1 October, 7 January 2025 (first of theirs).
  const kept = backups.map((b) => b.name).filter((n) => !removed.includes(n));
  assert.equal(kept.filter((n) => n.startsWith('everstats-ours-2026-11')).length, 15);
  assert.ok(kept.includes('everstats-ours-2026-11-01.dump'));
  assert.ok(kept.includes('everstats-ours-2026-10-01.dump'));
  assert.ok(kept.includes('everstats-ours-2025-01-07.dump'));
  assert.ok(removed.includes('everstats-ours-2026-10-15.dump'));
  assert.ok(removed.includes('everstats-ours-2026-11-16.dump'));
  // Legacy dumps hold Blizzard data: 11-27 04:05 is 3 days 8 hours old (goes), 11-28 is 2 days 8 hours (stays, for now).
  assert.ok(removed.includes('everstats-2026-11-27.dump'));
  assert.ok(!removed.includes('everstats-2026-11-28.dump'));
});

test('a backup is due after 04:00 UTC when today has none, catches up a missed night, and backs off after a failure', async () => {
  const { isDue } = await import('../core/backup.js');
  const b = (date) => [{ name: `everstats-${date}.dump`, date }];
  assert.equal(isDue({ now: Date.parse('2026-11-08T03:00:00Z'), backups: b('2026-11-07') }), false, 'before the hour, last night is fine');
  assert.equal(isDue({ now: Date.parse('2026-11-08T04:10:00Z'), backups: b('2026-11-07') }), true);
  assert.equal(isDue({ now: Date.parse('2026-11-08T04:10:00Z'), backups: b('2026-11-08') }), false, 'one a day');
  assert.equal(isDue({ now: Date.parse('2026-11-08T01:00:00Z'), backups: b('2026-11-05') }), true, 'a missed night is caught up at once');
  assert.equal(isDue({ now: Date.parse('2026-11-08T01:00:00Z'), backups: [] }), true, 'the very first backup does not wait for 04:00');
  assert.equal(isDue({ now: Date.parse('2026-11-08T05:00:00Z'), backups: [], lastFailureAt: '2026-11-08T04:30:00Z' }), false, 'retry after an hour');
  assert.equal(isDue({ now: Date.parse('2026-11-08T06:00:00Z'), backups: [], lastFailureAt: '2026-11-08T04:30:00Z' }), true);
});

test('a backup is dumped, verified, renamed and pruned; the password travels in the environment only', async () => {
  const { runBackup } = await import('../core/backup.js');
  const dir = tempDir();
  writeFileSync(join(dir, 'notes.txt'), 'not a backup'); // never touched
  for (let i = 1; i <= 20; i++) {
    const f = join(dir, `everstats-2026-10-${String(i).padStart(2, '0')}.dump`);
    writeFileSync(f, 'old');
    const t = new Date(`2026-10-${String(i).padStart(2, '0')}T04:05:00Z`);
    utimesSync(f, t, t); // taken that night
  }
  const calls = [];
  let stubsDuringDump = null;
  const onDump = async () => {
    stubsDuringDump = (await d.db.one("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'backup_stubs'")).n;
  };
  const r = await runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ calls, onDump }) });
  assert.equal(r.name, 'everstats-ours-2026-11-08.dump');
  assert.equal(stubsDuringDump, 3, 'the stubs exist while pg_dump runs');
  assert.equal((await d.db.one("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'backup_stubs'")).n, 0, 'and are dropped after');
  // Every Blizzard table's data is left out of the dump (its schema stays, so a restore recreates it empty).
  const { BLIZZARD } = await import('../retention/registry.js');
  for (const e of BLIZZARD) assert.ok(calls[0].args.includes(`--exclude-table-data=public.${e.table}`), e.table);
  assert.ok(r.bytes > 0);
  assert.deepEqual(calls.map((c) => [c.cmd, c.args[0]]), [['pg_dump', '--format=custom'], ['pg_restore', '--list'], ['pg_restore', calls[2].args[0]]]);
  assert.match(calls[2].args[0], /^--file=/, 'the whole archive is read through');
  for (const c of calls) assert.ok(!c.args.join(' ').includes('s3cret'), 'no password in a command line');
  assert.equal(calls[0].env.PGPASSWORD, 's3cret/pw');
  assert.equal(calls[0].env.PGHOST, 'everstats-db');
  const files = readdirSync(dir).sort();
  assert.ok(files.includes('notes.txt'));
  // The October dumps are pre-0.5.0 ones (Blizzard data), all more than 3 days old: only tonight's is left.
  assert.deepEqual(files.filter((f) => f.endsWith('.dump')), ['everstats-ours-2026-11-08.dump']);
  assert.ok(!files.some((f) => f.startsWith('.')), 'no partial or lock file left behind');
});

test('a failed or unverifiable dump leaves no file and keeps every earlier backup', async () => {
  const { runBackup } = await import('../core/backup.js');
  const dir = tempDir();
  writeFileSync(join(dir, 'everstats-2026-11-07.dump'), 'yesterday');
  writeFileSync(join(dir, 'everstats-ours-2026-11-06.dump'), 'before');
  await assert.rejects(runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ dumpFails: true }) }), /connection refused/);
  await assert.rejects(runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ listOutput: '1; 0 1 TABLE DATA public something_else x\n' }) }), /don't include Everstats/);
  // A dump that would carry Blizzard data is never kept.
  await assert.rejects(runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ listOutput: `${OURS_LISTING}9; 0 1 TABLE DATA public characters x\n` }) }), /holds Blizzard data \(characters\)/);
  assert.deepEqual(readdirSync(dir).sort(), ['everstats-2026-11-07.dump', 'everstats-ours-2026-11-06.dump']);
});

test('one backup at a time, and a lock left by a dead process is taken over', async () => {
  const { runBackup } = await import('../core/backup.js');
  const dir = tempDir();
  writeFileSync(join(dir, '.everstats-backup.lock'), String(process.pid)); // held by a live process (this one)
  await assert.rejects(runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec() }), /another backup is running/);
  writeFileSync(join(dir, '.everstats-backup.lock'), '999999999'); // a process that doesn't exist
  const r = await runBackup({ db: d.db, dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec() });
  assert.equal(r.name, 'everstats-ours-2026-11-08.dump');
  assert.ok(!existsSync(join(dir, '.everstats-backup.lock')));
});

test('runs are recorded, and the status says when the last good one was and whether the newest failed', async () => {
  const { backupStatus, recordedBackup } = await import('../core/backup.js');
  const quiet = { log: () => {}, error: () => {} };
  const dir = tempDir();
  const ok = await recordedBackup({ db: d.db, dir, databaseUrl: URL_, trigger: 'manual', now: () => day('2026-11-08'), exec: fakeExec(), log: quiet });
  assert.equal(ok.outcome, 'ok');
  let s = await backupStatus(d.db, { recent: 5 });
  assert.equal(s.lastSuccessFile, 'everstats-ours-2026-11-08.dump');
  assert.ok(s.lastSuccessBytes > 0);
  assert.equal(s.failing, false);
  const bad = await recordedBackup({ db: d.db, dir, databaseUrl: URL_, trigger: 'nightly', now: () => day('2026-11-09'), exec: fakeExec({ dumpFails: true }), log: quiet });
  assert.equal(bad.outcome, 'failed');
  s = await backupStatus(d.db, { recent: 5 });
  assert.equal(s.failing, true);
  assert.match(s.lastFailure, /connection refused/);
  assert.equal(s.recent[0].outcome, 'failed');
  assert.equal(s.recent[1].outcome, 'ok');
});

test('the nightly job starts the dump without blocking the loop, and the worker health reports it', async () => {
  const { backupJob } = await import('../worker/jobs.js');
  const { createLoop } = await import('../worker/loop.js');
  const { createWorkerApp } = await import('../worker/app.js');
  await d.db.query('DELETE FROM backup_runs'); // the previous test's failure would (rightly) hold the job off for an hour
  const dir = tempDir();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const slow = fakeExec();
  const exec = async (...a) => {
    if (a[0] === 'pg_dump') await gate; // the dump takes "a long time"
    return slow(...a);
  };
  const job = backupJob({ dir, databaseUrl: URL_, exec, log: { log: () => {}, error: () => {} } });
  const loop = createLoop({ db: d.db, jobs: [job], workerId: 'backup-test', version: '0.0.0' });
  await loop.tick(); // returns while pg_dump is still "running"
  assert.equal(loop.health().healthy, true);
  assert.equal(loop.health().jobs[0].lastSummary, 'Backup started');
  release();
  await job.inFlight();

  const server = await new Promise((res) => {
    const s = createWorkerApp({ loop, db: d.db, backupDir: dir }).listen(0, '127.0.0.1', () => res(s));
  });
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
  await new Promise((res) => server.close(res));
  assert.equal(body.backup.configured, true);
  assert.ok(body.backup.lastSuccessAt);
  assert.ok(body.backup.lastSuccessBytes > 0);
  assert.equal(body.backup.failing, false);
  assert.equal(body.backup.lastFailure, undefined, 'no failure text in the health answer');

  const off = backupJob({ dir: null });
  assert.equal((await off.run({ db: d.db })).summary, 'Off: BACKUP_DIR is not set');
});

test('a restore puts back our data only: character stubs, statistic ids, decisions without quoted text; snapshots start again', async () => {
  // The real pg_dump / pg_restore round trip is proved by hand (RESTORE.md); this checks backup_stubs.restore(), the
  // step between the data and the constraints, against Postgres itself: stubs written, the Blizzard tables emptied as
  // a restore leaves them, then restored.
  const { prepareStubs, dropStubs } = await import('../core/backup.js');
  const q = d.db;
  await q.query('INSERT INTO accounts DEFAULT VALUES');
  const acct = (await q.one('SELECT id FROM accounts ORDER BY id DESC LIMIT 1')).id;
  await q.query("INSERT INTO rulesets (id, name) VALUES (2, 'Fixture Ruleset') ON CONFLICT DO NOTHING");
  await q.query("INSERT INTO statistics (id, name, first_seen_at) VALUES (60, 'Fixture deaths', '2026-11-01')");
  await q.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, level, profile_state, source, owner_account_id, owned_since, hidden, tracked_since, stats_fetched_at)
     VALUES (8001, 'kept-fixture', 'Kept', 'Fixture', 2, 30, 'ok', 'account', $1, '2026-11-02', true, '2026-11-01', now())`,
    [acct],
  );
  await q.query('UPDATE accounts SET featured_character_id = 8001 WHERE id = $1', [acct]);
  await q.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES (8001, 60, 2, 12, now())');
  await q.query("INSERT INTO discovery_runs (status) VALUES ('done')");
  const run = (await q.one('SELECT id FROM discovery_runs ORDER BY id DESC LIMIT 1')).id;
  await q.query(
    "INSERT INTO discovery_decisions (statistic_id, kind, value, decision, reasoning, run_id) VALUES (60, 'category', $1::jsonb, 'approved', 'Blizzard files it under \"Deaths\"', $2)",
    [JSON.stringify('Deaths & mishaps'), run],
  );
  await q.query("INSERT INTO pipeline_facts (key, at) VALUES ('first_snapshot_at', now()) ON CONFLICT DO NOTHING");
  await prepareStubs(q);
  // What a restore leaves: our tables as they were, every Blizzard table empty.
  await q.tx(async (x) => {
    await x.query('UPDATE accounts SET featured_character_id = NULL WHERE id = $1', [acct]);
    await x.query('DELETE FROM discovery_decisions');
    for (const t of ['character_statistics', 'characters', 'discovery_runs', 'statistics']) await x.query(`DELETE FROM ${t}`);
  });
  const out = (await q.one('SELECT backup_stubs.restore() AS r')).r;
  assert.match(out, /restored 1 statistic ids, 1 character stubs, 1 decisions/);
  await q.query('UPDATE accounts SET featured_character_id = 8001 WHERE id = $1', [acct]); // the foreign key holds again
  const c = await q.one('SELECT slug, name, level, ruleset_id, profile_state, owner_account_id, hidden, tracked_since FROM characters WHERE id = 8001');
  assert.deepEqual({ ...c, tracked_since: c.tracked_since.toISOString().slice(0, 10) },
    { slug: null, name: null, level: null, ruleset_id: null, profile_state: 'purged', owner_account_id: acct, hidden: true, tracked_since: '2026-11-01' });
  assert.deepEqual(await q.one('SELECT name FROM statistics WHERE id = 60'), { name: null });
  assert.deepEqual(await q.one('SELECT value, decision, reasoning, run_id FROM discovery_decisions WHERE statistic_id = 60'),
    { value: 'Deaths & mishaps', decision: 'approved', reasoning: '', run_id: null });
  assert.equal(await q.one("SELECT at FROM pipeline_facts WHERE key = 'first_snapshot_at'"), null);
  await dropStubs(q);
});
