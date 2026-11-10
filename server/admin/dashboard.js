import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { getSetting } from './settings.js';
import { crawlerStatus } from './crawler.js';
import { backupStatus } from '../core/backup.js';
import { retentionPolicy } from '../retention/policy.js';
import { OLDEST } from '../retention/registry.js';
import { listFeatures } from '../features/registry.js';
import { betaState } from '../beta.js';
import { activityView } from '../activity/admin.js';
import { PRIMARY_VERSION, REGIONS, versionById } from '../core/gameVersions.js';

const PRIMARY_REGION = REGIONS.find((g) => g.enabled)?.id ?? REGIONS[0].id;

/**
 * The admin Dashboard (0.10.3, design/v5-admin pages/dashboard): the "Needs you" strip and the 11 cards, in one answer.
 *
 *   range        since I last checked (the "Mark as checked" marker) · 24h · 7d · since launch. Every card's "change"
 *                is counted from the range's start; a number with no history (a queue depth, a backup state) has no
 *                change and says so (null), never a made-up 0. "Since launch" has no change at all.
 *   v, r         the version switcher. Per-version cards (Faction, Ruleset, Characters & guilds, Crawler, Collections)
 *                count only that version and region; the rest are global ("All versions").
 *
 * Each card is computed on its own (part()): a card whose queries fail answers { error } and the page shows it failed
 * with Retry, keeping its height, while the others stay live. Everything is measured at request time; nothing is
 * cached or estimated. Activity counts (searches) exist only from 0.7.1's deploy: earlier is "unknown".
 */
const DAY_MS = 86_400_000;
const DAYS = 14;
const TRACKED = "c.stats_fetched_at IS NOT NULL AND NOT c.hidden AND c.missing_since IS NULL AND c.profile_state = 'ok'";

async function perDay(db, sql, params, from) {
  const rows = await db.query(sql, [from, ...params]);
  const map = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.n)]));
  return Array.from({ length: DAYS }, (_, i) => {
    const key = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { day: key, n: map.get(key) ?? 0 };
  });
}

/** One card's numbers, or { error } when its queries fail. */
async function part(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: `Couldn’t count this (${err.code ?? err.name})` };
  }
}

const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);

async function playersCard(db, { since, from }) {
  const p = await db.one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE $1::timestamptz IS NOT NULL AND created_at >= $1)::int AS new,
            count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS new24,
            count(*) FILTER (WHERE created_at >= now() - interval '48 hours' AND created_at < now() - interval '24 hours')::int AS new24before,
            count(*) FILTER (WHERE beta_member)::int AS beta,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM account_totp t WHERE t.account_id = a.id AND t.state = 'enabled')
                              OR EXISTS (SELECT 1 FROM passkeys p WHERE p.account_id = a.id))::int AS strong,
            count(*) FILTER (WHERE everstats_banned(a.id))::int AS banned
       FROM accounts a`,
    [since],
  );
  const methods = await db.query('SELECT provider, count(DISTINCT account_id)::int AS n FROM account_identities GROUP BY provider ORDER BY provider LIMIT 10');
  const passkeyAccounts = (await db.one('SELECT count(DISTINCT account_id)::int AS n FROM passkeys')).n;
  const tempBanned = (await db.one("SELECT count(DISTINCT account_id)::int AS n FROM account_bans WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at > now()")).n;
  const warned = (await db.one("SELECT count(DISTINCT account_id)::int AS n FROM moderation_actions WHERE type = 'warning' AND ($1::timestamptz IS NULL OR at >= $1)", [since])).n;
  const beta = await betaState(db);
  return {
    total: p.total, new: since ? p.new : null, new24: p.new24, new24before: p.new24before, beta: p.beta, betaOpen: beta.open,
    strong: p.strong, banned: p.banned, tempBanned, warned,
    methods: [...methods.map((m) => ({ id: m.provider, n: m.n })), { id: 'passkey', n: passkeyAccounts }],
    goldPublic: (await db.one('SELECT count(*)::int AS n FROM character_gold_public')).n,
    days: await perDay(db, "SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(*) AS n FROM accounts WHERE created_at >= $1 GROUP BY 1 LIMIT 100", [], from),
  };
}

async function inboxCard(db, { since }) {
  const i = await db.one(
    `SELECT (SELECT count(*)::int FROM feedback_threads WHERE state = 'unread') AS unread,
            (SELECT count(*)::int FROM feedback_threads WHERE state = 'unread' AND type = 'appeal') AS appeals,
            (SELECT count(*)::int FROM reports WHERE state = 'open') + (SELECT count(*)::int FROM guild_link_reports WHERE state = 'open') AS reports,
            (SELECT min(updated_at) FROM feedback_threads WHERE state = 'unread') AS oldest_unread,
            (SELECT count(*)::int FROM feedback_threads WHERE $1::timestamptz IS NOT NULL AND created_at >= $1) AS new_threads,
            (SELECT count(*)::int FROM reports WHERE $1::timestamptz IS NOT NULL AND reported_at >= $1)
              + (SELECT count(*)::int FROM guild_link_reports WHERE $1::timestamptz IS NOT NULL AND reported_at >= $1) AS new_reports`,
    [since],
  );
  return { unread: i.unread, appeals: i.appeals, reports: i.reports, oldestUnread: i.oldest_unread, total: i.unread + i.reports, new: since ? i.new_threads + i.new_reports : null };
}

async function characterSplit(db, { vr, since }) {
  return db.query(
    `SELECT c.ruleset_id, c.faction, count(*)::int AS n, count(*) FILTER (WHERE c.level >= 10)::int AS eligible,
            count(*) FILTER (WHERE $3::timestamptz IS NOT NULL AND c.tracked_since >= $3)::int AS new
       FROM characters c WHERE ${TRACKED} AND c.game_version = $1 AND c.region = $2 GROUP BY c.ruleset_id, c.faction LIMIT 500`,
    [...vr, since],
  );
}

function factionCard(split, { since }) {
  const names = [...new Set(split.map((s) => s.faction).filter(Boolean))].sort();
  return {
    names,
    overall: Object.fromEntries(names.map((fa) => [fa, sum(split.filter((s) => s.faction === fa), 'n')])),
    none: sum(split.filter((s) => !s.faction), 'n'),
    tracked: sum(split, 'n'),
    new: since ? sum(split, 'new') : null,
  };
}

async function rulesetCard(db, split, { vr, since, version }) {
  const rulesets = await db.query('SELECT id, name FROM rulesets WHERE game_version = $1 AND region = $2 ORDER BY id LIMIT 50', vr);
  const graded = await db.one('SELECT max(computed_at) AS at FROM tier_rulesets WHERE ruleset_id = ANY($1::bigint[])', [rulesets.map((r) => r.id)]);
  const names = [...new Set(split.map((s) => s.faction).filter(Boolean))].sort();
  return {
    minPopulation: await getSetting(db, 'grading.minPopulation', { version }),
    lastGradedAt: graded?.at ?? null,
    new: since ? sum(split, 'new') : null,
    list: rulesets.map((r) => {
      const mine = split.filter((s) => s.ruleset_id === r.id);
      return {
        id: r.id, name: r.name, tracked: sum(mine, 'n'), eligible: sum(mine, 'eligible'),
        factions: Object.fromEntries(names.map((fa) => [fa, sum(mine.filter((s) => s.faction === fa), 'n')])),
      };
    }),
  };
}

async function charactersCard(db, act, { vr, since, from }) {
  const c = await db.one(
    `SELECT count(*)::int AS known, count(*) FILTER (WHERE stats_fetched_at IS NOT NULL)::int AS tracked,
            count(*) FILTER (WHERE $3::timestamptz IS NOT NULL AND tracked_since >= $3)::int AS new,
            count(*) FILTER (WHERE hidden)::int AS hidden, count(*) FILTER (WHERE missing_since IS NOT NULL)::int AS missing
       FROM characters WHERE game_version = $1 AND region = $2`,
    [...vr, since],
  );
  const bySource = await db.query('SELECT source, count(*)::int AS n FROM characters WHERE game_version = $1 AND region = $2 GROUP BY source LIMIT 10', vr);
  const g = await db.one(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE $3::timestamptz IS NOT NULL AND first_seen_at >= $3)::int AS new
       FROM guilds WHERE game_version = $1 AND region = $2`,
    [...vr, since],
  );
  return {
    ...c, new: since ? c.new : null, guilds: g.total, newGuilds: since ? g.new : null,
    bySource: act.characters.bySource.map((s) => ({ id: s.id, label: s.label, n: bySource.find((b) => b.source === s.id)?.n ?? 0 })),
    days: await perDay(db, "SELECT date_trunc('day', tracked_since AT TIME ZONE 'UTC') AS day, count(*) AS n FROM characters WHERE tracked_since >= $1 AND game_version = $2 AND region = $3 GROUP BY 1 LIMIT 100", vr, from),
  };
}

async function crawlerCard(db, { vr, version, now }) {
  const st = await crawlerStatus(db);
  const c = st.crawler;
  const perSecond = await getSetting(db, 'crawler.requestsPerSecond');
  const shares = await getSetting(db, 'crawler.versionShares');
  const queue = await db.one(
    `SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'running')::int AS running
       FROM crawl_queue WHERE game_version = $1 AND region = $2`,
    vr,
  );
  const ceiling = perSecond * ((shares?.[version] ?? 100) / 100);
  const minutesIn = Math.min(60, Math.max(1, (now - new Date(st.thisHour.hour).getTime()) / 60_000));
  const rate = st.thisHour.requests / (minutesIn * 60);
  return {
    state: !c ? 'not_started' : c.state,
    // Requests per second so far this UTC hour (every request, all versions: crawler_hours isn't split by version),
    // against this version's ceiling. Null before the crawler has ever reported.
    perSecond: Math.round(rate * 10) / 10, ceiling,
    budgetUsedPct: c && ceiling > 0 ? Math.round((rate / ceiling) * 100) : null,
    requestsThisHour: st.thisHour.requests, errorsThisHour: st.thisHour.errors, throttled: st.thisHour.throttled,
    lastError: c?.lastError ?? null, queued: queue.queued, running: queue.running,
    hours: st.hours.map((h) => ({ hour: h.hour, n: h.requests })),
    workerStale: st.workers[0] ? st.workers[0].state === 'not_responding' : true,
    failedJobs: (st.workers[0]?.jobs ?? []).filter((j) => j.lastOutcome === 'failed').map((j) => j.label),
  };
}

async function collectionsCard(db, { vr, since }) {
  const coll = await db.one(
    `SELECT count(*) FILTER (WHERE ${TRACKED} AND c.level >= 10)::int AS tracked,
            count(*) FILTER (WHERE ${TRACKED} AND c.level >= 10 AND c.collections_fetched_at IS NOT NULL)::int AS with_collections,
            count(*) FILTER (WHERE $3::timestamptz IS NOT NULL AND c.collections_first_at >= $3)::int AS new
       FROM characters c WHERE c.game_version = $1 AND c.region = $2`,
    [...vr, since],
  );
  const catalogs = await db.query("SELECT kind, state FROM collection_catalog_state WHERE kind <> 'namespace' ORDER BY kind LIMIT 50");
  return { ...coll, new: since ? coll.new : null, catalogs, backfill: await getSetting(db, 'collections.backfill'), perDay: await getSetting(db, 'collections.backfillPerDay') };
}

async function retentionCard(db, { now }) {
  const policy = await retentionPolicy(db);
  const oldest = [];
  for (const [label, sql] of OLDEST) oldest.push({ label, at: (await db.one(sql))?.t ?? null });
  const outside = oldest.filter((o) => o.at && now - new Date(o.at).getTime() > policy.windowDays * DAY_MS);
  const last = await db.one('SELECT finished_at, problem FROM retention_sweeps WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1');
  const ats = oldest.map((o) => o.at && new Date(o.at).getTime()).filter(Boolean);
  return {
    windowDays: policy.windowDays, keepDays: policy.keepDays, outside: outside.map((o) => o.label),
    oldestAt: ats.length ? new Date(Math.min(...ats)).toISOString() : null,
    lastSweepAt: last?.finished_at ?? null, lastSweepProblem: last?.problem ?? null,
  };
}

async function backupsCard(db) {
  const b = await backupStatus(db, { recent: 14 });
  return {
    lastSuccessAt: b.lastSuccessAt, failing: b.failing, running: b.running, lastSuccessBytes: b.lastSuccessBytes,
    lastSuccessFile: b.lastSuccessFile, recent: b.recent.map((r) => ({ at: r.startedAt, outcome: r.outcome })),
  };
}

async function featuresCard(db) {
  const list = await listFeatures(db);
  return {
    off: list.filter((f) => !f.working && !f.locked).map((f) => ({ id: f.id, name: f.name, blockedBy: f.blockedBy, on: f.on, playerVisible: f.playerVisible })),
    lockedOff: list.filter((f) => f.locked && !f.on).map((f) => ({ id: f.id, name: f.name })),
    total: list.filter((f) => !f.locked).length,
  };
}

function needsYou(cards) {
  const { inbox, collections, backups, crawler, retention } = cards;
  const needs = [];
  if (!inbox.error) {
    if (inbox.unread - inbox.appeals > 0) needs.push({ tone: 'info', icon: 'provider-chat', n: inbox.unread - inbox.appeals, text: 'unread feedback', to: '/admin/inbox/feedback' });
    if (inbox.reports > 0) needs.push({ tone: 'warn', icon: 'flags', n: inbox.reports, text: inbox.reports === 1 ? 'open report' : 'open reports', to: '/admin/inbox/reports' });
    if (inbox.appeals > 0) needs.push({ tone: 'info', icon: 'shield-check', n: inbox.appeals, text: inbox.appeals === 1 ? 'ban appeal' : 'ban appeals', to: '/admin/inbox/feedback?filter=appeals' });
  }
  if (!collections.error) {
    for (const cat of collections.catalogs.filter((x) => x.state === 'failed')) needs.push({ tone: 'err', icon: 'x-circle', n: null, text: `Catalog failed · ${cat.kind}`, to: '/admin/data/collections' });
  }
  if (!backups.error && backups.failing) needs.push({ tone: 'err', icon: 'x-circle', n: null, text: 'Last backup failed', to: '/admin/data/backups' });
  if (!crawler.error) {
    if (crawler.workerStale) needs.push({ tone: 'err', icon: 'x-circle', n: null, text: 'Worker not responding', to: '/admin/data/crawler' });
    if (crawler.failedJobs.length) needs.push({ tone: 'err', icon: 'x-circle', n: crawler.failedJobs.length, text: crawler.failedJobs.length === 1 ? 'worker job failed' : 'worker jobs failed', to: '/admin/data/crawler' });
    if (crawler.budgetUsedPct !== null && crawler.budgetUsedPct >= 90) needs.push({ tone: 'warn', icon: 'warning', n: null, text: `Crawler at ${crawler.budgetUsedPct}% of budget`, to: '/admin/data/crawler' });
    if (crawler.errorsThisHour > 0) needs.push({ tone: 'warn', icon: 'warning', n: crawler.errorsThisHour, text: crawler.errorsThisHour === 1 ? 'crawler error this hour' : 'crawler errors this hour', to: '/admin/data/crawler' });
  }
  if (!retention.error && retention.outside.length) needs.push({ tone: 'err', icon: 'retention', n: retention.outside.length, text: 'kinds of data outside the retention window', to: '/admin/retention' });
  for (const [name, card] of Object.entries(cards)) {
    if (card.error) needs.push({ tone: 'err', icon: 'error', n: null, text: `A dashboard card failed · ${name}`, to: '/admin' });
  }
  return needs;
}

export async function dashboardView(db, { range = 'checked', version = PRIMARY_VERSION.id, region = PRIMARY_REGION, now = Date.now() } = {}) {
  const act = await activityView(db, { range, now });
  const since = act.since ? new Date(act.since) : null;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const from = new Date(today - (DAYS - 1) * DAY_MS);
  const ctx = { since, from, vr: [version, region], version, now };

  const split = await part(() => characterSplit(db, ctx));
  const cards = {
    players: await part(() => playersCard(db, ctx)),
    inbox: await part(() => inboxCard(db, ctx)),
    faction: split.error ? split : factionCard(split, ctx),
    ruleset: split.error ? split : await part(() => rulesetCard(db, split, ctx)),
    characters: await part(() => charactersCard(db, act, ctx)),
    searches: {
      partial: act.searches.partial, countingSince: act.countingSince, kinds: act.searches.kinds,
      days: act.days.map((d) => ({ day: d.day, n: d.searches })),
    },
    crawler: await part(() => crawlerCard(db, ctx)),
    collections: await part(() => collectionsCard(db, ctx)),
    retention: await part(() => retentionCard(db, ctx)),
    backups: await part(() => backupsCard(db)),
    features: await part(() => featuresCard(db)),
  };
  return {
    range, since: act.since, checkedAt: act.checkedAt, countingSince: act.countingSince, now: new Date(now).toISOString(),
    scope: { version, region, versionName: versionById(version)?.name ?? version },
    needs: needsYou(cards),
    cards,
  };
}

export function createAdminDashboardRouter({ db }) {
  const r = express.Router();
  r.get('/dashboard', route(async (req, res) => {
    const range = ['checked', '24h', '7d', 'launch'].includes(req.query.range) ? req.query.range : 'checked';
    const version = typeof req.query.v === 'string' && req.query.v ? req.query.v : PRIMARY_VERSION.id;
    const region = typeof req.query.r === 'string' && REGIONS.some((g) => g.id === req.query.r) ? req.query.r : PRIMARY_REGION;
    if (!versionById(version)) throw new HttpError(400, 'Unknown version', 'invalid');
    res.json(await dashboardView(db, { range, version, region }));
  }));
  return r;
}
