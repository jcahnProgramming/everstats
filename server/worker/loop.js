/**
 * The worker's loop: every TICK_MS it runs each registered job that is due (worker/jobs.js), one at a time, then
 * writes its heartbeat to worker_status. A job that throws is recorded as failed (its error's name and code, never a
 * message, which could quote a response body) and the loop carries on.
 *
 * state: 'starting' → 'idle' (nothing due, or no jobs registered) / 'running' (a job in progress) → 'stopping'
 */
export const TICK_MS = 30_000;

export function createLoop({ db, jobs, workerId, version, now = Date.now, tickMs = TICK_MS }) {
  const startedAt = new Date(now());
  const status = { state: 'starting', ticks: 0, lastTickAt: null, lastError: null };
  const runs = new Map(jobs.map((j) => [j.id, { lastStartedAt: null, lastFinishedAt: null, lastOutcome: null, lastSummary: null }]));
  let timer = null;
  let stopping = false;

  const jobView = () => jobs.map((j) => ({ id: j.id, label: j.label, everyMs: j.everyMs, ...runs.get(j.id) }));

  async function heartbeat() {
    await db.query(
      `INSERT INTO worker_status (worker_id, version, started_at, last_tick_at, state, jobs) VALUES ($1, $2, $3, now(), $4, $5::jsonb)
       ON CONFLICT (worker_id) DO UPDATE SET version = EXCLUDED.version, started_at = EXCLUDED.started_at,
         last_tick_at = now(), state = EXCLUDED.state, jobs = EXCLUDED.jobs`,
      [workerId, version, startedAt, status.state, JSON.stringify(jobView())],
    );
  }

  async function tick() {
    for (const job of jobs) {
      if (stopping) break;
      const run = runs.get(job.id);
      const due = !run.lastStartedAt || now() - Date.parse(run.lastStartedAt) >= job.everyMs;
      if (!due) continue;
      status.state = 'running';
      run.lastStartedAt = new Date(now()).toISOString();
      try {
        const result = await job.run({ db, now });
        run.lastOutcome = 'ok';
        run.lastSummary = result?.summary ?? null;
      } catch (err) {
        run.lastOutcome = 'failed';
        run.lastSummary = `${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}`;
        console.error(`[worker] job ${job.id} failed: ${run.lastSummary}`);
      }
      run.lastFinishedAt = new Date(now()).toISOString();
    }
    status.state = stopping ? 'stopping' : 'idle';
    status.ticks += 1;
    status.lastTickAt = new Date(now()).toISOString();
    try {
      await heartbeat();
      status.lastError = null;
    } catch (err) {
      status.lastError = err.code ?? err.name;
      console.error(`[worker] heartbeat failed: ${status.lastError}`);
    }
  }

  const schedule = () => {
    timer = setTimeout(async () => {
      await tick();
      if (!stopping) schedule();
    }, tickMs);
  };

  return {
    async start() {
      await tick();
      schedule();
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      status.state = 'stopping';
      await heartbeat().catch(() => {});
    },
    /** For /api/health: healthy while ticks keep landing and the heartbeat reaches the database. */
    health() {
      const age = status.lastTickAt ? now() - Date.parse(status.lastTickAt) : null;
      const healthy = status.lastTickAt !== null && age <= tickMs * 3 && status.lastError === null;
      return { healthy, state: status.state, ticks: status.ticks, lastTickAt: status.lastTickAt, jobs: jobView(), problem: status.lastError };
    },
    tick,
  };
}
