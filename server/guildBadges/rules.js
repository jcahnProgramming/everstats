import { classList } from '../badges/rules.js';
import { loadDefinitions as loadPlayerDefinitions } from '../badges/store.js';
import { currentGuildMaster } from '../guilds/manage.js';
import { loadCatalog } from '../stats/catalog.js';
import { guildPeriodStart } from '../stats/guildBoards.js';
import { OVERALL_START, TRACKED_MEMBER } from '../stats/guildTotals.js';
import { LETTER_POINTS, STRONG_ROSTER_MIN, TOP_TEN } from './catalog.js';
import { guildBadgeContext, hold, levelFor, loadGuildDefinitions, logGuildBadgeEvent, lose, raiseLevel } from './store.js';

/**
 * Automatic guild badges (0.7.1): who qualifies, from what Everstats already stores. No Blizzard request, and nothing
 * from Blizzard is copied into an award (a Standing badge keeps only the ids of the boards it was held on).
 *
 *   Roster / Deeds   from the guild's CURRENT tracked members (the guild totals' basis: TRACKED_MEMBER). Levels, once
 *                    reached, are kept, whatever the members do later, and raising a threshold never removes one.
 *   Standing         KEPT WHILE HELD. Board Champion / Top Ten count only overall boards with at least
 *                    guilds.minBoardGuilds ranked guilds ("#1 of 1" earns nothing); Top Ten also needs MORE than 10
 *                    ranked guilds (a top-ten place on a 3-guild board is every ranked guild). Weekly Champion: the
 *                    current week's boards, so the Tuesday reset ends it until a guild is #1 again.
 *   Heritage         permanent. Founding: first tracked while a beta window was open. Early: inside the admin's window.
 *   Verified         while the guild has a Guild Master on Everstats (the account owning the rank-0 character).
 *
 * Run (the worker job 'guild-badges', worker/jobs.js): the one-time back-fill (no toasts, no ribbons), then every
 * minute for guilds whose totals were rebuilt or whose Guild Master changed, after each full tier grading (Strong
 * Roster) and every 6 hours for every guild.
 */

/** Ranks of a guild on every board of its ruleset in one period, both modes. Only boards with ≥ minBoardGuilds ranked. */
async function placements(db, { guildId, rulesetId, period, minMembers, minBoardGuilds }) {
  const start = guildPeriodStart(period);
  const rows = await db.query(
    `SELECT t.statistic_id,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = $5 AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4 AND o.total > t.total) + 1 AS rank_total,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = $5 AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4 AND o.average > t.average) + 1 AS rank_average,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = $5 AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4) AS ranked
       FROM guild_totals t
      WHERE t.guild_id = $1 AND t.period = $5 AND t.period_start = $3 AND t.ruleset_id = $2 AND t.total > 0 AND t.members >= $4
      LIMIT 5000`,
    [guildId, rulesetId, start, minMembers, period],
  );
  return rows.filter((r) => r.ranked >= minBoardGuilds);
}

const boardsWhere = (rows, rulesetId, period, test) => {
  const out = [];
  for (const r of rows) {
    for (const mode of ['total', 'average']) {
      const rank = mode === 'total' ? r.rank_total : r.rank_average;
      if (test(rank, r.ranked)) out.push({ statisticId: Number(r.statistic_id), rulesetId, mode, period });
    }
  }
  return out.slice(0, 50);
};

/**
 * Everything the rules need about one guild, read once. Also what the guild page shows as progress (`values`).
 *   values: Map(badgeId → number | null)   null = not measured yet (totals not built)
 */
export async function guildFacts(db, guild, { defs, ctx, classes, statIds }) {
  const rs = guild.ruleset_id;
  const members = rs === null ? 0 : (await db.one(`SELECT count(*)::int AS n FROM characters c WHERE ${TRACKED_MEMBER}`, [guild.id, rs])).n;
  const built = Boolean(guild.totals_built_at);
  const ids = [...statIds.values()];
  const totals = rs !== null && ids.length
    ? new Map((await db.query(
      `SELECT statistic_id, total FROM guild_totals WHERE guild_id = $1 AND period = 'overall' AND period_start = $2 AND statistic_id = ANY($3::bigint[])`,
      [guild.id, OVERALL_START, ids],
    )).map((r) => [Number(r.statistic_id), Number(r.total)]))
    : new Map();
  const values = new Map();
  for (const d of defs) {
    if (d.rule?.type === 'members') values.set(d.id, members);
    if (d.rule?.type === 'stat-total') {
      const id = statIds.get(d.rule.statistic.toLowerCase());
      // Not measured: totals not built yet, or no statistic of that name in the catalog (yet / any more).
      values.set(d.id, built && id !== undefined ? totals.get(id) ?? 0 : null);
    }
  }
  const classesHere = rs === null ? [] : (await db.query(
    `SELECT DISTINCT c.class FROM characters c WHERE ${TRACKED_MEMBER} AND c.level >= 10 AND c.class IS NOT NULL LIMIT 100`,
    [guild.id, rs],
  )).map((r) => r.class);
  const overall = rs === null || !built ? [] : await placements(db, { guildId: guild.id, rulesetId: rs, period: 'overall', minMembers: ctx.minMembers, minBoardGuilds: ctx.minBoardGuilds });
  // The weekly boards say "Collecting data" until snapshots began before the week did: no Weekly Champion before then.
  const week = rs === null || !built || !ctx.weekOpen ? [] : await placements(db, { guildId: guild.id, rulesetId: rs, period: 'week', minMembers: ctx.minMembers, minBoardGuilds: ctx.minBoardGuilds });
  const letters = rs === null ? [] : await db.query(
    `SELECT t.letter FROM characters c JOIN character_tiers t ON t.character_id = c.id WHERE ${TRACKED_MEMBER} AND t.letter IS NOT NULL LIMIT 5000`,
    [guild.id, rs],
  );
  const avg = letters.length ? letters.reduce((s, r) => s + (LETTER_POINTS[r.letter] ?? 0), 0) / letters.length : null;
  const gm = await currentGuildMaster(db, guild.id);
  const firstSeen = guild.first_seen_at ? Date.parse(guild.first_seen_at) : null;
  return {
    members,
    built,
    values,
    classes: { here: classesHere, all: classes, missing: classes.filter((c) => !classesHere.includes(c)) },
    champion: boardsWhere(overall, rs, 'overall', (rank) => rank === 1),
    topTen: boardsWhere(overall, rs, 'overall', (rank, ranked) => rank <= TOP_TEN && ranked > TOP_TEN),
    weekly: boardsWhere(week, rs, 'week', (rank) => rank === 1),
    tierAverage: avg,
    tierLettered: letters.length,
    verified: Boolean(gm?.accountId),
    founding: Boolean(guild.profile_fetched_at || members > 0) && firstSeen !== null
      && ctx.beta.windows.some((w) => firstSeen >= Date.parse(w.openedAt) && (w.closedAt === null || firstSeen < Date.parse(w.closedAt))),
    early: ctx.early.set && firstSeen !== null && firstSeen >= ctx.early.startMs && firstSeen < ctx.early.endMs,
  };
}

/** Statistic ids by lower-case name, for the Deeds rules (matched by name, never a typed-in id). */
export async function statIdsByName(db) {
  const { statistics } = await loadCatalog(db);
  return new Map([...statistics.values()].filter((s) => s.name).map((s) => [s.name.toLowerCase(), s.id]));
}

/** What a rule decides for this guild: { level } (levelled), { hold, detail } (kept while held), { earn } (permanent). */
export function decide(def, f, ctx) {
  const r = def.rule;
  switch (r?.type) {
    case 'members':
    case 'stat-total': {
      const v = f.values.get(def.id);
      return { level: v === null || v === undefined ? 0 : levelFor(def.thresholds, v) };
    }
    case 'every-class': return { earn: f.classes.all.length > 0 && f.classes.missing.length === 0 };
    case 'board-champion': return { hold: f.champion.length > 0, detail: { boards: f.champion } };
    case 'top-ten': return { hold: f.topTen.length > 0, detail: { boards: f.topTen } };
    case 'weekly-champion': return { hold: f.weekly.length > 0, detail: { boards: f.weekly } };
    case 'strong-roster':
      return { hold: f.tierAverage !== null && f.tierLettered >= ctx.minMembers && f.tierAverage >= STRONG_ROSTER_MIN, detail: {} };
    case 'founding': return { earn: f.founding };
    case 'early-guild': return { earn: Boolean(f.early) };
    case 'verified': return { hold: f.verified, detail: {} };
    default: return {};
  }
}

/** Shared inputs for evaluating many guilds. */
export async function evaluationInputs(db) {
  const defs = await loadGuildDefinitions(db);
  const ctx = await guildBadgeContext(db);
  const classes = await classList(db, await loadPlayerDefinitions(db));
  const statIds = await statIdsByName(db);
  return { defs, ctx, classes, statIds };
}

/** Brings one guild's automatic badges up to date. → { changed: [{ badge, what }] } */
export async function evaluateGuild(db, guildId, { notify = true, actor = 'rule', inputs = null } = {}) {
  const inp = inputs ?? await evaluationInputs(db);
  const guild = await db.one('SELECT id, ruleset_id, first_seen_at, profile_fetched_at, totals_built_at FROM guilds WHERE id = $1', [guildId]);
  if (!guild) return { changed: [] };
  const f = await guildFacts(db, guild, inp);
  return db.tx(async (q) => {
    // One evaluation per guild at a time (a lock on our own award rows' parent would need a row; an advisory lock does).
    await q.query('SELECT pg_advisory_xact_lock(7101, $1::int)', [Number(guildId) % 2_000_000_000]);
    const changed = [];
    for (const def of inp.defs) {
      if (def.award !== 'automatic') continue;
      const d = decide(def, f, inp.ctx);
      let what = null;
      if (def.levelled) {
        if (d.level > 0) what = await raiseLevel(q, { guildId, def, level: d.level, notify, actor });
      } else if (def.kept_while_held) {
        what = d.hold ? await hold(q, { guildId, def, detail: d.detail, notify, actor }) : await lose(q, { guildId, def, notify, actor });
      } else if (d.earn) {
        what = await raiseLevel(q, { guildId, def, level: null, notify, actor });
      }
      if (what) changed.push({ badge: def.id, what });
    }
    return { changed };
  });
}

/** Never lets a badge problem fail what triggered it. */
export async function evaluateGuildQuietly(db, guildId) {
  try {
    return await evaluateGuild(db, guildId);
  } catch (err) {
    console.error(`[guild-badges] evaluation failed: ${err.code ?? err.name}`);
    return null;
  }
}

/** Evaluates many guilds with one read of the inputs. → { guilds, changes: { badge: { unlocked, level, … } } } */
export async function evaluateGuilds(db, ids, { notify = true, actor = 'rule' } = {}) {
  const inputs = await evaluationInputs(db);
  const out = { guilds: 0, changes: {} };
  for (const id of ids) {
    const r = await evaluateGuild(db, id, { notify, actor, inputs });
    out.guilds += 1;
    for (const c of r.changed) {
      out.changes[c.badge] ??= {};
      out.changes[c.badge][c.what] = (out.changes[c.badge][c.what] ?? 0) + 1;
    }
  }
  return out;
}

/** Every guild id, in pages (no unbounded select). */
export async function allGuildIds(db) {
  const ids = [];
  for (let after = -1; ;) {
    const rows = await db.query('SELECT id FROM guilds WHERE id > $1 ORDER BY id LIMIT 1000', [after]);
    if (!rows.length) return ids;
    for (const r of rows) ids.push(Number(r.id));
    after = rows[rows.length - 1].id;
  }
}

/**
 * The one-time back-fill on deploy: every guild Everstats knows, no toasts and no ribbons. Recorded in pipeline_facts
 * (so it runs once) and as a 'backfill' event with what it awarded (the admin Guild badges page shows it).
 */
export async function backfillGuildsOnce(db) {
  const done = await db.one("SELECT at FROM pipeline_facts WHERE key = 'guild_badges_backfilled_at'");
  if (done) return null;
  const result = await evaluateGuilds(db, await allGuildIds(db), { notify: false, actor: 'backfill' });
  const held = await db.query(
    "SELECT badge_id, coalesce(level, 0) AS level, count(*)::int AS n FROM guild_badge_awards WHERE state = 'held' GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 500",
  );
  await db.tx(async (q) => {
    const claimed = await q.query("INSERT INTO pipeline_facts (key, at) VALUES ('guild_badges_backfilled_at', now()) ON CONFLICT DO NOTHING RETURNING 1");
    if (claimed.length) await logGuildBadgeEvent(q, { type: 'backfill', actor: 'backfill', detail: { guilds: result.guilds, held: held.map((h) => ({ badge: h.badge_id, level: h.level || null, guilds: h.n })) } });
  });
  console.log(`[guild-badges] back-fill: ${result.guilds} guild(s)`);
  return result;
}
