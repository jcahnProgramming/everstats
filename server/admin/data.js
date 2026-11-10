import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { pageLimit } from '../core/db.js';
import { PRIMARY_SCOPE, scopeSql } from '../core/config.js';
import { GAME_VERSIONS, PRIMARY_VERSION, isRegionEnabled, isVersionEnabled, regionById, versionById } from '../core/gameVersions.js';
import { ENVIRONMENT } from '../core/environment.js';
import { crawlerStatus, STALE_MS } from './crawler.js';
import { getSetting, listSettings } from './settings.js';
import { PRIORITY_VALUES } from '../crawler/queue.js';
import { backupStatus, keepReasons } from '../core/backup.js';
import { listPublic, removeCredential, saveCredential } from '../credentials/store.js';
import { trustedProxyCheck, trustedProxyEntries } from '../core/network.js';
import { BLIZZARD, OURS } from '../retention/registry.js';
import { retentionStatus } from '../retention/sweep.js';
import { DAY_MS, keepDaysFor } from '../retention/policy.js';

/**
 * 0.10.3: the admin's Data pages (Crawler, Collections & catalogs, Backups), Data retention and Settings
 * (design/v5-admin pages data-crawler, data-collections, data-backups, retention, settings). Behind the admin gate
 * (admin/routes.js mounts it after the gate): a plain 404 without an admin session.
 *
 *   GET  /data/crawler?v=&r=        status, the queue by priority (this version) and by version, budget use, today's counts,
 *                                   back-offs and the last error for this version, the backfill line, the switches (read only)
 *   GET  /data/jobs                 the worker's jobs (the page polls it every 5 s on its own clock)
 *   GET  /data/renderer             the share-card renderer's measured times (this web process) and the image cache
 *   GET  /data/collections?v=&r=    catalogs (state, measured cost, stuck), refresh cost, Legacy Points texts, account-wide
 *   GET  /data/backups?limit=&before=   status, the keep rule, history with why each file is kept (paged)
 *   GET  /data/retention?v=&r=      the rule, status (all versions), per kind of Blizzard data: rows, oldest, expiry buckets
 *   GET  /data/retention/sweeps?limit=&before=   sweep history, paged
 *   GET  /data/settings             every setting with its default, plus the game versions (for budget shares)
 *   GET  /data/keys                 API keys: state, source, date. NEVER a value, not even a last four
 *   PUT  /data/keys/:id             save / replace a key ({ ...fields, reason? })
 *   POST /data/keys/:id/remove      remove a stored key ({ reason }, required)
 *   GET  /data/proxies              TRUSTED_PROXIES, the check, and where CF-Connecting-IP arrived from
 *
 * Nothing here is estimated unless it says so; a number we can't measure is null ("not measured").
 */
const COUNT_TIMEOUT_MS = 10_000;
// The per-kind counts read every Blizzard table (one query each). Kept for a minute per scope, and one count at a time
// per scope, so auto-refresh and a second tab don't repeat the work; the page says when they were counted.
const COUNT_MEMO_MS = 60_000;
const countMemo = new Map(); // scope key → { at, promise }

function scopeOf(req) {
  const v = versionById(req.query.v ?? PRIMARY_SCOPE.version);
  const r = regionById(req.query.r ?? PRIMARY_SCOPE.region);
  if (!v || !r) throw new HttpError(400, 'Unknown game version or region', 'invalid');
  return {
    version: v.id, region: r.id, name: v.name, regionName: r.name,
    enabled: isVersionEnabled(v.id) && isRegionEnabled(r.id),
    primary: v.id === PRIMARY_SCOPE.version && r.id === PRIMARY_SCOPE.region,
  };
}

const iso = (t) => (t ? new Date(t).toISOString() : null);
const num = (x) => (x === null || x === undefined ? null : Number(x));

// ---------------------------------------------------------------------------------------------------------------
// Retention: every kind of stored Blizzard data, how to read its "fetched" time and how to scope it to one version
// and region. Every BLIZZARD table in retention/registry.js must appear here (server/test/admin-data.test.js checks).
//   at     SQL for the time the sweep compares with the cutoff (null: the row follows something else; counted only)
//   from   FROM … (alias t), with the joins the scope needs
//   scope  'char' (c.game_version/c.region via characters c), 'guild' (g), 'own' (t has both columns), 'run' (runs r),
//          'ruleset' (r), 'fetch' (f), 'snap' (s), 'version' (t.game_version only: every region), null (all versions)
//   where  extra condition: only rows the sweep actually ages by `at`
// ---------------------------------------------------------------------------------------------------------------
export const RETENTION_KINDS = [
  { id: 'characters', table: 'characters', label: 'Character profiles', at: 't.data_fetched_at', from: 'characters t', scope: 'self', where: "t.profile_state <> 'purged'", note: 'Past the window the row becomes a stub of our own data (id, owner, hidden).' },
  { id: 'characters-renders', table: 'characters', label: 'Character renders', at: 't.media_fetched_at', from: 'characters t', scope: 'self', where: 't.media IS NOT NULL' },
  { id: 'characters-gear', table: 'characters', label: 'Equipment and attributes', at: 't.last_fetched_at', from: 'characters t', scope: 'self', where: '(t.equipment IS NOT NULL OR t.attributes IS NOT NULL)' },
  { id: 'character_statistics', table: 'character_statistics', label: 'Statistic values', at: 't.fetched_at', from: 'character_statistics t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'character_snapshots', table: 'character_snapshots', label: 'Daily statistics snapshots', at: 't.taken_at', from: 'character_snapshots t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'period_baselines', table: 'period_baselines', label: 'Weekly and rolling baselines', at: 't.taken_at', from: 'period_baselines t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'stat_gains', table: 'stat_gains', label: 'Gains (weekly and rolling boards)', at: "CASE WHEN t.period = 'week' THEN t.period_start END", from: 'stat_gains t JOIN characters c ON c.id = t.character_id', scope: 'char', note: 'Rolling gains go with their baseline.' },
  { id: 'pin_rank_history', table: 'pin_rank_history', label: 'Pinned statistic rank history', at: "(t.day::timestamp AT TIME ZONE 'UTC')", from: 'pin_rank_history t JOIN characters c ON c.id = t.character_id', scope: 'char', note: 'Dated by UTC day.' },
  { id: 'character_tiers', table: 'character_tiers', label: 'Overall tiers', at: 't.computed_at', from: 'character_tiers t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'character_category_tiers', table: 'character_category_tiers', label: 'Category tiers', at: 't.computed_at', from: 'character_category_tiers t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'tier_rulesets', table: 'tier_rulesets', label: 'Tier cutoffs per ruleset', at: 't.computed_at', from: 'tier_rulesets t JOIN rulesets r ON r.id = t.ruleset_id', scope: 'ruleset' },
  { id: 'character_collections', table: 'character_collections', label: 'Collections', at: 'coalesce(t.data_fetched_at, t.checked_at)', from: 'character_collections t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'character_gold', table: 'character_gold', label: 'Opt-in gold', at: 't.fetched_at', from: 'character_gold t JOIN characters c ON c.id = t.character_id', scope: 'char' },
  { id: 'collection_sharing', table: 'collection_sharing', label: 'Account-wide detection', at: 't.computed_at', from: 'collection_sharing t', scope: null },
  { id: 'collection_catalog', table: 'collection_catalog', label: 'Static catalogs', at: 't.fetched_at', from: 'collection_catalog t', scope: 'own' },
  { id: 'collection_catalog_state', table: 'collection_catalog_state', label: 'Catalog build state', at: 'coalesce(t.fetched_at, t.started_at)', from: 'collection_catalog_state t', scope: 'own' },
  { id: 'item_media', table: 'item_media', label: 'Item icons', at: 't.fetched_at', from: 'item_media t', scope: 'own' },
  { id: 'share_card_images', table: 'share_card_images', label: 'Share-card images', at: 't.data_at', from: 'share_card_images t', scope: 'version', note: 'Also deleted 6 hours after they were made.' },
  { id: 'account_character_checks', table: 'account_character_checks', label: 'Battle.net character list checks', at: 't.checked_at', from: 'account_character_checks t', scope: null },
  { id: 'crawl_queue', table: 'crawl_queue', label: 'Crawl work items', at: 't.enqueued_at', from: 'crawl_queue t', scope: 'own', where: "t.state <> 'running'", note: 'Finished items are deleted an hour after they finish.' },
  { id: 'guild_fetch_members', table: 'guild_fetch_members', label: 'Guild fetch work lists', at: 't.listed_at', from: 'guild_fetch_members t JOIN guild_fetches f ON f.id = t.fetch_id', scope: 'fetch' },
  { id: 'guild_fetches', table: 'guild_fetches', label: 'Guild fetches', at: 't.requested_at', from: 'guild_fetches t', scope: 'own', where: "t.state NOT IN ('queued', 'running')" },
  { id: 'guilds', table: 'guilds', label: 'Guilds', at: 't.updated_at', from: 'guilds t', scope: 'self' },
  { id: 'guilds-profiles', table: 'guilds', label: 'Guild profiles (member count, created date)', at: 't.profile_fetched_at', from: 'guilds t', scope: 'self', where: 't.profile_fetched_at IS NOT NULL' },
  { id: 'guild_roster', table: 'guild_roster', label: 'Guild rosters', at: 't.fetched_at', from: 'guild_roster t JOIN guilds g ON g.id = t.guild_id', scope: 'guild' },
  { id: 'guild_slugs', table: 'guild_slugs', label: 'Guild addresses (for renames)', at: 't.seen_at', from: 'guild_slugs t JOIN guilds g ON g.id = t.guild_id', scope: 'guild' },
  { id: 'guild_totals', table: 'guild_totals', label: 'Guild totals', at: 't.computed_at', from: 'guild_totals t JOIN guilds g ON g.id = t.guild_id', scope: 'guild' },
  { id: 'guild_populations', table: 'guild_populations', label: 'Guild member counts per period', at: 't.computed_at', from: 'guild_populations t JOIN guilds g ON g.id = t.guild_id', scope: 'guild' },
  { id: 'realms', table: 'realms', label: 'Realms', at: 't.fetched_at', from: 'realms t', scope: 'own' },
  { id: 'rulesets', table: 'rulesets', label: 'Rulesets and realm types', at: 't.updated_at', from: 'rulesets t', scope: 'self', note: 'Kept while a character, guild or realm still names it.' },
  { id: 'statistics', table: 'statistics', label: 'Statistic names', at: 't.last_seen_at', from: 'statistics t', scope: 'version', where: "t.name IS NOT NULL AND (t.derived IS NULL OR t.derived LIKE '%:%')", note: 'Past the window the name is cleared; the id and decisions are ours and stay.' },
  { id: 'discovery_runs', table: 'discovery_runs', label: 'Discovery runs', at: 't.requested_at', from: 'discovery_runs t', scope: 'own' },
  { id: 'discovery_responses', table: 'discovery_responses', label: 'Discovery raw responses', at: 'r.requested_at', from: 'discovery_responses t JOIN discovery_runs r ON r.id = t.run_id', scope: 'run', note: 'Deleted with their run.' },
  { id: 'discovery_statistics', table: 'discovery_statistics', label: 'Discovery per-run catalogs', at: 'r.requested_at', from: 'discovery_statistics t JOIN discovery_runs r ON r.id = t.run_id', scope: 'run', note: 'Deleted with their run.' },
  { id: 'discovery_catalog', table: 'discovery_catalog', label: 'Discovery combined catalog', at: null, from: 'discovery_catalog t', scope: 'version', note: 'Rebuilt from the runs that remain.' },
  { id: 'discovery_combined', table: 'discovery_combined', label: 'Discovery combined summary', at: null, from: 'discovery_combined t', scope: null, note: 'Rebuilt from the runs that remain.' },
  { id: 'discovery_decisions', table: 'discovery_decisions', label: 'Quoted names in Discovery reasoning', at: 't.decided_at', from: 'discovery_decisions t', scope: 'version', where: "t.reasoning <> ''", note: 'Only the quoted text is blanked; the decision is ours and stays.' },
  { id: 'release_snapshot_data', table: 'release_snapshot_data', label: 'Release tools snapshots', at: 't.taken_at', from: 'release_snapshot_data t JOIN release_snapshots s ON s.id = t.snapshot_id', scope: 'snap' },
];

const SCOPE_ALIAS = { self: 't', own: 't', char: 'c', guild: 'g', run: 'r', ruleset: 'r', fetch: 'f', snap: 's' };

/** The WHERE for one kind in one scope, and how wide the count really is ('scoped' | 'version' | 'all'). */
function kindScope(kind, scope) {
  if (kind.scope === null) return { sql: 'TRUE', width: 'all' };
  if (kind.scope === 'version') {
    if (!versionById(scope.version)) throw new Error('not a registry version');
    return { sql: `t.game_version = '${scope.version}'`, width: 'version' };
  }
  return { sql: scopeSql(SCOPE_ALIAS[kind.scope], scope), width: 'scoped' };
}

/** One query per kind: rows, oldest, and how many expire in the next hour / 24 h / 7 days / the rest of the window. */
export async function retentionKinds(db, scope, { now = Date.now(), keepDays }) {
  const cutoff = new Date(now - keepDays * DAY_MS);
  const out = [];
  for (const kind of RETENTION_KINDS) {
    const { sql: scopeWhere, width } = kindScope(kind, scope);
    const where = [scopeWhere, kind.where].filter(Boolean).join(' AND ');
    const at = kind.at;
    const sql = at
      ? `SELECT count(*)::bigint AS rows, min(${at}) AS oldest,
                count(*) FILTER (WHERE ${at} < $1::timestamptz)::bigint AS overdue,
                count(*) FILTER (WHERE ${at} >= $1::timestamptz AND ${at} < $1::timestamptz + interval '1 hour')::bigint AS h1,
                count(*) FILTER (WHERE ${at} >= $1::timestamptz + interval '1 hour' AND ${at} < $1::timestamptz + interval '1 day')::bigint AS d1,
                count(*) FILTER (WHERE ${at} >= $1::timestamptz + interval '1 day' AND ${at} < $1::timestamptz + interval '7 days')::bigint AS d7,
                count(*) FILTER (WHERE ${at} >= $1::timestamptz + interval '7 days')::bigint AS rest,
                count(*) FILTER (WHERE ${at} IS NULL)::bigint AS untimed
           FROM ${kind.from} WHERE ${where}`
      : `SELECT count(*)::bigint AS rows FROM ${kind.from} WHERE ${where}`;
    const started = Date.now();
    try {
      const row = await db.tx(async (q) => {
        await q.query(`SET LOCAL statement_timeout = ${COUNT_TIMEOUT_MS}`);
        return q.one(sql, at ? [cutoff] : []);
      });
      out.push({
        id: kind.id, table: kind.table, label: kind.label, note: kind.note ?? null, width, timed: Boolean(at),
        rows: num(row.rows), oldest: iso(row.oldest),
        overdue: num(row.overdue ?? null), nextHour: num(row.h1 ?? null), next24h: num(row.d1 ?? null), next7d: num(row.d7 ?? null), rest: num(row.rest ?? null),
        untimed: num(row.untimed ?? null), ms: Date.now() - started, problem: null,
      });
    } catch (err) {
      out.push({
        id: kind.id, table: kind.table, label: kind.label, note: kind.note ?? null, width, timed: Boolean(at), rows: null, oldest: null,
        overdue: null, nextHour: null, next24h: null, next7d: null, rest: null, untimed: null, ms: Date.now() - started,
        problem: err.code === '57014' ? `Counting took longer than ${COUNT_TIMEOUT_MS / 1000} s, so it was stopped` : `Couldn’t count (${err.code ?? err.name})`,
      });
    }
  }
  return { cutoff: cutoff.toISOString(), kinds: out };
}

// ---------------------------------------------------------------------------------------------------------------

const PROC = (process) => (process === 'worker' ? 'Worker' : process === 'web' ? 'Web app' : process ?? '—');

function sweepRow(r) {
  const deleted = r.deleted ?? {};
  const total = Object.values(deleted).reduce((n, v) => n + (Number(v) || 0), 0);
  const top = Object.entries(deleted).map(([k, v]) => ({ table: k, n: Number(v) || 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const durationMs = r.finished_at ? new Date(r.finished_at) - new Date(r.started_at) : null;
  const state = r.problem ? 'problems' : r.finished_at ? 'ok' : Date.now() - new Date(r.started_at).getTime() > 30 * 60 * 1000 ? 'unfinished' : 'running';
  return { id: Number(r.id), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), process: PROC(r.process), windowDays: r.window_days, deleted: top, total, durationMs, state, problem: r.problem ?? null };
}

const DATA_KEEP_TEXT = {
  nightly: (n) => `Newest ${n} nightly`,
  monthly: () => 'First of the month',
  'nightly+monthly': (n) => `Newest ${n} nightly · first of the month`,
  legacy: (n, d) => `Pre-0.5.0 backup (holds Blizzard data): deleted ${d} days after it was taken`,
  goes: () => 'Past the keep rule: the hourly prune deletes it',
};

export function createAdminDataRouter({ db, writes, cardStats = () => null, proxies = null }) {
  const r = express.Router();

  // ---- Data › Crawler ----
  r.get('/data/crawler', route(async (req, res) => {
    const scope = scopeOf(req);
    const sq = scopeSql('', scope);
    const status = await crawlerStatus(db);
    const c = status.crawler;
    const queue = await db.query(
      `SELECT priority, count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'running')::int AS running,
              min(enqueued_at) FILTER (WHERE state = 'queued') AS oldest
         FROM crawl_queue WHERE state IN ('queued', 'running') AND ${sq} GROUP BY priority LIMIT 20`,
    );
    const byVersion = await db.query(
      `SELECT game_version, region, count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'running')::int AS running,
              count(*) FILTER (WHERE state IN ('done', 'failed') AND finished_at > now() - interval '1 hour')::int AS finished_hour,
              count(*) FILTER (WHERE state = 'failed' AND finished_at > now() - interval '1 hour')::int AS failed_hour
         FROM crawl_queue GROUP BY game_version, region ORDER BY game_version, region LIMIT 50`,
    );
    const today = await db.one(
      `SELECT count(*) FILTER (WHERE last_checked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS checked,
              count(*) FILTER (WHERE last_fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS fetched,
              count(*) FILTER (WHERE stats_fetched_at IS NOT NULL)::int AS tracked, count(*)::int AS known
         FROM characters WHERE ${sq}`,
    );
    const perSecond = await getSetting(db, 'crawler.requestsPerSecond');
    const shares = await getSetting(db, 'crawler.versionShares');
    const prefix = `${scope.version}/${scope.region}:`;
    const mine = (key) => (scope.primary ? !/^[a-z0-9-]+\/[a-z]+:/.test(String(key)) : String(key).startsWith(prefix));
    const hours24 = status.hours.reduce((a, h) => ({ requests: a.requests + h.requests, errors: a.errors + h.errors, throttled: a.throttled + h.throttled }), { requests: 0, errors: 0, throttled: 0 });
    const { backfillStatus } = await import('../collections/backfill.js');
    res.json({
      scope,
      crawler: c ? {
        state: c.state, updatedAt: iso(c.updatedAt), startedAt: c.startedAt ?? null, perSecond: c.perSecond ?? null, budgetScope: c.budgetScope ?? null,
        requestsLastHour: c.requestsLastHour ?? null, errorsLastHour: c.errorsLastHour ?? null,
        // The last error and back-offs belong to one version's endpoints: only this version's are shown.
        lastError: c.lastError && mine(c.lastError.endpoint) ? c.lastError : null,
        lastErrorElsewhere: Boolean(c.lastError && !mine(c.lastError.endpoint)),
        backoffs: (c.backoffs ?? []).filter((b) => mine(b.endpoint)).map((b) => ({ ...b, endpoint: scope.primary ? b.endpoint : String(b.endpoint).slice(prefix.length) })),
        inFlight: (c.inFlight ?? []).filter((x) => (x.version ?? PRIMARY_SCOPE.version) === scope.version && (x.region ?? PRIMARY_SCOPE.region) === scope.region).length,
        waitingByVersion: c.waitingByVersion ?? {},
        sourceProblem: c.sourceProblem ?? null,
      } : null,
      queue: PRIORITY_VALUES.map((p) => {
        const row = queue.find((x) => Number(x.priority) === p);
        return { priority: p, queued: row?.queued ?? 0, running: row?.running ?? 0, oldest: iso(row?.oldest) };
      }),
      versions: GAME_VERSIONS.map((v) => {
        const rows = byVersion.filter((x) => x.game_version === v.id);
        const sum = (k) => rows.reduce((n, x) => n + x[k], 0);
        return {
          id: v.id, name: v.name, enabled: isVersionEnabled(v.id), share: shares?.[v.id] ?? null,
          queued: sum('queued'), running: sum('running'), finishedHour: sum('finished_hour'), failedHour: sum('failed_hour'),
          waitingForBudget: c?.waitingByVersion?.[v.id] ?? 0,
        };
      }),
      budget: { perSecond, perHour: perSecond * 3600, thisHour: status.thisHour, last24h: hours24, hoursMeasured: status.hours.length },
      today: { ...today },
      backfill: scope.primary ? await backfillStatus(db) : null,
      switches: {
        crawl: { on: !(await getSetting(db, 'crawler.paused')), feature: 'crawl' },
        rosterSeed: { on: Boolean(await getSetting(db, 'crawler.rosterExpansion')), feature: 'roster-seed' },
        backfill: { on: Boolean(await getSetting(db, 'collections.backfill')), feature: 'collections-backfill' },
        version: { on: scope.enabled, feature: `version-${scope.version}` },
      },
    });
  }));

  // ---- Data › Crawler › Worker jobs (own 5 s clock) ----
  r.get('/data/jobs', route(async (req, res) => {
    const status = await crawlerStatus(db);
    const workers = status.workers.map((w) => {
      const live = w.state !== 'not_responding';
      return {
        id: w.id, version: w.version, startedAt: iso(w.startedAt), lastTickAt: iso(w.lastTickAt), state: w.state,
        jobs: (w.jobs ?? []).map((j) => {
          const started = j.lastStartedAt ? Date.parse(j.lastStartedAt) : null;
          const finished = j.lastFinishedAt ? Date.parse(j.lastFinishedAt) : null;
          const running = live && started !== null && (finished === null || finished < started);
          // Overdue: the worker is alive but this job hasn't started for three of its own intervals (plus a tick).
          const overdue = live && j.everyMs && started !== null && Date.now() - started > 3 * j.everyMs + 60_000;
          return {
            id: j.id, label: j.label, everyMs: j.everyMs ?? null, lastStartedAt: j.lastStartedAt ?? null, lastFinishedAt: j.lastFinishedAt ?? null,
            lastWorkAt: j.lastWorkAt ?? null, outcome: j.lastOutcome ?? null, summary: j.lastSummary ?? null,
            state: !live ? 'unknown' : running ? 'running' : j.lastOutcome === 'failed' ? 'failed' : overdue ? 'overdue' : started === null ? 'waiting' : 'ok',
          };
        }),
      };
    });
    res.json({ workers, staleAfterMs: STALE_MS });
  }));

  // ---- Data › Crawler › Share card renderer ----
  r.get('/data/renderer', route(async (req, res) => {
    const cache = await db.one('SELECT count(*)::int AS images, coalesce(sum(bytes), 0)::bigint AS bytes, min(data_at) AS oldest_data, avg(render_ms)::int AS avg_ms FROM share_card_images');
    const defaults = await db.query('SELECT kind, count(*)::int AS n FROM share_card_defaults GROUP BY kind ORDER BY kind LIMIT 10');
    const stats = cardStats() ?? null;
    const ms = (stats?.recent ?? []).map((x) => x.ms).filter(Number.isFinite).sort((a, b) => a - b);
    const pick = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
    res.json({
      on: Boolean(await getSetting(db, 'features.shareCards')),
      maxConcurrent: await getSetting(db, 'cards.maxConcurrent'),
      renderer: stats ? { browser: Boolean(stats.browser), running: stats.running ?? 0, waiting: stats.waiting ?? 0, launches: stats.launches ?? 0, measured: ms.length, medianMs: pick(0.5), p95Ms: pick(0.95), slowestMs: ms.at(-1) ?? null } : null,
      cache: { images: cache.images, bytes: Number(cache.bytes), oldestData: iso(cache.oldest_data), avgMs: cache.avg_ms },
      defaults,
    });
  }));

  // ---- Data › Collections & catalogs ----
  r.get('/data/collections', route(async (req, res) => {
    const scope = scopeOf(req);
    const sq = scopeSql('', scope);
    const { catalogByKind, REFRESH_DAYS } = await import('../collections/catalog.js');
    const { legacyPatterns } = await import('../collections/legacy.js');
    const { sharingEvidence } = await import('../collections/store.js');
    const { KINDS } = await import('../collections/registry.js');
    const states = await db.query(`SELECT kind, state, total, requests, bytes, detail, started_at, finished_at, fetched_at FROM collection_catalog_state WHERE ${sq} ORDER BY kind LIMIT 50`);
    const entries = await db.query(`SELECT kind, count(*)::int AS n FROM collection_catalog WHERE ${sq} GROUP BY kind LIMIT 50`);
    const pending = await db.query(`SELECT split_part(key, ':', 2) AS kind, count(*)::int AS n FROM crawl_queue WHERE kind = 'catalog' AND state IN ('queued', 'running') AND ${sq} GROUP BY 1 LIMIT 50`);
    const achRows = await db.query(`SELECT id, name, data FROM collection_catalog WHERE ${sq} AND kind = 'achievement' ORDER BY id LIMIT 20000`);
    const ach = achRows.map((x) => ({ ...x.data, id: Number(x.id), name: x.name }));
    const outcomes = await db.query(`SELECT outcome FROM crawl_queue WHERE kind = 'collections' AND state = 'done' AND outcome LIKE 'collections:%' AND ${sq} LIMIT 5000`);
    const parsed = outcomes.map((o) => /(\d+) of (\d+) returned, (\d+) KB/.exec(o.outcome)).filter(Boolean).map((m) => ({ returned: Number(m[1]), asked: Number(m[2]), kb: Number(m[3]) }));
    const tracked = await db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE class = 'Hunter')::int AS hunters, count(*) FILTER (WHERE collections_fetched_at IS NOT NULL)::int AS with_collections
                                    FROM characters WHERE profile_state = 'ok' AND level >= 10 AND stats_fetched_at IS NOT NULL AND ${sq}`);
    const entryN = new Map(entries.map((e) => [e.kind, e.n]));
    const pendingN = new Map(pending.map((p) => [p.kind, p.n]));
    const catalogs = states.map((s) => {
      const building = s.state === 'queued' || s.state === 'building';
      const stuck = building && !pendingN.get(s.kind);
      const stale = s.fetched_at && Date.now() - new Date(s.fetched_at).getTime() > REFRESH_DAYS * DAY_MS;
      return {
        kind: s.kind, label: catalogByKind.get(s.kind)?.label ?? (s.kind === 'namespace' ? 'Static namespace' : s.kind),
        state: s.kind === 'namespace' ? 'namespace' : stuck ? 'stuck' : s.state, rawState: s.state, total: s.total, entries: entryN.get(s.kind) ?? 0,
        requests: Number(s.requests), bytes: Number(s.bytes), detail: s.detail, startedAt: iso(s.started_at), finishedAt: iso(s.finished_at), fetchedAt: iso(s.fetched_at),
        pending: pendingN.get(s.kind) ?? 0, refreshDue: Boolean(stale), problem: stuck || s.state === 'failed',
      };
    });
    res.json({
      scope,
      catalogs,
      refreshDays: REFRESH_DAYS,
      legacy: { ...legacyPatterns(ach), achievements: ach.length },
      sharing: await sharingEvidence(db),
      refreshes: {
        lastHour: parsed.length,
        requestsEach: parsed.length ? Math.round(parsed.reduce((n, p) => n + p.asked, 0) / parsed.length * 10) / 10 : null,
        kbEach: parsed.length ? Math.round(parsed.reduce((n, p) => n + p.kb, 0) / parsed.length) : null,
        endpoints: KINDS.length,
      },
      tracked,
      backfill: scope.primary ? await (await import('../collections/backfill.js')).backfillStatus(db) : null,
    });
  }));

  // ---- Data › Backups (global) ----
  r.get('/data/backups', route(async (req, res) => {
    const limit = pageLimit(req.query.limit, { fallback: 20, max: 100 });
    const before = req.query.before ? Number.parseInt(req.query.before, 10) : null;
    if (before !== null && !Number.isFinite(before)) throw new HttpError(400, 'Bad cursor', 'invalid');
    const status = await backupStatus(db);
    // Why each file is kept: the same rule as the prune, over every file name the log knows (one a day: bounded).
    const files = await db.query(
      `SELECT DISTINCT ON (file_name) file_name, coalesce(finished_at, started_at) AS at FROM backup_runs
        WHERE outcome = 'ok' AND file_name IS NOT NULL ORDER BY file_name, started_at DESC LIMIT 5000`,
    );
    const reasons = keepReasons(files.map((f) => ({ name: f.file_name, takenAt: new Date(f.at).getTime() })));
    const newestRunOf = new Map((await db.query(
      `SELECT DISTINCT ON (file_name) file_name, id FROM backup_runs WHERE outcome = 'ok' AND file_name IS NOT NULL ORDER BY file_name, started_at DESC, id DESC LIMIT 5000`,
    )).map((x) => [x.file_name, Number(x.id)]));
    const rows = await db.query(
      `SELECT id, trigger, outcome, started_at, finished_at, file_name, bytes, detail FROM backup_runs
        WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
      [before, limit + 1],
    );
    const { nightly, monthly } = ENVIRONMENT.backups;
    const { LEGACY_BACKUP_KEEP_DAYS } = await import('../retention/policy.js');
    const history = rows.slice(0, limit).map((x) => {
      let kept = null;
      if (x.outcome === 'ok' && x.file_name) {
        if (newestRunOf.get(x.file_name) !== Number(x.id)) kept = { code: 'replaced', text: 'Replaced by a later backup the same day' };
        else {
          const code = reasons.get(x.file_name) ?? null;
          kept = code ? { code, text: DATA_KEEP_TEXT[code](nightly, LEGACY_BACKUP_KEEP_DAYS) } : null;
        }
      }
      const abandoned = x.outcome === 'running' && Date.now() - new Date(x.started_at).getTime() > 6 * 60 * 60 * 1000;
      return {
        id: Number(x.id), trigger: x.trigger, outcome: abandoned ? 'abandoned' : x.outcome, startedAt: iso(x.started_at), finishedAt: iso(x.finished_at),
        file: x.file_name, bytes: num(x.bytes), detail: x.detail, kept,
      };
    });
    res.json({
      status,
      rule: { nightly, monthly, legacyKeepDays: LEGACY_BACKUP_KEEP_DAYS, environment: ENVIRONMENT.id ?? null },
      // The worker container's name is in the compose files (dev: everstats-dev-worker).
      commands: ['now', 'list', 'verify <file>'].map((a) => `docker exec ${ENVIRONMENT.id === 'dev' ? 'everstats-dev-worker' : 'everstats-worker'} node server/tools/backup.js ${a}`),
      history,
      next: rows.length > limit ? history.at(-1).id : null,
    });
  }));

  // ---- Data retention (per version + region; the status is all versions) ----
  r.get('/data/retention', route(async (req, res) => {
    const scope = scopeOf(req);
    const status = await retentionStatus(db);
    const now = Date.now();
    const memoKey = `${scope.version}/${scope.region}/${status.keepDays}`;
    let memo = countMemo.get(memoKey);
    if (!memo || req.query.fresh === '1' || now - memo.at > COUNT_MEMO_MS) {
      memo = { at: now, promise: retentionKinds(db, scope, { now, keepDays: status.keepDays }) };
      countMemo.set(memoKey, memo);
      memo.promise.catch(() => countMemo.delete(memoKey));
    }
    const { kinds, cutoff } = await memo.promise;
    const recent = await db.query('SELECT id, started_at, finished_at, process, window_days, deleted, problem FROM retention_sweeps ORDER BY id DESC LIMIT 3');
    const oldestAge = status.oldestAt ? now - new Date(status.oldestAt).getTime() : null;
    const overBy = oldestAge !== null ? oldestAge - status.windowDays * DAY_MS : null;
    const oldestKind = Object.entries(status.oldest).filter(([, t]) => t).sort(([, a], [, b]) => new Date(a) - new Date(b))[0]?.[0] ?? null;
    res.json({
      scope,
      rule: { windowDays: status.windowDays, keepDays: status.keepDays, safetyDays: status.safetyDays, permission: status.permission, sweepEveryMinutes: 60 },
      status: {
        state: overBy !== null && overBy > 0 ? 'outside' : 'within',
        overByMs: overBy !== null && overBy > 0 ? overBy : null,
        oldestAt: status.oldestAt, oldestKind,
        dueForSweep: kinds.reduce((n, k) => n + (k.overdue ?? 0), 0),
        lastSweep: recent[0] ? sweepRow(recent[0]) : null,
        failedInARow: (() => {
          let n = 0;
          for (const x of recent) if (x.problem) n += 1; else break;
          return n;
        })(),
      },
      cutoff,
      countedAt: new Date(memo.at).toISOString(),
      kinds,
      ours: Object.entries(OURS).filter(([t]) => !t.startsWith('_')).map(([table, reason]) => ({ table, reason })).sort((a, b) => a.table.localeCompare(b.table)),
    });
  }));

  r.get('/data/retention/sweeps', route(async (req, res) => {
    const limit = pageLimit(req.query.limit, { fallback: 20, max: 100 });
    const before = req.query.before ? Number.parseInt(req.query.before, 10) : null;
    if (before !== null && !Number.isFinite(before)) throw new HttpError(400, 'Bad cursor', 'invalid');
    const rows = await db.query(
      `SELECT id, started_at, finished_at, process, window_days, deleted, problem FROM retention_sweeps
        WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
      [before, limit + 1],
    );
    const sweeps = rows.slice(0, limit).map(sweepRow);
    res.json({ sweeps, next: rows.length > limit ? sweeps.at(-1).id : null });
  }));

  // ---- Settings ----
  r.get('/data/settings', route(async (req, res) => {
    const settings = await listSettings(db);
    res.json({
      settings,
      versions: GAME_VERSIONS.map((v) => ({ id: v.id, name: v.name, enabled: isVersionEnabled(v.id), primary: v.id === PRIMARY_VERSION.id })),
      retention: { keepDays: keepDaysFor((settings.find((s) => s.key === 'retention.window')?.value ?? { days: 30 }).days) },
    });
  }));

  r.get('/data/keys', route(async (req, res) => {
    res.json({ credentials: await listPublic(db) });
  }));
  r.put('/data/keys/:id', writes, route(async (req, res) => {
    const { reason = null, ...fields } = req.body ?? {};
    res.json({ credential: await saveCredential(db, req.params.id, fields, { reason }) });
  }));
  r.post('/data/keys/:id/remove', writes, route(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 3) throw new HttpError(400, 'Say why the key is being removed (it goes in the audit log).', 'reason_required');
    res.json({ credential: await removeCredential(db, req.params.id, { reason }) });
  }));

  r.get('/data/proxies', route(async (req, res) => {
    const p = typeof proxies === 'function' ? proxies() : null;
    res.json({
      trustedProxies: p?.trustedProxies ?? trustedProxyEntries(),
      check: p?.check ?? trustedProxyCheck(),
      // null = this router wasn't handed the web process's list of where the header came from (not measured here).
      sources: p ? p.sources ?? [] : null,
    });
  }));

  return r;
}
