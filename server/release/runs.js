import { HttpError } from '../core/errors.js';
import { checkLabel, checkScope, compareSnapshots, takeSnapshot } from './snapshot.js';
import { requestRegrade, setCrawl, versionCheck } from './ops.js';

/**
 * The guided deploy checklist (0.10.3, release_runs). A run is "before" or "after" a deploy, labelled (e.g. "0.11.0"),
 * for one game version + region (the scope the page was on when it started; kept in steps.scope). Each step is DONE
 * FROM THE PAGE: the server performs it, records its state and result in release_runs.steps, and logs release.step.
 *
 *   before  pause → regrade → snapshot
 *   after   version → regrade → snapshot → compare (with the newest "before" snapshot) → resume
 *
 * A step's state: working (a regrade waiting for the worker) · done · failed, with a one-line result. A regrade stays
 * "working" until its tier_runs row is done or failed; reading the run settles it (and logs the step's outcome once).
 * Steps can be done again (a failed version check after the deploy finishes, a second snapshot). One open run at a time.
 */
export const STEPS = Object.freeze({
  before: [
    { id: 'pause', label: 'Pause the background crawl', needsReason: true },
    { id: 'regrade', label: 'Regrade tiers' },
    { id: 'snapshot', label: 'Take a snapshot' },
  ],
  after: [
    { id: 'version', label: 'Confirm the new version is live' },
    { id: 'regrade', label: 'Regrade tiers' },
    { id: 'snapshot', label: 'Take a snapshot' },
    { id: 'compare', label: 'Compare with the newest “before” snapshot' },
    { id: 'resume', label: 'Resume the background crawl', needsReason: true },
  ],
});

const RUN_COLS = 'id, kind, label, started_at, finished_at, abandoned_at, steps';

function view(r) {
  if (!r) return null;
  const steps = r.steps ?? {};
  return {
    id: String(r.id), kind: r.kind, label: r.label, startedAt: r.started_at, finishedAt: r.finished_at, abandonedAt: r.abandoned_at,
    open: !r.finished_at && !r.abandoned_at,
    scope: steps.scope ?? null,
    steps: STEPS[r.kind].map((s) => ({ ...s, ...(steps.items?.[s.id] ?? { state: 'not_started' }) })),
  };
}

const logStep = (q, run, step, result) => q.query("INSERT INTO admin_events (type, detail) VALUES ('release.step', $1::jsonb)", [JSON.stringify({ run: String(run), step, result: String(result).slice(0, 200) })]);

async function setStep(db, runId, step, value) {
  await db.query(
    "UPDATE release_runs SET steps = jsonb_set(jsonb_set(steps, '{items}', coalesce(steps->'items', '{}'::jsonb)), ARRAY['items', $2], $3::jsonb) WHERE id = $1",
    [runId, step, JSON.stringify({ ...value, at: new Date().toISOString() })],
  );
}

/** A regrade step still working: settle it from its tier_runs row (once: the conditional UPDATE decides who logs). */
async function settle(db, row) {
  const item = row.steps?.items?.regrade;
  if (item?.state !== 'working' || !item.tierRun) return row;
  const t = await db.one('SELECT status, finished_at, summary, problem FROM tier_runs WHERE id = $1', [item.tierRun]);
  let next = null;
  if (!t) next = { state: 'failed', result: 'The grading request disappeared.' };
  else if (t.status === 'done') next = { state: 'done', result: `Graded ${(t.summary?.rulesets ?? []).length} realm categor${(t.summary?.rulesets ?? []).length === 1 ? 'y' : 'ies'} (every version)`, tierRun: item.tierRun };
  else if (t.status === 'failed') next = { state: 'failed', result: `The grading failed: ${t.problem ?? 'no reason recorded'}`, tierRun: item.tierRun };
  if (!next) return row;
  const updated = await db.one(
    `UPDATE release_runs SET steps = jsonb_set(steps, '{items,regrade}', $2::jsonb)
      WHERE id = $1 AND steps->'items'->'regrade'->>'state' = 'working' AND steps->'items'->'regrade'->>'tierRun' = $3 RETURNING ${RUN_COLS}`,
    [row.id, JSON.stringify({ ...next, at: new Date().toISOString() }), String(item.tierRun)],
  );
  if (updated) await logStep(db, row.id, 'regrade', next.result);
  return updated ?? (await db.one(`SELECT ${RUN_COLS} FROM release_runs WHERE id = $1`, [row.id]));
}

export async function listRuns(db, { limit = 10 } = {}) {
  const open = await db.one(`SELECT ${RUN_COLS} FROM release_runs WHERE finished_at IS NULL AND abandoned_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  const recent = await db.query(`SELECT ${RUN_COLS} FROM release_runs WHERE finished_at IS NOT NULL OR abandoned_at IS NOT NULL ORDER BY started_at DESC LIMIT $1`, [limit]);
  return { open: view(open ? await settle(db, open) : null), recent: recent.map(view) };
}

async function loadRun(db, id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) throw new HttpError(400, 'Which run?', 'invalid');
  const row = await db.one(`SELECT ${RUN_COLS} FROM release_runs WHERE id = $1`, [id]);
  if (!row) throw new HttpError(404, 'No such checklist run');
  return row;
}

export async function getRun(db, id) {
  return view(await settle(db, await loadRun(db, id)));
}

export async function startRun(db, { kind, label, version, region }) {
  if (!STEPS[kind]) throw new HttpError(400, 'Before or after the deploy?', 'invalid');
  const clean = checkLabel(label);
  checkScope(version, region);
  return db.tx(async (q) => {
    const open = await q.one('SELECT id FROM release_runs WHERE finished_at IS NULL AND abandoned_at IS NULL LIMIT 1 FOR UPDATE');
    if (open) throw new HttpError(409, 'A checklist is already open: finish or abandon it first.', 'run_open');
    const row = await q.one(`INSERT INTO release_runs (kind, label, steps) VALUES ($1, $2, $3::jsonb) RETURNING ${RUN_COLS}`, [kind, clean, JSON.stringify({ scope: { version, region }, items: {} })]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('release.run_started', $1::jsonb)", [JSON.stringify({ run: String(row.id), kind, label: clean, version, region })]);
    return view(row);
  });
}

export async function finishRun(db, id, { abandoned = false } = {}) {
  const row = await loadRun(db, id);
  if (row.finished_at || row.abandoned_at) throw new HttpError(409, 'This checklist is already closed.', 'closed');
  const done = await db.tx(async (q) => {
    const r = await q.one(
      `UPDATE release_runs SET ${abandoned ? 'abandoned_at' : 'finished_at'} = now() WHERE id = $1 AND finished_at IS NULL AND abandoned_at IS NULL RETURNING ${RUN_COLS}`,
      [id],
    );
    if (r) await q.query("INSERT INTO admin_events (type, detail) VALUES ('release.run_finished', $1::jsonb)", [JSON.stringify({ run: String(id), abandoned: Boolean(abandoned) })]);
    return r;
  });
  if (!done) throw new HttpError(409, 'This checklist is already closed.', 'closed');
  return view(done);
}

/** The newest snapshot of a "before" run in this scope, taken before `before`, whose data hasn't aged out. */
async function newestBefore(db, { version, region, before }) {
  return db.one(
    `SELECT s.id, s.label FROM release_snapshots s JOIN release_runs r ON r.id = s.run_id JOIN release_snapshot_data d ON d.snapshot_id = s.id
      WHERE r.kind = 'before' AND s.game_version = $1 AND s.region = $2 AND s.taken_at < $3 ORDER BY s.taken_at DESC LIMIT 1`,
    [version, region, before],
  );
}

/** Performs one step of an open run. body: { reason } for pause / resume. → the run. */
export async function doStep(db, id, step, body = {}) {
  const row = await loadRun(db, id);
  if (row.finished_at || row.abandoned_at) throw new HttpError(409, 'This checklist is closed.', 'closed');
  const def = STEPS[row.kind].find((s) => s.id === step);
  if (!def) throw new HttpError(404, 'No such step');
  const { version, region } = row.steps?.scope ?? {};
  const runId = row.id;
  const record = async (value) => {
    await setStep(db, runId, step, value);
    if (value.state !== 'working' || value.result) await logStep(db, runId, step, value.result ?? value.state);
  };
  if (step === 'pause' || step === 'resume') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new HttpError(400, 'Say why: the reason goes in the audit log.', 'reason_required');
    const state = await setCrawl(db, step === 'resume', { reason, runId });
    await record({ state: 'done', result: state.on ? 'Background crawl running' : 'Background crawl paused' });
  } else if (step === 'regrade') {
    const tierRun = await requestRegrade(db, { version, region, runId });
    await record({ state: 'working', tierRun, result: `Requested (grading #${tierRun}): the worker starts it after 30 s of quiet` });
  } else if (step === 'snapshot') {
    const snap = await takeSnapshot(db, { label: `${row.kind} ${row.label}`.slice(0, 80), version, region, runId });
    await record({ state: 'done', snapshot: snap.id, result: `Snapshot #${snap.id} “${snap.label}”: ${snap.characters ?? 0} characters` });
  } else if (step === 'compare') {
    const mine = row.steps?.items?.snapshot?.snapshot;
    if (!mine) {
      await record({ state: 'failed', result: 'Take this run’s snapshot first.' });
    } else {
      const taken = await db.one('SELECT taken_at FROM release_snapshots WHERE id = $1', [mine]);
      const base = taken ? await newestBefore(db, { version, region, before: taken.taken_at }) : null;
      if (!base) {
        await record({ state: 'failed', result: 'No “before” snapshot of this version with data to compare with.' });
      } else {
        const c = await compareSnapshots(db, base.id, mine, { runId });
        const differ = c.sections.filter((s) => !s.same).length;
        await record({
          state: 'done', a: String(base.id), b: String(mine), identical: c.identical, onlyNew: c.onlyNewCharacters,
          result: c.identical ? `Identical to “${base.label}”` : c.onlyNewCharacters ? `Differs from “${base.label}” only by new characters` : `${differ} check(s) differ from “${base.label}”`,
        });
      }
    }
  } else if (step === 'version') {
    const v = await versionCheck(db);
    await record(v.live
      ? { state: 'done', result: `Live: web ${v.web}, worker ${(v.workers.find((w) => w.responding) ?? v.workers[0])?.version ?? '—'}, CHANGELOG ${v.changelog}` }
      : { state: 'failed', result: v.problems.join(' ') });
  }
  return getRun(db, id);
}
