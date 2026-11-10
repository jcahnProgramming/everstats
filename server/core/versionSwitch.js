import { setSwitchedOnVersions, switchableVersions } from './gameVersions.js';

/**
 * Which switchable game versions are ON (0.11.1). The registry (core/gameVersions.js) says which versions are built
 * (`switchable`); the admin switches each on or off at Features, stored as the boolean admin setting `versions.{id}`
 * (default off: production stays as it is until the owner turns one on; dev is turned on by hand).
 *
 * `isVersionEnabled()` is synchronous and asked everywhere (the queue, the crawler, the gates), so each process keeps
 * the answer in memory: the web app refreshes it before a request is routed when it is older than MAX_AGE_MS, the
 * worker before each job tick and the crawler with its settings. The process that changes a switch refreshes at once
 * (features/registry.js); the other follows within MAX_AGE_MS.
 */
export const MAX_AGE_MS = 5000;
export const versionSettingKey = (id) => `versions.${id}`;

const last = new WeakMap(); // db → time of the last refresh

export async function refreshVersionSwitches(db, { force = false, now = Date.now } = {}) {
  if (!force && last.has(db) && now() - last.get(db) < MAX_AGE_MS) return;
  last.set(db, now());
  const { getSetting } = await import('../admin/settings.js');
  const on = [];
  for (const v of switchableVersions()) if (await getSetting(db, versionSettingKey(v.id))) on.push(v.id);
  setSwitchedOnVersions(on);
}

/** Express middleware: the switches are fresh before anything asks which versions are on. A failure keeps the old answer. */
export const versionSwitchMiddleware = (db) => (req, res, next) => {
  refreshVersionSwitches(db).then(() => next(), () => next());
};
