/**
 * The worker's job registry. Each background job declares itself here; the loop (worker/loop.js) runs whatever is
 * listed, reports each one's last run in its health and in worker_status, and never needs editing to add one.
 *
 *   { id, label, everyMs, run({ db, now, signal }) → { summary } }
 *
 * EMPTY in the scaffold, on purpose. Coming (each after the discovery pass): the daily re-sync of every tracked
 * character, guild-roster seeding, the on-search refresh queue, daily snapshots, tier recomputation per ruleset.
 */
export const JOBS = Object.freeze([]);
