import express from 'express';
import { route } from '../core/errors.js';
import { PRIMARY_VERSION, publicVersions } from '../core/gameVersions.js';
import { groupsView, setGroupChoice } from '../tiers/groups.js';

/**
 * 0.10.0: tier decisions by GROUP on the Discovery page (tiers/groups.js). Behind the admin 404 gate like the rest of
 * /api/admin. Every version is listed (disabled ones too: their groups are decided before they open).
 *   GET  /discovery/groups?version=      the groups, choices, exceptions and (other versions) Forever's choice as a suggestion
 *   POST /discovery/groups               { version, group, choice: 'counts' | 'category' | 'none' | 'cleared', reasoning }
 */
export function createGroupRouter({ db, writes }) {
  const r = express.Router();
  r.get('/discovery/groups', route(async (req, res) => {
    const version = String(req.query.version ?? req.query.v ?? PRIMARY_VERSION.id); // 0.10.3: ?v= from the version switcher too
    res.json({ versions: publicVersions(), ...(await groupsView(db, version)) });
  }));
  r.post('/discovery/groups', writes, route(async (req, res) => {
    const { version, group, choice, reasoning } = req.body ?? {};
    await setGroupChoice(db, { version: String(version ?? ''), group, choice: String(choice ?? ''), reasoning: String(reasoning ?? '') });
    res.json(await groupsView(db, String(version)));
  }));
  return r;
}
