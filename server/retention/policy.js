import { getSetting } from '../admin/settings.js';

/**
 * Blizzard's 30-day rule, as one number (CLAUDE.md "Retention"). Blizzard Developer API Terms of Use, section 2:
 * "You must implement a maximum 30-day TTL (time-to-live) policy for all Data obtained through our APIs."
 *
 *   window           admin setting retention.window: 30 days. Above MAX_WITHOUT_PERMISSION only with a written-
 *                    permission note from Blizzard (logged). The setting can't be raised any other way.
 *   BACKUP_KEEP_DAYS nightly pg_dumps hold every Blizzard row as it was that night, so a dump kept 3 days carries data
 *                    up to 3 days older than the database's oldest.
 *   SAFETY_DAYS      slack for a sweep that runs late (it runs hourly, in both the web app and the worker).
 *   keep = window − BACKUP_KEEP_DAYS − SAFETY_DAYS = 26 days: the age past which the database deletes Blizzard data.
 *
 * Worst case, the oldest Blizzard byte anywhere: 26 days (database) + up to 1 hour (sweep interval) in a dump that is
 * deleted within 3 days + 1 hour of being taken ≈ 29 days 2 hours, leaving ~22 hours for a stalled sweep.
 */
export const MAX_WITHOUT_PERMISSION = 30;
export const BACKUP_KEEP_DAYS = 3;
export const SAFETY_DAYS = 1;
export const DAY_MS = 24 * 60 * 60 * 1000;

export async function retentionPolicy(db, now = Date.now()) {
  const setting = await getSetting(db, 'retention.window');
  const windowDays = setting.days;
  const keepDays = windowDays - BACKUP_KEEP_DAYS - SAFETY_DAYS;
  return {
    windowDays,
    keepDays,
    backupKeepDays: BACKUP_KEEP_DAYS,
    safetyDays: SAFETY_DAYS,
    permission: setting.note ?? null,
    cutoff: new Date(now - keepDays * DAY_MS),
  };
}

/** The keep-days for a window, without a database (the client shows "Last N days" from the API, never from this). */
export const keepDaysFor = (windowDays) => windowDays - BACKUP_KEEP_DAYS - SAFETY_DAYS;
