/**
 * Leaderboard periods (shared with the client, which imports this file). Weekly and monthly boards rank what a
 * character GAINED during the period, from its first snapshot in the period to its current value.
 *
 *   week   from Blizzard's US weekly reset: Tuesday 15:00 UTC. Checked 2026-11-08 (siliconera / wowvendor reset guides,
 *          updated 2026: "US, Latin and Oceanic realms: Tuesday at 15:00 UTC"; it is 08:00 Pacific in summer and
 *          07:00 in winter, because the reset is pinned to UTC, not to Pacific time). Blizzard publishes no
 *          Forever-specific reset, so Forever is assumed to share the US one. If it ever differs, change these two
 *          constants: nothing else knows the time.
 *   month  the calendar month in UTC, the same time zone as the weekly reset: from 00:00 UTC on the 1st.
 */
export const WEEKLY_RESET = Object.freeze({ weekday: 2, hourUtc: 15 }); // 0 = Sunday … 2 = Tuesday
export const PERIODS = Object.freeze(['week', 'month']);

/** The start of the period containing `at` (a Date or ms). */
export function periodStart(period, at = Date.now()) {
  const t = new Date(at);
  if (period === 'month') return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  if (period !== 'week') throw new Error(`unknown period ${period}`);
  const reset = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), WEEKLY_RESET.hourUtc));
  let back = (t.getUTCDay() - WEEKLY_RESET.weekday + 7) % 7;
  if (back === 0 && t < reset) back = 7;
  reset.setUTCDate(reset.getUTCDate() - back);
  return reset;
}

/** The start of the period after the one containing `at`. */
export function nextPeriodStart(period, at = Date.now()) {
  const s = periodStart(period, at);
  if (period === 'month') return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
  return new Date(s.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Whether a period's board is open: only when snapshots were already being taken when the period began, so every
 * gain on it is measured from inside the period. Before that it is "Collecting data". `firstSnapshotAt` null (no
 * snapshot yet) → closed.
 *   → { open, opensAt }   opensAt: when the first full period starts (the board opens then)
 */
export function periodOpen(period, firstSnapshotAt, at = Date.now()) {
  if (!firstSnapshotAt) return { open: false, opensAt: null };
  const first = new Date(firstSnapshotAt);
  const firstFull = periodStart(period, first).getTime() === first.getTime() ? first : nextPeriodStart(period, first);
  return { open: periodStart(period, at) >= firstFull, opensAt: firstFull.toISOString() };
}

/** The UTC calendar day of a moment, 'YYYY-MM-DD': one snapshot per character per day. */
export const utcDay = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
