import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startDb } from './helpers.js';

// Backups (core/backup.js). Tests have no pg_dump: a fake runner stands in for pg_dump / pg_restore at the file level.
// Real folders in a temp directory, a real (PGlite) database for the run log.
const URL_ = 'postgres://everstats:s3cret%2Fpw@everstats-db:5432/everstats';
const day = (iso) => Date.parse(`${iso}T05:00:00Z`);

function fakeExec({ dumpFails = false, listOutput = '3; 0 16390 TABLE DATA public _migrations everstats\n4; 0 16400 TABLE DATA public accounts everstats\n', calls = [] } = {}) {
  return async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env });
    if (cmd === 'pg_dump') {
      if (dumpFails) throw Object.assign(new Error('pg_dump failed: connection refused'), { code: 'BACKUP_STEP_FAILED' });
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

test('retention keeps the newest 14 and the earliest backup of every month, forever', async () => {
  const { planPrune } = await import('../core/backup.js');
  const backups = [];
  // Every day from 2026-08-03 to 2026-11-08, newest first.
  for (let t = Date.parse('2026-11-08'); t >= Date.parse('2026-08-03'); t -= 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    backups.push({ name: `everstats-${date}.dump`, date });
  }
  const removed = new Set(planPrune(backups));
  const kept = backups.filter((b) => !removed.has(b.name)).map((b) => b.date);
  assert.deepEqual(kept, [
    '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01',
    '2026-10-31', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', // the 14 newest
    '2026-10-01', '2026-09-01', '2026-08-03', // the first of each earlier month (August started on the 3rd)
  ]);
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
  for (let i = 1; i <= 20; i++) writeFileSync(join(dir, `everstats-2026-10-${String(i).padStart(2, '0')}.dump`), 'old');
  const calls = [];
  const r = await runBackup({ dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ calls }) });
  assert.equal(r.name, 'everstats-2026-11-08.dump');
  assert.ok(r.bytes > 0);
  assert.deepEqual(calls.map((c) => [c.cmd, c.args[0]]), [['pg_dump', '--format=custom'], ['pg_restore', '--list'], ['pg_restore', calls[2].args[0]]]);
  assert.match(calls[2].args[0], /^--file=/, 'the whole archive is read through');
  for (const c of calls) assert.ok(!c.args.join(' ').includes('s3cret'), 'no password in a command line');
  assert.equal(calls[0].env.PGPASSWORD, 's3cret/pw');
  assert.equal(calls[0].env.PGHOST, 'everstats-db');
  const files = readdirSync(dir).sort();
  assert.ok(files.includes('notes.txt'));
  assert.ok(files.includes('everstats-2026-10-01.dump'), "October's first is kept forever");
  assert.equal(files.filter((f) => f.endsWith('.dump')).length, 14 + 1, '14 newest + the monthly one');
  assert.ok(!files.some((f) => f.startsWith('.')), 'no partial or lock file left behind');
});

test('a failed or unverifiable dump leaves no file and keeps every earlier backup', async () => {
  const { runBackup } = await import('../core/backup.js');
  const dir = tempDir();
  writeFileSync(join(dir, 'everstats-2026-11-07.dump'), 'yesterday');
  await assert.rejects(runBackup({ dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ dumpFails: true }) }), /connection refused/);
  await assert.rejects(runBackup({ dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec({ listOutput: '1; TABLE DATA public something_else x\n' }) }), /don't include Everstats/);
  assert.deepEqual(readdirSync(dir), ['everstats-2026-11-07.dump']);
});

test('one backup at a time, and a lock left by a dead process is taken over', async () => {
  const { runBackup } = await import('../core/backup.js');
  const dir = tempDir();
  writeFileSync(join(dir, '.everstats-backup.lock'), String(process.pid)); // held by a live process (this one)
  await assert.rejects(runBackup({ dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec() }), /another backup is running/);
  writeFileSync(join(dir, '.everstats-backup.lock'), '999999999'); // a process that doesn't exist
  const r = await runBackup({ dir, databaseUrl: URL_, now: day('2026-11-08'), exec: fakeExec() });
  assert.equal(r.name, 'everstats-2026-11-08.dump');
  assert.ok(!existsSync(join(dir, '.everstats-backup.lock')));
});

test('runs are recorded, and the status says when the last good one was and whether the newest failed', async () => {
  const { backupStatus, recordedBackup } = await import('../core/backup.js');
  const quiet = { log: () => {}, error: () => {} };
  const dir = tempDir();
  const ok = await recordedBackup({ db: d.db, dir, databaseUrl: URL_, trigger: 'manual', now: () => day('2026-11-08'), exec: fakeExec(), log: quiet });
  assert.equal(ok.outcome, 'ok');
  let s = await backupStatus(d.db, { recent: 5 });
  assert.equal(s.lastSuccessFile, 'everstats-2026-11-08.dump');
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
