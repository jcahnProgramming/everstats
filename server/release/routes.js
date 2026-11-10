import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { pageLimit } from '../core/db.js';
import { PRIMARY_VERSION } from '../core/gameVersions.js';
import { getSetting } from '../admin/settings.js';
import { PRIMARY_REGION, checkScope, compareSnapshots, getSnapshot, listSnapshots, takeSnapshot } from './snapshot.js';
import { crawlState, requestRegrade, setCrawl, tiersState, versionCheck } from './ops.js';
import { doStep, finishRun, getRun, listRuns, startRun } from './runs.js';
import { bannerLive } from './maintenance.js';

/**
 * 0.10.3: Release tools, under /api/admin/release (behind the admin gate: a plain 404 without an admin session).
 * Everything a deploy needs, so nothing needs a terminal: pause / resume the crawl, regrade tiers, snapshots and
 * compare, the guided Before / After checklist, and the maintenance banner's current state (it is saved through the
 * settings route, PUT /api/admin/settings/maintenance.banner, which validates and logs it).
 *
 *   GET  /release/crawl                    the Background crawl switch (the Features page's), with its last change
 *   POST /release/crawl        { on, reason }
 *   GET  /release/live                     web version vs CHANGELOG's newest vs the worker's
 *   GET  /release/tiers?v&r[&run]          a regrade in flight / asked about, the last full grading, what is stored
 *   POST /release/tiers        { version, region }
 *   GET  /release/snapshots?v&r[&before&limit]
 *   POST /release/snapshots    { label, version, region }
 *   GET  /release/snapshots/:id            one, with its data (null once aged out)
 *   POST /release/compare      { a, b }
 *   GET  /release/runs                     the open checklist + the ten most recent closed ones
 *   POST /release/runs         { kind, label, version, region }
 *   GET  /release/runs/:id
 *   POST /release/runs/:id/steps/:step { reason? }
 *   POST /release/runs/:id/finish { abandoned }
 *   GET  /release/banner                   the stored banner and whether players see it now
 */
const scopeOf = (src) => checkScope(typeof src.v === 'string' ? src.v : typeof src.version === 'string' ? src.version : PRIMARY_VERSION.id,
  typeof src.r === 'string' ? src.r : typeof src.region === 'string' ? src.region : PRIMARY_REGION);

export function createAdminReleaseRouter({ db, writes }) {
  const r = express.Router();

  r.get('/release/crawl', route(async (req, res) => res.json({ crawl: await crawlState(db) })));
  r.post('/release/crawl', writes, route(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'Pause or resume?', 'invalid');
    res.json({ crawl: await setCrawl(db, req.body.on, { reason: req.body?.reason ?? '' }) });
  }));

  r.get('/release/live', route(async (req, res) => res.json({ live: await versionCheck(db) })));

  r.get('/release/tiers', route(async (req, res) => {
    const { version, region } = scopeOf(req.query);
    res.json({ tiers: await tiersState(db, { version, region, runId: typeof req.query.run === 'string' ? req.query.run : null }) });
  }));
  r.post('/release/tiers', writes, route(async (req, res) => {
    const { version, region } = scopeOf(req.body ?? {});
    const id = await requestRegrade(db, { version, region });
    res.json({ tiers: await tiersState(db, { version, region, runId: id }) });
  }));

  r.get('/release/snapshots', route(async (req, res) => {
    const { version, region } = scopeOf(req.query);
    const before = typeof req.query.before === 'string' && /^[0-9]{1,18}$/.test(req.query.before) ? req.query.before : null;
    res.json(await listSnapshots(db, { version, region, before, limit: pageLimit(req.query.limit, { fallback: 20, max: 50 }) }));
  }));
  r.post('/release/snapshots', writes, route(async (req, res) => {
    const { version, region } = scopeOf(req.body ?? {});
    res.json({ snapshot: await takeSnapshot(db, { label: req.body?.label, version, region }) });
  }));
  r.get('/release/snapshots/:id', route(async (req, res) => res.json({ snapshot: await getSnapshot(db, req.params.id) })));
  r.post('/release/compare', writes, route(async (req, res) => {
    res.json({ compare: await compareSnapshots(db, String(req.body?.a ?? ''), String(req.body?.b ?? '')) });
  }));

  r.get('/release/runs', route(async (req, res) => res.json(await listRuns(db))));
  r.post('/release/runs', writes, route(async (req, res) => {
    const { version, region } = scopeOf(req.body ?? {});
    res.json({ run: await startRun(db, { kind: req.body?.kind, label: req.body?.label, version, region }) });
  }));
  r.get('/release/runs/:id', route(async (req, res) => res.json({ run: await getRun(db, req.params.id) })));
  r.post('/release/runs/:id/steps/:step', writes, route(async (req, res) => {
    res.json({ run: await doStep(db, req.params.id, req.params.step, req.body ?? {}) });
  }));
  r.post('/release/runs/:id/finish', writes, route(async (req, res) => {
    res.json({ run: await finishRun(db, req.params.id, { abandoned: req.body?.abandoned === true }) });
  }));

  r.get('/release/banner', route(async (req, res) => {
    const value = await getSetting(db, 'maintenance.banner');
    const change = await db.one(
      "SELECT created_at, detail->>'reason' AS reason FROM admin_events WHERE type = 'setting.changed' AND detail->>'key' = 'maintenance.banner' ORDER BY created_at DESC LIMIT 1",
    );
    res.json({ banner: { value, live: bannerLive(value), changedAt: change?.created_at ?? null, reason: change?.reason ?? null } });
  }));

  return r;
}
