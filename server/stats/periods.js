/**
 * Leaderboard periods (shared with the client, which imports this file). The period boards rank what a character
 * GAINED, from a baseline snapshot to its current value.
 *
 *   week     from Blizzard's US weekly reset: Tuesday 15:00 UTC (checked 2026-11-08; pinned to UTC, so 08:00 Pacific in
 *            summer, 07:00 in winter). Baseline: the character's first snapshot this week.
 *   rolling  0.4.2: replaces "monthly". Blizzard's API terms allow keeping data at most 30 days, so a calendar month
 *            can't be kept whole. "Last N days": the gain since the character's OLDEST snapshot still kept, where N
 *            is the retention keep-days (retention/policy.js: 26 for a 30-day window). Its baselines and gains carry
 *            the fixed period_start ROLLING_START.
 */
export const WEEKLY_RESET = Object.freeze({ weekday: 2, hourUtc: 15 }); // 0 = Sunday … 2 = Tuesday
export const ROLLING_START = new Date(0); // the period_start every rolling row carries

/** The start of the week containing `at` (a Date or ms). */
export function periodStart(period, at = Date.now()) {
  if (period === 'rolling') return ROLLING_START;
  if (period !== 'week') throw new Error(`unknown period ${period}`);
  const t = new Date(at);
  const reset = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), WEEKLY_RESET.hourUtc));
  let back = (t.getUTCDay() - WEEKLY_RESET.weekday + 7) % 7;
  if (back === 0 && t < reset) back = 7;
  reset.setUTCDate(reset.getUTCDate() - back);
  return reset;
}

/** The start of the week after the one containing `at`. */
export function nextPeriodStart(period, at = Date.now()) {
  return new Date(periodStart(period, at).getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Whether the weekly board is open: only when snapshots were already being taken when the week began, so every gain on
 * it is measured from inside the week. `firstSnapshotAt` null (no snapshot yet) → closed.
 *   → { open, opensAt }
 */
export function periodOpen(period, firstSnapshotAt, at = Date.now()) {
  if (!firstSnapshotAt) return { open: false, opensAt: null };
  const first = new Date(firstSnapshotAt);
  const firstFull = periodStart(period, first).getTime() === first.getTime() ? first : nextPeriodStart(period, first);
  return { open: periodStart(period, at) >= firstFull, opensAt: firstFull.toISOString() };
}

/**
 * Whether the "last N days" board is open: once snapshots have been taken for N whole days, so it never ranks a
 * shorter stretch as if it were N days. → { open, opensAt, days }
 */
export function rollingOpen(firstSnapshotAt, keepDays, at = Date.now()) {
  if (!firstSnapshotAt) return { open: false, opensAt: null, days: keepDays };
  const opens = new Date(new Date(firstSnapshotAt).getTime() + keepDays * 24 * 60 * 60 * 1000);
  return { open: at >= opens.getTime(), opensAt: opens.toISOString(), days: keepDays };
}

/** The UTC calendar day of a moment, 'YYYY-MM-DD': one snapshot per character per day. */
export const utcDay = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
