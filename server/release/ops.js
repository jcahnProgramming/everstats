import { readFileSync } from 'node:fs';
import { HttpError } from '../core/errors.js';
import { APP_VERSION } from '../core/version.js';
import { clearFeatureCache, setFeature, switchOn } from '../features/registry.js';
import { requestTierRecompute, TIER_DEBOUNCE_MS } from '../tiers/store.js';
import { checkScope } from './snapshot.js';

/**
 * Release tools' operations (0.10.3): the crawl switch, a full tier regrade, and "is the new version live?".
 *
 * The crawl switch IS the Features page's "Background crawl" (features/registry.js 'crawl', stored as crawler.paused):
 * one setting, so the two pages can never disagree. Pausing it stops the daily refresh, roster expansion, guild fetches
 * and the collections backfill; lookups, sign-ins and their auto-fetch still run, because a person is waiting on them.
 *
 * A regrade is a request for a FULL grading (tier_runs pending row; the worker's tiers job runs it after
 * TIER_DEBOUNCE_MS of quiet). A full grading grades EVERY game version's realm categories at once (tiers/store.js
 * gradeAll without a version): a request can't target one version. The page says so; the version is logged with the
 * request so the audit log shows where it was asked from.
 */
const WORKER_SILENT_MS = 3 * 60 * 1000;

export async function crawlState(db) {
  clearFeatureCache();
  const on = await switchOn(db, 'crawl');
  const change = await db.one(
    "SELECT created_at, detail->>'reason' AS reason FROM admin_events WHERE type = 'setting.changed' AND detail->>'key' = 'crawler.paused' ORDER BY created_at DESC LIMIT 1",
  );
  const waiting = await db.one("SELECT count(*)::int AS n FROM (SELECT 1 FROM crawl_queue WHERE state = 'queued' LIMIT 100000) x");
  return { on, changedAt: change?.created_at ?? null, reason: change?.reason ?? null, queued: waiting?.n ?? 0 };
}

/** Pause (on = false) or resume the background crawl. Logged as setting.changed (by the setting) + release.paused/resumed. */
export async function setCrawl(db, on, { reason, runId = null }) {
  await setFeature(db, 'crawl', on, { reason, confirmDependents: true });
  await db.query('INSERT INTO admin_events (type, detail) VALUES ($1, $2::jsonb)', [on ? 'release.resumed' : 'release.paused', JSON.stringify({
    reason: String(reason).trim().slice(0, 500), ...(runId ? { run: String(runId) } : {}),
  })]);
  return crawlState(db);
}

const STATUS_WORD = { pending: 'queued', running: 'grading', done: 'done', failed: 'failed' };

function runView(r, rulesetIds = null) {
  if (!r) return null;
  const all = Array.isArray(r.summary?.rulesets) ? r.summary.rulesets : [];
  const mine = rulesetIds ? all.filter((x) => rulesetIds.has(Number(x.rulesetId))) : all;
  return {
    id: String(r.id), status: STATUS_WORD[r.status] ?? r.status, reasons: r.reasons ?? [],
    requestedAt: r.requested_at, startedAt: r.started_at, finishedAt: r.finished_at, ms: r.ms ?? null, problem: r.problem ?? null,
    rulesetsAll: all.length,
    rulesets: mine.map((x) => ({ id: Number(x.rulesetId), population: x.population ?? null, graded: Boolean(x.graded) })),
    characters: mine.reduce((s, x) => s + (Number(x.population) || 0), 0),
  };
}

/** The tiers panel for one version + region: the request in flight (or a given one), the last full grading, what is stored. */
export async function tiersState(db, { version, region, runId = null }) {
  checkScope(version, region);
  const rs = await db.query('SELECT id, name FROM rulesets WHERE game_version = $1 AND region = $2 ORDER BY id LIMIT 400', [version, region]);
  const ids = new Set(rs.map((r) => Number(r.id)));
  const cols = 'id, status, reasons, requested_at, started_at, finished_at, ms, summary, problem';
  const inFlight = await db.one(`SELECT ${cols} FROM tier_runs WHERE status IN ('pending', 'running') ORDER BY requested_at DESC LIMIT 1`);
  const asked = runId && /^[0-9]{1,18}$/.test(String(runId)) ? await db.one(`SELECT ${cols} FROM tier_runs WHERE id = $1`, [runId]) : null;
  const last = await db.one(`SELECT ${cols} FROM tier_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1`);
  const lastFailed = await db.one(`SELECT ${cols} FROM tier_runs WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 1`);
  const stored = await db.one(
    `SELECT count(*)::int AS rulesets, count(*) FILTER (WHERE graded)::int AS graded, coalesce(sum(population), 0)::int AS population, max(computed_at) AS computed_at
       FROM tier_rulesets WHERE ruleset_id = ANY($1::int[])`,
    [[...ids]],
  );
  const lettered = await db.one(
    'SELECT count(*)::int AS n FROM character_tiers WHERE ruleset_id = ANY($1::int[]) AND letter IS NOT NULL',
    [[...ids]],
  );
  const names = Object.fromEntries(rs.map((r) => [Number(r.id), r.name]));
  return {
    version, region, names,
    inFlight: runView(inFlight, ids),
    run: runView(asked, ids),
    last: runView(last, ids),
    lastFailed: lastFailed && (!last || new Date(lastFailed.finished_at) > new Date(last.finished_at)) ? runView(lastFailed, ids) : null,
    stored: { rulesets: stored.rulesets, graded: stored.graded, population: stored.population, lettered: lettered.n, computedAt: stored.computed_at },
    debounceMs: TIER_DEBOUNCE_MS,
    gradesEveryVersion: true,
  };
}

/** Asks for a full grading. → the tier_runs id (the pending row the worker will pick up). Logs tiers.regrade_requested. */
export async function requestRegrade(db, { version, region, runId = null }) {
  checkScope(version, region);
  const id = await db.tx(async (q) => {
    const tierRun = await requestTierRecompute(q, 'release tools');
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('tiers.regrade_requested', $1::jsonb)", [JSON.stringify({
      version, ...(tierRun ? { tierRun: String(tierRun) } : {}), ...(runId ? { run: String(runId) } : {}),
    })]);
    return tierRun;
  });
  if (!id) throw new HttpError(409, 'A grading request is already waiting; try again in a moment.', 'busy');
  return String(id);
}

/** The newest version CHANGELOG.json names right now (read from disk, not the copy this process started with). */
function changelogNewest() {
  try {
    const doc = JSON.parse(readFileSync(new URL('../../CHANGELOG.json', import.meta.url), 'utf8'));
    return doc.releases?.[0]?.version ?? null;
  } catch {
    return null;
  }
}

/** Is the new version live? The web process's version, CHANGELOG's newest, and what each worker reports. */
export async function versionCheck(db, { now = Date.now() } = {}) {
  const changelog = changelogNewest();
  const workers = (await db.query('SELECT worker_id, version, last_tick_at FROM worker_status ORDER BY last_tick_at DESC LIMIT 5')).map((w) => ({
    id: w.worker_id, version: w.version, lastTickAt: w.last_tick_at,
    responding: now - new Date(w.last_tick_at).getTime() < WORKER_SILENT_MS,
  }));
  const worker = workers.find((w) => w.responding) ?? null;
  const problems = [];
  if (!changelog) problems.push('CHANGELOG.json couldn’t be read.');
  else if (APP_VERSION !== changelog) problems.push(`The web process runs ${APP_VERSION} but CHANGELOG.json’s newest is ${changelog}: the web process hasn’t restarted on the new build.`);
  if (!worker) problems.push(workers.length ? 'The worker is not responding (no heartbeat in the last 3 minutes).' : 'No worker has ever reported.');
  else if (worker.version !== changelog) problems.push(`The worker reports ${worker.version}, not ${changelog ?? 'the newest version'}.`);
  return { web: APP_VERSION, changelog, workers, live: problems.length === 0, problems };
}
