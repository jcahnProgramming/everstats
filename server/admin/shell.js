import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { ENVIRONMENT } from '../core/environment.js';
import { GAME_VERSIONS, REGIONS, PRIMARY_VERSION, isRegionEnabled, isVersionEnabled } from '../core/gameVersions.js';
import { listSettings } from './settings.js';
import { FEATURES, featuresHere, listFeatures, setFeature, switchSetting } from '../features/registry.js';
import { AUDIT_AREAS, auditPage, auditSearch } from '../audit/log.js';
import { STALE_MS } from './crawler.js';
import { retentionPolicy } from '../retention/policy.js';
import { OLDEST } from '../retention/registry.js';

/**
 * The admin shell's own API (0.10.3, design/v5-admin): what the sidebar, top bar and every page share.
 *
 *   GET  /shell            nav counts (the four badge strengths), versions + regions for the switcher, the admin's prefs
 *   PUT  /prefs/:key       an admin preference (dashboard layout, auto-refresh, sidebar), from PREFS only
 *   GET  /search?q=        settings search: settings, feature switches and the audit log, each with its path and value
 *   GET  /audit            the Audit log (audit/log.js)
 *   GET  /features         the Features page;  PUT /features/:id { on, reason, confirmDependents }
 *
 * Behind the admin gate (routes.js): a plain 404 without an admin session.
 */
export const PREFS = Object.freeze({
  'refresh.auto': (v) => [0, 30, 60, 300].includes(v),
  'shell.collapsed': (v) => typeof v === 'boolean',
  'dashboard.order': (v) => Array.isArray(v) && v.length <= 40 && v.every((x) => typeof x === 'string' && /^[a-z-]{1,40}$/.test(x)),
  'dashboard.hidden': (v) => Array.isArray(v) && v.length <= 40 && v.every((x) => typeof x === 'string' && /^[a-z-]{1,40}$/.test(x)),
});

export async function readPrefs(db) {
  const rows = await db.query('SELECT key, value FROM admin_prefs WHERE key = ANY($1::text[]) LIMIT 40', [Object.keys(PREFS)]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** The sidebar's count badges. Each is a real count; a source that fails says null (no badge), never 0. */
export async function navCounts(db) {
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const inbox = await safe(async () => (await db.one(
    `SELECT (SELECT count(*)::int FROM feedback_threads WHERE state = 'unread')
          + (SELECT count(*)::int FROM reports WHERE state = 'open')
          + (SELECT count(*)::int FROM guild_link_reports WHERE state = 'open') AS n`)).n);
  // Pending approvals: statistics of an enabled version whose newest category decision is missing or cleared.
  const discovery = await safe(async () => (await db.one(
    `SELECT count(*)::int AS n FROM statistics s
      WHERE s.game_version = ANY($1::text[]) AND s.derived IS NULL
        AND coalesce((SELECT d.decision FROM discovery_decisions d WHERE d.statistic_id = s.id AND d.kind = 'category'
                       ORDER BY d.decided_at DESC, d.id DESC LIMIT 1), 'cleared') = 'cleared'`,
    [GAME_VERSIONS.filter((v) => isVersionEnabled(v.id)).map((v) => v.id)])).n);
  const data = await safe(async () => {
    const w = await db.one('SELECT jobs, extract(epoch FROM (now() - last_tick_at)) * 1000 AS age_ms FROM worker_status ORDER BY last_tick_at DESC LIMIT 1');
    const failedJobs = w ? (w.jobs ?? []).filter((j) => j.lastOutcome === 'failed').length + (Number(w.age_ms) > STALE_MS ? 1 : 0) : 0;
    // Failed catalogs, and stuck ones (queued or building with no crawl item left to carry the chain), as Data › Collections shows.
    const catalogs = (await db.one(
      `SELECT count(*)::int AS n FROM collection_catalog_state s
        WHERE s.state = 'failed'
           OR (s.state IN ('queued', 'building') AND NOT EXISTS (
                SELECT 1 FROM crawl_queue q WHERE q.kind = 'catalog' AND q.key LIKE 'catalog:' || s.kind || ':%' AND q.state IN ('queued', 'running')))`,
    )).n;
    const backup = await db.one("SELECT outcome FROM backup_runs WHERE outcome <> 'running' ORDER BY started_at DESC LIMIT 1");
    return failedJobs + catalogs + (backup?.outcome === 'failed' ? 1 : 0);
  });
  const retention = await safe(async () => {
    const policy = await retentionPolicy(db);
    let outside = 0;
    for (const [, sql] of OLDEST) {
      const t = (await db.one(sql))?.t;
      if (t && Date.now() - new Date(t).getTime() > policy.windowDays * 86_400_000) outside += 1;
    }
    return outside;
  });
  return {
    inbox: { n: inbox, tone: 'accent', label: 'unread or open' },
    discovery: { n: discovery, tone: 'quiet', label: 'statistics awaiting a decision' },
    data: { n: data, tone: 'warn', label: 'failed or stuck' },
    retention: { n: retention, tone: 'err', label: 'kinds of data outside the window' },
  };
}

const settingPath = (s) => {
  if (s.section === 'features') return 'Features';
  if (s.section === 'tiers') return 'Tiers › Settings';
  if (s.section === 'renders') return 'Features › Character renders';
  if (s.section === 'beta') return 'Features › Beta';
  if (s.section === 'badges' || s.section === 'guildBadges') return 'Badges';
  if (s.section === 'moderation') return 'Features › Moderator role';
  if (s.section === 'release') return 'Release tools';
  return `Settings › ${{ crawler: 'Crawler limits', grading: 'Grading', retention: 'Data retention', discovery: 'Discovery', cards: 'Share cards' }[s.section] ?? s.section}`;
};
const settingHref = (s) => {
  if (s.section === 'tiers') return `/admin/tiers#set-${s.key}`;
  if (s.section === 'badges') return '/admin/badges/player';
  if (s.section === 'guildBadges') return '/admin/badges/guild';
  if (s.section === 'release') return '/admin/release#maintenance';
  const f = FEATURES.find((x) => switchSetting(x) === s.key || (x.settings ?? []).includes(s.key));
  if (f && s.section !== 'crawler' && s.section !== 'cards') return `/admin/features#feat-${f.id}`;
  return `/admin/settings#set-${s.key}`;
};
const show = (s) => {
  const v = s.value;
  if (v === null || v === undefined) return 'Not set';
  if (s.type === 'boolean') return v ? 'On' : 'Off';
  if (s.type === 'perks') return `${v.length} perk${v.length === 1 ? '' : 's'}`;
  if (s.type === 'retention') return `${v.days} days`;
  if (s.type === 'banner') return 'On';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ').slice(0, 60);
  return String(v);
};

export async function searchAdmin(db, text) {
  const q = String(text ?? '').trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const hit = (...fields) => words.every((w) => fields.some((f) => String(f ?? '').toLowerCase().includes(w)));
  const out = [];
  const features = await listFeatures(db);
  for (const f of features) {
    if (hit(f.name, f.does, f.id)) out.push({ kind: 'feature', id: f.id, label: f.name, path: 'Features', value: f.on ? 'On' : 'Off', href: `/admin/features#feat-${f.id}` });
  }
  const settings = await listSettings(db);
  for (const s of settings) {
    if (s.section === 'features') continue; // shown as its feature above
    if (hit(s.label, s.help, s.key)) out.push({ kind: 'setting', id: s.key, label: s.label, path: settingPath(s), value: show(s), href: settingHref(s) });
  }
  for (const e of await auditSearch(db, q, { limit: 5 })) {
    out.push({ kind: 'audit', id: e.id, label: e.action, path: `Audit log · ${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`, value: e.actor.label, href: `/admin/audit?q=${encodeURIComponent(q)}#audit-${e.id.replace(':', '-')}` });
  }
  return out.slice(0, 20);
}

export function createAdminShellRouter({ db, writes }) {
  const r = express.Router();

  r.get('/shell', route(async (req, res) => {
    res.json({
      environment: ENVIRONMENT,
      versions: GAME_VERSIONS.map((v) => ({ id: v.id, name: v.name, short: v.short ?? v.name, primary: Boolean(v.primary), enabled: isVersionEnabled(v.id) })),
      regions: REGIONS.map((g) => ({ id: g.id, name: g.name ?? g.id.toUpperCase(), enabled: isRegionEnabled(g.id) })),
      primary: PRIMARY_VERSION.id,
      primaryRegion: REGIONS.find((g) => isRegionEnabled(g.id))?.id ?? REGIONS[0].id,
      counts: await navCounts(db),
      prefs: await readPrefs(db),
    });
  }));

  r.get('/shell/counts', route(async (req, res) => res.json({ counts: await navCounts(db) })));

  r.put('/prefs/:key', writes, route(async (req, res) => {
    const check = PREFS[req.params.key];
    if (!check) throw new HttpError(404, 'Unknown preference');
    const value = req.body?.value;
    if (!check(value)) throw new HttpError(400, 'That value isn’t allowed here', 'invalid');
    await db.query(
      `INSERT INTO admin_prefs (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [req.params.key, JSON.stringify(value)],
    );
    res.json({ prefs: await readPrefs(db) });
  }));

  r.get('/search', route(async (req, res) => res.json({ results: await searchAdmin(db, req.query.q) })));

  r.get('/audit', route(async (req, res) => {
    const page = await auditPage(db, {
      area: typeof req.query.area === 'string' && req.query.area ? req.query.area : null,
      q: typeof req.query.q === 'string' ? req.query.q : null,
      target: typeof req.query.target === 'string' && req.query.target ? req.query.target : null,
      cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
    });
    const since = await db.one("SELECT min(created_at) AS at FROM admin_events");
    res.json({ ...page, areas: AUDIT_AREAS, recordsSince: since?.at ?? null });
  }));

  // The filtered log as CSV, newest first, at most EXPORT_MAX rows (said in the file's last line when cut).
  r.get('/audit/export.csv', route(async (req, res) => {
    const EXPORT_MAX = 5000;
    const filters = {
      area: typeof req.query.area === 'string' && req.query.area ? req.query.area : null,
      q: typeof req.query.q === 'string' ? req.query.q : null,
      target: typeof req.query.target === 'string' && req.query.target ? req.query.target : null,
    };
    const rows = [];
    let cursor = null;
    do {
      const page = await auditPage(db, { ...filters, cursor, limit: 100 });
      rows.push(...page.entries);
      cursor = page.next;
    } while (cursor && rows.length < EXPORT_MAX);
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['when_utc', 'who', 'area', 'action', 'target', 'before', 'after', 'reason'].join(',')];
    for (const e of rows.slice(0, EXPORT_MAX)) {
      lines.push([new Date(e.at).toISOString(), e.actor.label, e.area, e.action, e.target ? `${e.target.kind}:${e.target.id ?? ''}` : '',
        e.beforeRecorded ? e.before : 'not recorded', e.after, e.reason].map(cell).join(','));
    }
    if (cursor) lines.push(`# cut at ${EXPORT_MAX} rows; narrow the filter for older entries`);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="everstats-audit.csv"');
    res.send(`${lines.join('\n')}\n`);
  }));

  r.get('/features', route(async (req, res) => {
    res.json({ features: await listFeatures(db), settings: (await listSettings(db)).filter((s) => featuresHere().some((f) => (f.settings ?? []).includes(s.key))) });
  }));

  r.put('/features/:id', writes, route(async (req, res) => {
    try {
      res.json({ features: await setFeature(db, req.params.id, req.body?.on, { reason: req.body?.reason, confirmDependents: req.body?.confirmDependents === true }) });
    } catch (err) {
      if (err.code === 'has_dependents') return res.status(409).json({ error: err.message, code: err.code, affected: err.affected });
      throw err;
    }
  }));

  return r;
}
