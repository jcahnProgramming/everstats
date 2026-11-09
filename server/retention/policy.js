import { getSetting } from '../admin/settings.js';

/**
 * Blizzard's 30-day rule, as one number (CLAUDE.md "Retention"). Blizzard Developer API Terms of Use, section 2:
 * "You must implement a maximum 30-day TTL (time-to-live) policy for all Data obtained through our APIs."
 *
 *   window       admin setting retention.window: 30 days. Above MAX_WITHOUT_PERMISSION only with a written-permission
 *                note from Blizzard (logged). The setting can't be raised any other way.
 *   SAFETY_DAYS  slack for a sweep that runs late (it runs hourly, in both the web app and the worker).
 *   keep = window − SAFETY_DAYS = 29 days: the age past which the database deletes Blizzard data.
 *
 * 0.5.0: backups hold NO Blizzard data any more (core/backup.js dumps only Everstats' own tables, plus stubs of the
 * mixed ones), so they no longer eat into the window (0.4.2 kept 26 days because a dump could carry data 3 days
 * older). Worst case, the oldest Blizzard byte anywhere: 29 days + up to 1 hour (the sweep interval) ≈ 29 days 1 hour,
 * leaving ~23 hours for a stalled sweep.
 *
 * Backups are Everstats' own data, so they follow our own rule: the newest BACKUP_KEEP_NIGHTLY nightly dumps, plus the
 * first of each month, kept indefinitely. Dumps made before 0.5.0 (everstats-YYYY-MM-DD.dump) DO hold Blizzard data:
 * they are still deleted LEGACY_BACKUP_KEEP_DAYS after they were taken.
 */
export const MAX_WITHOUT_PERMISSION = 30;
export const SAFETY_DAYS = 1;
export const BACKUP_KEEP_NIGHTLY = 14;
export const LEGACY_BACKUP_KEEP_DAYS = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

export async function retentionPolicy(db, now = Date.now()) {
  const setting = await getSetting(db, 'retention.window');
  const windowDays = setting.days;
  const keepDays = keepDaysFor(windowDays);
  return {
    windowDays,
    keepDays,
    safetyDays: SAFETY_DAYS,
    backups: { nightly: BACKUP_KEEP_NIGHTLY, monthly: true, blizzardData: false, legacyKeepDays: LEGACY_BACKUP_KEEP_DAYS },
    permission: setting.note ?? null,
    cutoff: new Date(now - keepDays * DAY_MS),
  };
}

/** The keep-days for a window, without a database (the client shows "Last N days" from the API, never from this). */
export const keepDaysFor = (windowDays) => windowDays - SAFETY_DAYS;
