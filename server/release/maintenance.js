import express from 'express';
import { route } from '../core/errors.js';
import { getSetting } from '../admin/settings.js';

/**
 * The maintenance banner (0.10.3): an optional notice for players, OFF by default. The admin edits it on Release tools
 * (setting 'maintenance.banner': null, or { text, start, end } with ISO times or null; validated and logged by
 * admin/settings.js). Players get it from GET /api/maintenance, only while now is inside start..end, and nothing else:
 * no account, no per-visitor data, the same answer for everyone (so it is safe for any cache; /api is no-store anyway).
 */
export function bannerLive(value, now = Date.now()) {
  if (!value || typeof value.text !== 'string') return false;
  if (value.start && now < Date.parse(value.start)) return false;
  if (value.end && now >= Date.parse(value.end)) return false;
  return true;
}

export async function liveBanner(db, now = Date.now()) {
  const value = await getSetting(db, 'maintenance.banner');
  return bannerLive(value, now) ? { text: value.text, start: value.start ?? null, end: value.end ?? null } : null;
}

/** Public: GET /api/maintenance → { banner: { text, start, end } | null }. Mounted under /api by server/app.js. */
export function createMaintenanceRouter({ db, now = Date.now }) {
  const r = express.Router();
  r.get('/maintenance', route(async (req, res) => {
    res.json({ banner: await liveBanner(db, now()) });
  }));
  return r;
}
