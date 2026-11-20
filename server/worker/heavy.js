/**
 * The worker's cap on heavy database work (0.11.1). Each background aggregate (a full tier grading, a pass of the grade
 * queue, a guild totals pass, a guild badges pass, a distribution build, the daily pin ranks) runs through heavy(), and
 * at most `db.heavyConcurrent` (admin setting, default 2) run at once; the rest wait their turn in the order they
 * asked. Each job still runs one copy of itself at a time (its own `running` guard), so the line is never longer than
 * the number of jobs.
 *
 * Why: the worker's pool is shared with the crawler, which writes what it fetched in short transactions. Before this,
 * four slow aggregates could hold every connection and the crawl waited on its own bookkeeping.
 */
export function createHeavy({ limitOf }) {
  let active = 0;
  const waiting = [];
  const pump = async () => {
    if (!waiting.length) return;
    let limit = 2;
    try {
      limit = Math.max(1, Number(await limitOf()) || 2);
    } catch {
      // the setting couldn't be read just now: the default stands
    }
    while (waiting.length && active < limit) {
      const next = waiting.shift();
      active += 1;
      next.fn().then(next.resolve, next.reject).finally(() => {
        active -= 1;
        pump();
      });
    }
  };
  const heavy = (fn) => new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    pump();
  });
  heavy.state = () => ({ active, waiting: waiting.length });
  return heavy;
}
