import { execFile } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';
import { BACKUP_KEEP_MONTHLY, BACKUP_KEEP_NIGHTLY, DAY_MS, LEGACY_BACKUP_KEEP_DAYS } from '../retention/policy.js';
import { BLIZZARD } from '../retention/registry.js';

/**
 * Nightly backups of EVERSTATS' OWN DATA (RESTORE.md says how to put one back). The worker runs them
 * (worker/jobs.js); `node server/tools/backup.js now` runs one by hand.
 *
 * 0.5.0: a backup holds no Blizzard data. The retention registry (retention/registry.js) is the list: every table it
 * classifies as Blizzard data is dumped as SCHEMA ONLY (pg_dump --exclude-table-data), so a restore recreates it empty
 * and the crawler fills it again. Three of those tables also hold something of ours, copied into a `backup_stubs`
 * schema just before the dump (and dropped after):
 *   backup_stubs.characters           id, owner, owned since, hidden, tracked since, how it was found (no name, slug,
 *                                     level or anything else Blizzard returned)
 *   backup_stubs.statistics           statistic ids and when we first saw them (no names)
 *   backup_stubs.discovery_decisions  the owner's decisions, with the reasoning text (which quotes Blizzard names)
 *                                     blanked and the run link (a Blizzard-data run) dropped
 * plus backup_stubs.restore(), which a restore calls between the data and the constraints to put them back.
 *
 * How one backup goes:
 *   1. The stubs are written (one transaction), then pg_dump writes a custom-format archive as a hidden
 *      `.everstats-ours-YYYY-MM-DD.dump.partial` in BACKUP_DIR. The password travels in PGPASSWORD, never the command
 *      line.
 *   2. It is checked: `pg_restore --list` must show our _migrations data and the stubs, and must show NO table data for
 *      any Blizzard table (a dump that would carry Blizzard data fails here and is deleted); then `pg_restore
 *      --file=/dev/null` reads the WHOLE archive, so a damaged byte anywhere fails the backup instead of a restore.
 *   3. Only then is it renamed to `everstats-ours-YYYY-MM-DD.dump` (a second backup the same day replaces the first),
 *      and old ones are pruned.
 * A run that fails at any step removes its partial file, records the failure (backup_runs) and logs
 * `[backup] FAILED`; the earlier backups are untouched. The stubs schema is dropped either way.
 *
 * Kept (retention/policy.js): the newest BACKUP_KEEP_NIGHTLY (14) plus the first backup of every month, indefinitely (the
 * dev site, 0.10.2: the newest 3 and no monthly copies):
 * none of it is Blizzard data. Dumps from before 0.5.0 (everstats-YYYY-MM-DD.dump) hold Blizzard data and are still
 * deleted LEGACY_BACKUP_KEEP_DAYS (3) after they were taken. Nothing else in the folder is ever touched.
 *
 * A dump holds account identities, session hashes, sealed keys and 2FA secrets (sealed with the root key, which is NOT
 * in the dump). The folder must be as private as the database.
 */
// When the nightly backup becomes due, in UTC. The dump is consistent at any hour (one transaction snapshot).
export const BACKUP_HOUR_UTC = 4;
// After a failed nightly attempt, wait this long before trying again.
export const RETRY_AFTER_MS = 60 * 60 * 1000;
// A lock file older than this is left over from a crashed run.
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;
const LOCK = '.everstats-backup.lock';
const NAME = /^everstats-ours-(\d{4}-\d{2}-\d{2})\.dump$/;
const LEGACY_NAME = /^everstats-(\d{4}-\d{2}-\d{2})\.dump$/;
export const STUB_SCHEMA = 'backup_stubs';

export const backupName = (ms) => `everstats-ours-${new Date(ms).toISOString().slice(0, 10)}.dump`;

/**
 * The backups in `dir`, newest first: [{ name, date, takenAt (ms: the file's modification time), legacy }]. legacy:
 * a dump from before 0.5.0, which holds Blizzard data.
 */
export function listBackups(dir) {
  return readdirSync(dir)
    .map((name) => {
      const ours = NAME.exec(name);
      const legacy = ours ? null : LEGACY_NAME.exec(name);
      return { name, date: (ours ?? legacy)?.[1], legacy: Boolean(legacy) };
    })
    .filter((b) => b.date)
    .map((b) => {
      let takenAt = Date.parse(`${b.date}T00:00:00Z`);
      try {
        takenAt = statSync(join(dir, b.name)).mtimeMs;
      } catch {
        /* vanished: the date is the best we know */
      }
      return { ...b, takenAt };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(a.legacy) - Number(b.legacy)));
}

/**
 * Which backups to delete. Pure, so the rule is tested on its own. Returns names.
 *   ours    keep the newest `nightly`, and the first (earliest) backup of every calendar month, forever
 *   legacy  (0.4.x, holds Blizzard data) delete once older than `legacyKeepMs`, measured from when it was taken
 */
export function planPrune(backups, { now = Date.now(), nightly = BACKUP_KEEP_NIGHTLY, monthly = BACKUP_KEEP_MONTHLY, legacyKeepMs = LEGACY_BACKUP_KEEP_DAYS * DAY_MS } = {}) {
  const out = backups.filter((b) => b.legacy && now - b.takenAt > legacyKeepMs).map((b) => b.name);
  const ours = backups.filter((b) => !b.legacy).sort((a, b) => (a.date < b.date ? 1 : -1));
  const firstOfMonth = new Map();
  // 0.10.2: the dev site keeps no monthly copies (core/environment.js).
  if (monthly) for (const b of ours) {
    const month = b.date.slice(0, 7);
    if (!firstOfMonth.has(month) || b.date < firstOfMonth.get(month).date) firstOfMonth.set(month, b);
  }
  const keep = new Set([...ours.slice(0, nightly), ...firstOfMonth.values()].map((b) => b.name));
  for (const b of ours) if (!keep.has(b.name)) out.push(b.name);
  return out;
}

/** Deletes backups the rule says go. → the names removed. (The hourly retention sweep calls this; so does a backup.) */
export function pruneBackups(dir, { now = Date.now() } = {}) {
  const removed = planPrune(listBackups(dir), { now });
  for (const old of removed) rmSync(join(dir, old), { force: true });
  return removed;
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

/** The Blizzard tables (retention registry): dumped without their data. */
export const blizzardTables = () => BLIZZARD.map((e) => e.table);

/** pg_dump's arguments: custom format, every Blizzard table's data left out. */
export const dumpArgs = (file) => [
  '--format=custom', '--compress=6', '--no-password', `--file=${file}`,
  ...blizzardTables().map((t) => `--exclude-table-data=public.${t}`),
];

/**
 * What `pg_restore --list` says is in an archive → { ours, stubs, blizzard: [tables with data] }. A good backup has
 * ours (our _migrations data) and stubs, and no Blizzard table data at all.
 */
export function archiveContents(listing) {
  const lines = String(listing).split('\n');
  const data = new Set(lines.map((l) => / TABLE DATA (\S+) (\S+) /.exec(l)).filter(Boolean).map((m) => `${m[1]}.${m[2]}`));
  return {
    ours: data.has('public._migrations'),
    stubs: data.has(`${STUB_SCHEMA}.characters`),
    blizzard: blizzardTables().filter((t) => data.has(`public.${t}`)),
    tables: data.size,
  };
}

/** Throws unless `listing` is an Everstats backup with no Blizzard data in it. */
export function checkArchive(listing) {
  const c = archiveContents(listing);
  if (!c.ours) throw Object.assign(new Error("the dump's contents don't include Everstats' own tables"), { code: 'BACKUP_UNVERIFIED' });
  if (c.blizzard.length) throw Object.assign(new Error(`the dump holds Blizzard data (${c.blizzard.join(', ')}): not kept`), { code: 'BACKUP_HAS_BLIZZARD_DATA' });
  if (!c.stubs) throw Object.assign(new Error("the dump's contents don't include the character stubs"), { code: 'BACKUP_UNVERIFIED' });
  return c;
}

/**
 * Writes the stubs schema (see the header). backup_stubs.restore() is the restore step: it runs after the data and
 * before the constraints (RESTORE.md), so the stubs are back before the foreign keys that point at them.
 */
export async function prepareStubs(db) {
  await db.tx(async (q) => {
    await q.query(`DROP SCHEMA IF EXISTS ${STUB_SCHEMA} CASCADE`);
    await q.query(`CREATE SCHEMA ${STUB_SCHEMA}`);
    // Whole-table copies on purpose (a backup is the whole of our data): not a read anything pages through.
    await q.query(`CREATE TABLE ${STUB_SCHEMA}.characters AS
      SELECT id, owner_account_id, owned_since, hidden, tracked_since, source, game_version, region, realm_slug, blizzard_id FROM public.characters`);
    // 0.10.0: a stub knows where it lives: its game version, region, realm (none on a realmless version) and Blizzard's id.
    await q.query(`CREATE TABLE ${STUB_SCHEMA}.statistics AS SELECT id, first_seen_at, game_version, blizzard_id, source FROM public.statistics`);
    await q.query(`CREATE TABLE ${STUB_SCHEMA}.discovery_decisions AS
      SELECT id, statistic_id, kind, value, decision, decided_at, game_version FROM public.discovery_decisions`);
    await q.query(`
      CREATE FUNCTION ${STUB_SCHEMA}.restore() RETURNS text LANGUAGE plpgsql AS $fn$
      DECLARE s int; c int; d int;
      BEGIN
        -- Runs BEFORE the restore's post-data section: no primary keys exist yet, so no ON CONFLICT (found by the
        -- 0.5.0 restore proof on a real Postgres 17); NOT EXISTS keeps it safe to run twice.
        -- Statistic ids (their names come back with the next crawl that returns them).
        INSERT INTO public.statistics (id, name, first_seen_at, last_seen_at, game_version, blizzard_id, source)
          SELECT s.id, NULL, s.first_seen_at, s.first_seen_at, s.game_version, s.blizzard_id, s.source FROM ${STUB_SCHEMA}.statistics s
           WHERE NOT EXISTS (SELECT 1 FROM public.statistics x WHERE x.id = s.id);
        GET DIAGNOSTICS s = ROW_COUNT;
        -- Character stubs: exactly what the retention sweep leaves of a purged character. A sign-in or a look-up
        -- brings each one back from Blizzard.
        INSERT INTO public.characters (id, name, surname, profile_state, source, tracked_since, owner_account_id, owned_since, hidden, purged_at,
                                       game_version, region, realm_slug, blizzard_id)
          SELECT s.id, NULL, '', 'purged', s.source, s.tracked_since, s.owner_account_id, s.owned_since, s.hidden, now(),
                 s.game_version, s.region, s.realm_slug, s.blizzard_id FROM ${STUB_SCHEMA}.characters s
           WHERE NOT EXISTS (SELECT 1 FROM public.characters x WHERE x.id = s.id);
        GET DIAGNOSTICS c = ROW_COUNT;
        INSERT INTO public.discovery_decisions (id, statistic_id, kind, value, decision, reasoning, run_id, decided_at, game_version) OVERRIDING SYSTEM VALUE
          SELECT s.id, s.statistic_id, s.kind, s.value, s.decision, '', NULL, s.decided_at, s.game_version FROM ${STUB_SCHEMA}.discovery_decisions s
           WHERE NOT EXISTS (SELECT 1 FROM public.discovery_decisions x WHERE x.id = s.id);
        GET DIAGNOSTICS d = ROW_COUNT;
        -- No snapshot survived, so the weekly and "last N days" boards start collecting again from now.
        DELETE FROM public.pipeline_facts WHERE key = 'first_snapshot_at';
        RETURN format('restored %s statistic ids, %s character stubs, %s decisions', s, c, d);
      END
      $fn$`);
  });
}

export const dropStubs = (db) => db.query(`DROP SCHEMA IF EXISTS ${STUB_SCHEMA} CASCADE`);

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
 * Takes one backup now. Resolves { name, bytes, durationMs, removed, tables } or rejects (partial file removed).
 * `exec` is the program runner (tests pass a fake: they have no pg_dump). `db` writes the stubs.
 */
export async function runBackup({ db, dir, databaseUrl, now = Date.now(), exec = run }) {
  const started = Date.now();
  const unlock = takeLock(dir, now);
  const name = backupName(now);
  const partial = join(dir, `.${name}.partial`);
  try {
    rmSync(partial, { force: true });
    await prepareStubs(db);
    const env = pgEnv(databaseUrl);
    await exec('pg_dump', dumpArgs(partial), { env });
    const { stdout } = await exec('pg_restore', ['--list', partial]);
    const contents = checkArchive(stdout);
    await exec('pg_restore', [`--file=${devNull}`, partial]);
    renameSync(partial, join(dir, name));
    const bytes = statSync(join(dir, name)).size;
    const removed = pruneBackups(dir, { now });
    return { name, bytes, durationMs: Date.now() - started, removed, tables: contents.tables };
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  } finally {
    await dropStubs(db).catch(() => {});
    unlock();
  }
}

/**
 * A backup is due when it's past BACKUP_HOUR_UTC, today's file doesn't exist yet, and no attempt failed lately.
 * Only 0.5.0+ backups count: after the upgrade the first one of ours runs at once, whatever older dumps exist.
 */
export function isDue({ now, backups: all, lastFailureAt = null }) {
  const backups = all.filter((b) => !b.legacy);
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
    const r = await runBackup({ db, dir, databaseUrl, now: now(), exec });
    await db.query("UPDATE backup_runs SET outcome = 'ok', finished_at = now(), file_name = $2, bytes = $3, detail = $4 WHERE id = $1",
      [row.id, r.name, r.bytes, r.removed.length ? `removed ${r.removed.length} older backup(s)` : null]);
    log.log(`[backup] ${r.name}: ${r.bytes} bytes, ${r.tables} tables with data, no Blizzard data, verified, ${r.durationMs} ms${r.removed.length ? `; removed ${r.removed.length} older` : ''}`);
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
