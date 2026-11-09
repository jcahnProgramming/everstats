import express from 'express';
import { getSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { ACTIVITY_KINDS, ACTIVITY_LABELS } from './count.js';

/**
 * /api/admin/activity… (0.7.1), behind the admin gate: "what changed since I last checked".
 *
 *   accounts            player accounts now (from the database, so history included), and new ones since the marker
 *   searches            the activity_counts kinds (count.js): counted from 0.7.1's deploy only. A range that starts before
 *                       that is marked partial, and the time before it is unknown (never 0)
 *   new characters      characters.tracked_since and .source: how each first arrived (a look-up, a Battle.net sign-in, a
 *                       guild roster), from the database
 *   guilds              guilds.first_seen_at. Guilds and characters are Blizzard data: one Blizzard hasn't returned for
 *                       30 days has left the database, so "now" counts only what is stored now
 *   faction / ruleset   tracked characters (fetched, shown, not missing) per ruleset and faction, and each ruleset's
 *                       tier-eligible count against grading.minPopulation
 *
 * The marker ("Mark as checked") moves only when the admin presses the button, never on a page load.
 */
const MARKER = 'admin_activity_checked_at';
const SINCE = 'activity_counting_since';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 14;
const SOURCES = { lookup: 'A look-up (search or page)', account: 'A Battle.net sign-in', guild: 'A guild roster' };
const TRACKED = "c.stats_fetched_at IS NOT NULL AND NOT c.hidden AND c.missing_since IS NULL AND c.profile_state = 'ok'";

async function facts(db) {
  const rows = await db.query('SELECT key, at FROM pipeline_facts WHERE key = ANY($1::text[])', [[MARKER, SINCE]]);
  const get = (k) => rows.find((r) => r.key === k)?.at ?? null;
  return { checkedAt: get(MARKER), countingSince: get(SINCE) };
}

/** The start of the asked range: the marker, 24 h, 7 days or launch (null = everything there is). */
function rangeStart(range, f, now) {
  if (range === '24h') return new Date(now - DAY_MS);
  if (range === '7d') return new Date(now - 7 * DAY_MS);
  if (range === 'launch') return null;
  return f.checkedAt ? new Date(f.checkedAt) : null;
}

export async function activityView(db, { range = 'checked', now = Date.now() } = {}) {
  const f = await facts(db);
  const since = rangeStart(range, f, now);
  const countingSince = f.countingSince ? new Date(f.countingSince) : null;

  const acc = await db.one(
    'SELECT count(*)::int AS total, count(*) FILTER (WHERE $1::timestamptz IS NOT NULL AND created_at >= $1)::int AS new FROM accounts',
    [since],
  );

  // Counted hour by hour: a range starting inside an hour includes that whole hour (said on the panel).
  const counts = await db.query(
    `SELECT kind, sum(n)::int AS total,
            sum(n) FILTER (WHERE $1::timestamptz IS NULL OR hour >= date_trunc('hour', $1::timestamptz))::int AS since
       FROM activity_counts GROUP BY kind LIMIT 100`,
    [since],
  );
  const kinds = Object.fromEntries(Object.keys(ACTIVITY_KINDS).map((k) => {
    const c = counts.find((x) => x.kind === k);
    return [k, { label: ACTIVITY_LABELS[k], help: ACTIVITY_KINDS[k], total: c?.total ?? 0, since: c?.since ?? 0 }];
  }));
  const partial = !countingSince || since === null || since < countingSince;

  const chars = await db.query(
    `SELECT source, count(*)::int AS total, count(*) FILTER (WHERE $1::timestamptz IS NOT NULL AND tracked_since >= $1)::int AS new
       FROM characters GROUP BY source LIMIT 10`,
    [since],
  );
  const guilds = await db.one(
    'SELECT count(*)::int AS total, count(*) FILTER (WHERE $1::timestamptz IS NOT NULL AND first_seen_at >= $1)::int AS new FROM guilds',
    [since],
  );

  const rulesets = await db.query('SELECT id, name FROM rulesets ORDER BY id LIMIT 50');
  const split = await db.query(
    `SELECT c.ruleset_id, c.faction, count(*)::int AS n,
            count(*) FILTER (WHERE c.level >= 10)::int AS eligible
       FROM characters c WHERE ${TRACKED} GROUP BY c.ruleset_id, c.faction LIMIT 500`,
  );
  const minPopulation = await getSetting(db, 'grading.minPopulation');
  const factions = [...new Set(split.map((s) => s.faction).filter(Boolean))].sort();
  const perRuleset = rulesets.map((r) => {
    const mine = split.filter((s) => s.ruleset_id === r.id);
    const tracked = mine.reduce((n, s) => n + s.n, 0);
    return {
      id: r.id, name: r.name, tracked,
      eligible: mine.reduce((n, s) => n + s.eligible, 0),
      factions: Object.fromEntries(factions.map((fa) => [fa, mine.filter((s) => s.faction === fa).reduce((n, s) => n + s.n, 0)])),
      noFaction: mine.filter((s) => !s.faction).reduce((n, s) => n + s.n, 0),
    };
  });
  const overall = Object.fromEntries(factions.map((fa) => [fa, split.filter((s) => s.faction === fa).reduce((n, s) => n + s.n, 0)]));

  // The last 14 UTC days, oldest first: accounts and new characters from the database, searches from the counters
  // (null for a day before counting began: unknown, not 0).
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const from = new Date(today - (CHART_DAYS - 1) * DAY_MS);
  const perDay = async (sql) => new Map((await db.query(sql, [from])).map((r) => [new Date(r.day).toISOString().slice(0, 10), r.n]));
  const accDays = await perDay("SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(*)::int AS n FROM accounts WHERE created_at >= $1 GROUP BY 1 LIMIT 100");
  const charDays = await perDay("SELECT date_trunc('day', tracked_since AT TIME ZONE 'UTC') AS day, count(*)::int AS n FROM characters WHERE tracked_since >= $1 GROUP BY 1 LIMIT 100");
  const searchDays = await perDay(
    `SELECT date_trunc('day', hour AT TIME ZONE 'UTC') AS day, sum(n)::int AS n FROM activity_counts
      WHERE hour >= $1 AND kind IN ('character.search', 'character.lookup', 'character.signin', 'guild.search', 'search.page') GROUP BY 1 LIMIT 100`,
  );
  const countStartDay = countingSince ? new Date(Math.floor(countingSince.getTime() / DAY_MS) * DAY_MS) : null;
  const days = [];
  for (let i = 0; i < CHART_DAYS; i++) {
    const d = new Date(from.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    days.push({
      day: key,
      accounts: accDays.get(key) ?? 0,
      characters: charDays.get(key) ?? 0,
      searches: countStartDay && d >= countStartDay ? searchDays.get(key) ?? 0 : null,
      partialDay: Boolean(countStartDay) && d.getTime() === countStartDay.getTime(),
    });
  }

  return {
    range, since, checkedAt: f.checkedAt, countingSince, now: new Date(now),
    accounts: { total: acc.total, new: since === null ? null : acc.new },
    searches: { partial, kinds },
    characters: {
      bySource: Object.entries(SOURCES).map(([id, label]) => {
        const c = chars.find((x) => x.source === id);
        return { id, label, total: c?.total ?? 0, new: since === null ? null : c?.new ?? 0 };
      }),
    },
    guilds: { total: guilds.total, new: since === null ? null : guilds.new },
    factions: { names: factions, overall, tracked: perRuleset.reduce((n, r) => n + r.tracked, 0) },
    rulesets: perRuleset,
    minPopulation,
    days,
  };
}

export function createAdminActivityRouter({ db, writes }) {
  const r = express.Router();
  r.get('/activity', route(async (req, res) => {
    const range = ['checked', '24h', '7d', 'launch'].includes(req.query.range) ? req.query.range : 'checked';
    res.json(await activityView(db, { range }));
  }));
  r.post('/activity/checked', writes, route(async (req, res) => {
    if (req.body?.confirm !== true) throw new HttpError(400, 'Confirm moving the marker.', 'invalid');
    await db.query(`INSERT INTO pipeline_facts (key, at) VALUES ($1, now()) ON CONFLICT (key) DO UPDATE SET at = now()`, [MARKER]);
    res.json(await activityView(db, { range: 'checked' }));
  }));
  return r;
}
