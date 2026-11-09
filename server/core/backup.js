import { execFile } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';

/**
 * Nightly backups of the Everstats database (RESTORE.md says how to put one back). The worker runs them
 * (worker/jobs.js); `node server/tools/backup.js now` runs one by hand.
 *
 * How one backup goes:
 *   1. pg_dump writes a custom-format archive (compressed, restorable table by table) as a hidden
 *      `.everstats-YYYY-MM-DD.dump.partial` in BACKUP_DIR (/backups in the worker container). The password travels
 *      in the environment (PGPASSWORD), never in the command line.
 *   2. It is checked: `pg_restore --list` must read its table of contents and find our own _migrations data (an
 *      archive that isn't ours, or is cut short, fails here), then `pg_restore --file=/dev/null` reads the WHOLE
 *      archive, decompressing every table's data, so a damaged byte anywhere fails the backup instead of a restore.
 *   3. Only then is it renamed to `everstats-YYYY-MM-DD.dump` (the UTC date; a second backup the same day replaces
 *      the first), and old ones are pruned.
 * A run that fails at any step removes its partial file, records the failure (backup_runs) and logs
 * `[backup] FAILED`; the earlier backups are untouched.
 *
 * Kept: the newest KEEP_NIGHTLY backups, plus the earliest backup of every calendar month, forever. Everything else
 * named like a backup is deleted after a good run (CLAUDE.md names this as a retention exception). Nothing else in
 * the folder is ever touched.
 *
 * A dump holds everything in the database: account identities, session hashes, sealed keys and 2FA secrets (sealed
 * with the root key, which is NOT in the dump). The folder must be as private as the database.
 */
export const KEEP_NIGHTLY = 14;
// When the nightly backup becomes due, in UTC. The dump is consistent at any hour (one transaction snapshot).
export const BACKUP_HOUR_UTC = 4;
// After a failed nightly attempt, wait this long before trying again.
export const RETRY_AFTER_MS = 60 * 60 * 1000;
// A lock file older than this is left over from a crashed run.
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;
const LOCK = '.everstats-backup.lock';
const NAME = /^everstats-(\d{4}-\d{2}-\d{2})\.dump$/;

export const backupName = (ms) => `everstats-${new Date(ms).toISOString().slice(0, 10)}.dump`;

/** The backups in `dir`, newest first: [{ name, date }]. Only files named like a backup. */
export function listBackups(dir) {
  return readdirSync(dir)
    .map((name) => ({ name, date: NAME.exec(name)?.[1] }))
    .filter((b) => b.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Which backups to delete: everything except the newest `keep` and the earliest of each month. Pure, so the rule is
 * tested on its own. `backups` newest first ([{ name, date }]); returns names.
 */
export function planPrune(backups, keep = KEEP_NIGHTLY) {
  const monthly = new Map(); // 'YYYY-MM' → name of that month's earliest backup
  for (const b of backups) monthly.set(b.date.slice(0, 7), b.name); // newest first, so the last write is the earliest
  const keepNames = new Set([...backups.slice(0, keep).map((b) => b.name), ...monthly.values()]);
  return backups.filter((b) => !keepNames.has(b.name)).map((b) => b.name);
}

/** libpq's environment for a postgres:// URL: the password never appears in a command line. */
export function pgEnv(databaseUrl) {
  const u = new URL(databaseUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '15',
  };
}

/** Runs a program; resolves { stdout } or rejects with a short, single-line reason (the last stderr line). */
export function run(cmd, args, { env = {}, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { PATH: process.env.PATH, ...env }, maxBuffer }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout });
      const last = String(stderr ?? '').trim().split('\n').filter(Boolean).at(-1) ?? '';
      const why = err.code === 'ENOENT' ? `${cmd} is not installed in this container` : `${cmd} failed${last ? `: ${last}` : ` (exit ${err.code})`}`;
      return reject(Object.assign(new Error(why.slice(0, 300)), { code: 'BACKUP_STEP_FAILED' }));
    });
  });
}

/**
 * One backup at a time per folder (the nightly job and a hand-run `backup.js now` share the worker container). The
 * lock file holds the PID that took it; a lock whose process is gone (a restart mid-backup) or that is older than
 * STALE_LOCK_MS is left over, and taken over.
 */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

function takeLock(dir, now) {
  const file = join(dir, LOCK);
  try {
    const pid = Number(readFileSync(file, 'utf8'));
    if (now - statSync(file).mtimeMs > STALE_LOCK_MS || !Number.isInteger(pid) || pid <= 0 || !alive(pid)) rmSync(file, { force: true });
  } catch {
    /* no lock */
  }
  try {
    const fd = openSync(file, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch (err) {
    if (err.code === 'EEXIST') throw Object.assign(new Error('another backup is running right now'), { code: 'BACKUP_BUSY' });
    throw err;
  }
  return () => rmSync(file, { force: true });
}

/**
 * Takes one backup now. Resolves { name, bytes, durationMs, removed } or rejects (partial file removed).
 * `exec` is the program runner (tests pass a fake: they have no pg_dump).
 */
export async function runBackup({ dir, databaseUrl, now = Date.now(), exec = run }) {
  const started = Date.now();
  const unlock = takeLock(dir, now);
  const name = backupName(now);
  const partial = join(dir, `.${name}.partial`);
  try {
    rmSync(partial, { force: true });
    const env = pgEnv(databaseUrl);
    await exec('pg_dump', ['--format=custom', '--compress=6', '--no-password', `--file=${partial}`], { env });
    const { stdout } = await exec('pg_restore', ['--list', partial]);
    if (!/TABLE DATA public _migrations /.test(stdout)) throw Object.assign(new Error("the dump's contents don't include Everstats' own tables"), { code: 'BACKUP_UNVERIFIED' });
    await exec('pg_restore', [`--file=${devNull}`, partial]);
    renameSync(partial, join(dir, name));
    const bytes = statSync(join(dir, name)).size;
    const removed = planPrune(listBackups(dir));
    for (const old of removed) rmSync(join(dir, old), { force: true });
    return { name, bytes, durationMs: Date.now() - started, removed };
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  } finally {
    unlock();
  }
}

/** A backup is due when it's past BACKUP_HOUR_UTC, today's file doesn't exist yet, and no attempt failed lately. */
export function isDue({ now, backups, lastFailureAt = null }) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (new Date(now).getUTCHours() < BACKUP_HOUR_UTC) {
    // Before the hour: only catch up when the newest backup is older than yesterday (a missed night).
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (backups[0] && backups[0].date >= yesterday) return false;
  } else if (backups[0]?.date === today) {
    return false;
  }
  return !(lastFailureAt && now - Date.parse(lastFailureAt) < RETRY_AFTER_MS);
}

/**
 * Runs a backup and records it in backup_runs (started, then finished with its outcome). Never throws: a failure is
 * recorded and logged. Returns the row's outcome.
 */
export async function recordedBackup({ db, dir, databaseUrl, trigger, now = Date.now, exec, log = console }) {
  const row = await db.one("INSERT INTO backup_runs (trigger, outcome) VALUES ($1, 'running') RETURNING id", [trigger]);
  try {
    const r = await runBackup({ dir, databaseUrl, now: now(), exec });
    await db.query("UPDATE backup_runs SET outcome = 'ok', finished_at = now(), file_name = $2, bytes = $3, detail = $4 WHERE id = $1",
      [row.id, r.name, r.bytes, r.removed.length ? `removed ${r.removed.length} older backup(s)` : null]);
    log.log(`[backup] ${r.name}: ${r.bytes} bytes, verified, ${r.durationMs} ms${r.removed.length ? `; removed ${r.removed.length} older` : ''}`);
    return { outcome: 'ok', ...r };
  } catch (err) {
    // Messages here are written by this file or are pg_dump / file-system errors (paths, never data from the database).
    const detail = String(err?.message ?? err).slice(0, 300);
    await db.query("UPDATE backup_runs SET outcome = 'failed', finished_at = now(), detail = $2 WHERE id = $1", [row.id, detail]).catch(() => {});
    log.error(`[backup] FAILED: no backup was written. ${detail}`);
    return { outcome: 'failed', detail };
  }
}

/**
 * What the admin page and the worker's health report. Read from backup_runs, so the web process (which runs no
 * backups) sees the same thing. A 'running' row older than STALE_LOCK_MS counts as abandoned, not running.
 */
export async function backupStatus(db, { recent = 0 } = {}) {
  const last = await db.one("SELECT finished_at, bytes, file_name FROM backup_runs WHERE outcome = 'ok' ORDER BY started_at DESC LIMIT 1");
  const fail = await db.one("SELECT finished_at, detail FROM backup_runs WHERE outcome = 'failed' ORDER BY started_at DESC LIMIT 1");
  const running = await db.one(
    "SELECT started_at FROM backup_runs WHERE outcome = 'running' AND started_at > now() - ($1 || ' milliseconds')::interval ORDER BY started_at DESC LIMIT 1",
    [String(STALE_LOCK_MS)],
  );
  const status = {
    lastSuccessAt: last?.finished_at ?? null,
    lastSuccessBytes: last?.bytes ?? null,
    lastSuccessFile: last?.file_name ?? null,
    lastFailureAt: fail?.finished_at ?? null,
    lastFailure: fail?.detail ?? null,
    failing: Boolean(fail && (!last || fail.finished_at > last.finished_at)),
    running: Boolean(running),
  };
  if (recent > 0) {
    status.recent = (await db.query(
      'SELECT trigger, outcome, started_at, finished_at, file_name, bytes, detail FROM backup_runs ORDER BY started_at DESC LIMIT $1',
      [Math.min(recent, 50)],
    )).map((r) => ({ trigger: r.trigger, outcome: r.outcome, startedAt: r.started_at, finishedAt: r.finished_at, file: r.file_name, bytes: r.bytes, detail: r.detail }));
  }
  return status;
}
