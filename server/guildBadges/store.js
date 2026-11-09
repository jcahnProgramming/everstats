import { getSetting } from '../admin/settings.js';
import { periodOpen } from '../stats/periods.js';
import { HttpError } from '../core/errors.js';
import { DEFAULT_FAMILY_ORDER, LEVELS, RIBBON_DAYS, ROW_MAX, familyOf } from './catalog.js';

/**
 * Guild badge definitions, awards and what a page shows (0.7.1). Everstats' own data: an award row holds Blizzard ids
 * at most (a Standing badge's boards: statistic and ruleset ids), never a Blizzard value. Progress toward a level is
 * read LIVE from guild_totals / the tracked members (Blizzard-derived, so it follows the 30-day window with them) and
 * never stored.
 *
 * Display (Manage guild → Badges): the Guild Master and officers choose which unlocked badges show, their order and
 * the ONE pinned badge (it leads the row and sits beside the guild's name on boards and the /guilds list). They can
 * never award anything. A guild with no Guild Master on Everstats uses the automatic defaults: every held badge, by
 * family (Recognition, Standing, Roster, Deeds, Heritage), highest level first, the first one pinned.
 */
const DEF_COLUMNS = `d.id, d.family, d.name, d.description, d.how, d.art, d.template, d.levelled, d.measure, d.thresholds, d.award, d.rule,
  d.kept_while_held, d.time_limited, d.status_mark, d.sort, d.created_at, d.created_by`;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadGuildDefinitions(db) {
  const rows = await db.query(`SELECT ${DEF_COLUMNS} FROM guild_badge_definitions d ORDER BY d.sort, d.id LIMIT 500`);
  return rows.map(normalise);
}

export async function guildDefinitionById(db, id) {
  const row = await db.one(`SELECT ${DEF_COLUMNS} FROM guild_badge_definitions d WHERE d.id = $1`, [id]);
  return row ? normalise(row) : null;
}

function normalise(d) {
  return { ...d, thresholds: d.thresholds ? d.thresholds.map(Number) : null };
}

/** The Early Guild window from its admin setting: unset, upcoming, open or closed. */
export async function earlyGuildWindow(db, now = Date.now()) {
  const w = await getSetting(db, 'guildBadges.earlyWindow');
  if (!w) return { set: false };
  const startMs = Date.parse(`${w.start}T00:00:00Z`);
  const endMs = Date.parse(`${w.end}T00:00:00Z`) + DAY_MS;
  return { set: true, start: w.start, end: w.end, startMs, endMs, closed: now >= endMs, upcoming: now < startMs };
}

/** Every beta window (Founding Guild is for guilds first tracked inside one), and whether one is open now. */
export async function betaWindows(db) {
  const rows = await db.query('SELECT opened_at, closed_at FROM beta_windows ORDER BY opened_at LIMIT 50');
  return { windows: rows.map((r) => ({ openedAt: r.opened_at, closedAt: r.closed_at })), open: rows.some((r) => r.closed_at === null) };
}

export async function guildBadgeContext(db, now = Date.now()) {
  return {
    early: await earlyGuildWindow(db, now),
    beta: await betaWindows(db),
    minMembers: await getSetting(db, 'guilds.minMembers'),
    minBoardGuilds: await getSetting(db, 'guilds.minBoardGuilds'),
    // Whether the weekly boards are open (snapshots began before this week did), as the board pages decide it.
    weekOpen: periodOpen('week', (await db.one("SELECT at FROM pipeline_facts WHERE key = 'first_snapshot_at'"))?.at ?? null, now).open,
  };
}

/** A definition listed nowhere: Early Guild without a window. */
export const isUnlisted = (def, ctx) => def.rule?.type === 'early-guild' && !ctx.early.set;

/** The art file for a level (levelled badges have one drawing per level). */
export const artFor = (def, level) => (def.levelled ? `${def.art}-${Math.min(5, Math.max(1, level || 1))}` : def.art);

export const markUrl = (guildId, sha) => (sha ? `/api/guild-badges/marks/${guildId}.png?v=${sha.slice(0, 12)}` : null);

/** What any page may show about a badge at a level (and, for Partner Guild, with that guild's emblem). */
export function publicGuildBadge(def, { level = null, mark = null } = {}) {
  const lv = def.levelled ? LEVELS[(level || 1) - 1] : null;
  return {
    id: def.id,
    family: def.family,
    familyLabel: familyOf(def.family)?.label ?? def.family,
    name: def.name,
    description: def.description,
    how: def.how,
    art: artFor(def, level),
    template: def.template,
    award: def.award,
    levelled: def.levelled,
    level: def.levelled ? (level || null) : null,
    numeral: lv?.numeral ?? null,
    metal: lv?.metal ?? null,
    measure: def.measure,
    keptWhileHeld: def.kept_while_held,
    timeLimited: def.time_limited,
    statusMark: def.status_mark,
    mark,
  };
}

/** Next level and progress toward it: { level, threshold, value, toGo, pct } or null at V (or with no value). */
export function progressOf(def, level, value) {
  if (!def.levelled || value === null || value === undefined) return null;
  const next = (level || 0) + 1;
  if (next > 5) return null;
  const threshold = def.thresholds[next - 1];
  const prev = 0;
  const pct = threshold > prev ? Math.max(0, Math.min(1, (value - prev) / (threshold - prev))) : 0;
  return { level: next, numeral: LEVELS[next - 1].numeral, metal: LEVELS[next - 1].metal, threshold, value, toGo: Math.max(0, threshold - value), pct };
}

/** The highest level `value` reaches with these thresholds (0 = none). */
export function levelFor(thresholds, value) {
  let level = 0;
  for (const [i, t] of thresholds.entries()) if (Number.isFinite(value) && value >= t) level = i + 1;
  return level;
}

export async function logGuildBadgeEvent(q, { type, guildId = null, badgeId = null, level = null, actor, actorAccountId = null, notify = false, reason = null, detail = {} }) {
  await q.query(
    `INSERT INTO guild_badge_events (type, guild_id, badge_id, level, actor, actor_account_id, notify, reason, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [type, guildId, badgeId, level, actor, actorAccountId, notify, reason ? String(reason).slice(0, 500) : null, JSON.stringify(detail)],
  );
}

/**
 * Raises a levelled badge (or awards a permanent one: level null). Levels only go up. → 'unlocked' | 'level' | null.
 *   notify: a toast for the GM and officers and the 7-day ribbon (false for the back-fill).
 */
export async function raiseLevel(q, { guildId, def, level = null, notify, actor }) {
  const cur = await q.one('SELECT state, level FROM guild_badge_awards WHERE guild_id = $1 AND badge_id = $2 FOR UPDATE', [guildId, def.id]);
  if (cur && (!def.levelled || (cur.level ?? 0) >= level)) return null;
  const ribbon = notify ? 'now()' : 'NULL';
  if (!cur) {
    await q.query(
      `INSERT INTO guild_badge_awards (guild_id, badge_id, level, source, ribbon_at) VALUES ($1, $2, $3, 'automatic', ${ribbon})`,
      [guildId, def.id, def.levelled ? level : null],
    );
    await logGuildBadgeEvent(q, { type: 'unlocked', guildId, badgeId: def.id, level, actor, notify });
    return 'unlocked';
  }
  await q.query(`UPDATE guild_badge_awards SET level = $3, level_at = now(), ribbon_at = ${notify ? 'now()' : 'ribbon_at'} WHERE guild_id = $1 AND badge_id = $2`, [guildId, def.id, level]);
  await logGuildBadgeEvent(q, { type: 'level', guildId, badgeId: def.id, level, actor, notify });
  return 'level';
}

/** A kept-while-held badge the guild holds now: unlocked, regained, or its boards updated quietly. */
export async function hold(q, { guildId, def, detail = {}, notify, actor }) {
  const cur = await q.one('SELECT state, detail FROM guild_badge_awards WHERE guild_id = $1 AND badge_id = $2 FOR UPDATE', [guildId, def.id]);
  const json = JSON.stringify(detail);
  if (!cur) {
    await q.query(
      `INSERT INTO guild_badge_awards (guild_id, badge_id, source, detail, ribbon_at) VALUES ($1, $2, 'automatic', $3::jsonb, ${notify ? 'now()' : 'NULL'})`,
      [guildId, def.id, json],
    );
    await logGuildBadgeEvent(q, { type: 'unlocked', guildId, badgeId: def.id, actor, notify, detail });
    return 'unlocked';
  }
  if (cur.state === 'held') {
    if (JSON.stringify(cur.detail) !== json) await q.query('UPDATE guild_badge_awards SET detail = $3::jsonb WHERE guild_id = $1 AND badge_id = $2', [guildId, def.id, json]);
    return null;
  }
  if (cur.state === 'revoked') return null;
  await q.query(
    `UPDATE guild_badge_awards SET state = 'held', held_since = now(), lost_at = NULL, detail = $3::jsonb, ribbon_at = ${notify ? 'now()' : 'ribbon_at'}
      WHERE guild_id = $1 AND badge_id = $2`,
    [guildId, def.id, json],
  );
  await logGuildBadgeEvent(q, { type: 'regained', guildId, badgeId: def.id, actor, notify, detail });
  return 'regained';
}

/** A kept-while-held badge the guild no longer holds. The detail (which boards) stays, for "held [date] – [date]". */
export async function lose(q, { guildId, def, notify, actor, reason = null }) {
  const rows = await q.query(
    `UPDATE guild_badge_awards SET state = 'lost', lost_at = now(), pinned = false WHERE guild_id = $1 AND badge_id = $2 AND state = 'held' RETURNING 1`,
    [guildId, def.id],
  );
  if (!rows.length) return null;
  await logGuildBadgeEvent(q, { type: 'lost', guildId, badgeId: def.id, actor, notify, reason });
  return 'lost';
}

/** Holder counts: per badge (held), and per level for levelled badges. */
export async function guildHolderCounts(db) {
  const rows = await db.query(
    "SELECT badge_id, level, count(*)::int AS n FROM guild_badge_awards WHERE state = 'held' GROUP BY badge_id, level LIMIT 5000",
  );
  const total = new Map();
  const byLevel = new Map();
  for (const r of rows) {
    total.set(r.badge_id, (total.get(r.badge_id) ?? 0) + r.n);
    if (r.level !== null) byLevel.set(`${r.badge_id}:${r.level}`, r.n);
  }
  return { total, byLevel };
}

const familyRank = (f) => {
  const i = DEFAULT_FAMILY_ORDER.indexOf(f);
  return i < 0 ? 99 : i;
};
/** The automatic default order: family, then highest level, then the catalog's order. */
export const defaultOrder = (a, b) => (familyRank(a.family) - familyRank(b.family)) || ((b.level ?? 0) - (a.level ?? 0)) || (a.sort - b.sort) || a.id.localeCompare(b.id);

/** Held awards of a guild joined to their definitions (status marks included; callers filter). */
export async function guildAwards(db, guildId, { states = ['held'] } = {}) {
  const rows = await db.query(
    `SELECT ${DEF_COLUMNS}, a.state, a.level, a.first_at, a.level_at, a.held_since, a.lost_at, a.source, a.reason, a.detail, a.ribbon_at,
            a.shown, a.position, a.pinned
       FROM guild_badge_awards a JOIN guild_badge_definitions d ON d.id = a.badge_id
      WHERE a.guild_id = $1 AND a.state = ANY($2::text[]) ORDER BY d.sort LIMIT 500`,
    [guildId, states],
  );
  return rows.map(normalise);
}

/** A Featured Guild award past its "show until" date stays held but isn't shown. */
export const featuredExpired = (a, now = Date.now()) => a.id === 'featured-guild' && a.detail?.until && Date.parse(`${a.detail.until}T00:00:00Z`) + DAY_MS <= now;

/**
 * The public row: { row (≤ ROW_MAX, pinned first), more, pinned, automatic (no GM: defaults) }. Status marks (Verified)
 * never take a slot. `managed`: the guild has a Guild Master on Everstats, so the stored choices apply.
 */
export function arrange(awards, { managed, now = Date.now() }) {
  const visible = awards.filter((a) => a.state === 'held' && !a.status_mark && !featuredExpired(a, now));
  let list;
  let pinned;
  if (!managed) {
    list = [...visible].sort(defaultOrder);
    pinned = list[0] ?? null;
  } else {
    const defaults = [...visible].sort(defaultOrder);
    const rank = new Map(defaults.map((a, i) => [a.id, i]));
    list = visible.filter((a) => a.shown).sort((a, b) => ((a.position ?? 1000 + rank.get(a.id)) - (b.position ?? 1000 + rank.get(b.id))));
    // The pin falls back to the next shown badge when the pinned one is lost or hidden (manage-picker.md).
    pinned = list.find((a) => a.pinned) ?? list[0] ?? null;
  }
  if (pinned) list = [pinned, ...list.filter((a) => a !== pinned)];
  return { row: list.slice(0, ROW_MAX), more: list.slice(ROW_MAX), pinned, automatic: !managed };
}

export const ribbonOn = (a, now = Date.now()) => Boolean(a.ribbon_at) && now - Date.parse(a.ribbon_at) < RIBBON_DAYS * DAY_MS;

/** Partner marks for some guilds: Map(guildId → url). */
export async function partnerMarks(db, guildIds) {
  if (!guildIds.length) return new Map();
  const rows = await db.query('SELECT guild_id, mark_sha FROM guild_partner_marks WHERE guild_id = ANY($1::bigint[]) AND mark_sha IS NOT NULL LIMIT 1000', [guildIds]);
  return new Map(rows.map((r) => [Number(r.guild_id), markUrl(r.guild_id, r.mark_sha)]));
}

/**
 * The pinned badge and the Verified mark for many guilds at once (boards, /guilds, search). → Map(guildId → { badge,
 * verified }). A guild with a Guild Master uses its own pin; one without uses the default.
 */
export async function guildInlineBadges(db, guildIds) {
  const ids = [...new Set(guildIds.filter((x) => x !== null && x !== undefined).map(Number))];
  if (!ids.length) return new Map();
  const rows = (await db.query(
    `SELECT a.guild_id, ${DEF_COLUMNS}, a.state, a.level, a.detail, a.shown, a.position, a.pinned
       FROM guild_badge_awards a JOIN guild_badge_definitions d ON d.id = a.badge_id
      WHERE a.guild_id = ANY($1::bigint[]) AND a.state = 'held' LIMIT 20000`,
    [ids],
  )).map(normalise);
  const managed = new Set((await db.query(
    `SELECT DISTINCT gr.guild_id FROM guild_roster gr JOIN characters c ON c.id = gr.character_id
      WHERE gr.guild_id = ANY($1::bigint[]) AND gr.rank = 0 AND c.owner_account_id IS NOT NULL LIMIT 5000`,
    [ids],
  )).map((r) => Number(r.guild_id)));
  const marks = await partnerMarks(db, ids);
  const by = new Map();
  for (const r of rows) {
    const id = Number(r.guild_id);
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  const out = new Map();
  for (const [id, list] of by) {
    const { pinned } = arrange(list, { managed: managed.has(id) });
    const verified = list.some((a) => a.status_mark);
    out.set(id, {
      badge: pinned ? publicGuildBadge(pinned, { level: pinned.level, mark: pinned.template === 'partner-guild' ? marks.get(id) ?? null : null }) : null,
      verified,
    });
  }
  return out;
}

/**
 * The Guild Master's and officers' choices: { order: [ids], shown: [ids], pinned: id | null }. Every id must be a
 * badge the guild HOLDS (a lost one can't be shown or pinned), never the Verified mark; pinned ∈ shown.
 */
export async function setGuildDisplay(q, guildId, body) {
  const held = new Set((await q.query(
    `SELECT a.badge_id FROM guild_badge_awards a JOIN guild_badge_definitions d ON d.id = a.badge_id
      WHERE a.guild_id = $1 AND a.state = 'held' AND NOT d.status_mark LIMIT 500`,
    [guildId],
  )).map((r) => r.badge_id));
  const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : null);
  const order = list(body?.order);
  const shown = list(body?.shown);
  const pinned = body?.pinned ?? null;
  if (!order || !shown) throw new HttpError(400, 'Say which badges show and in what order.', 'invalid');
  for (const id of [...order, ...shown, ...(pinned ? [pinned] : [])]) {
    if (!held.has(id)) throw new HttpError(400, 'Only badges the guild holds right now can be shown or pinned.', 'invalid');
  }
  if (pinned !== null && (typeof pinned !== 'string' || !shown.includes(pinned))) throw new HttpError(400, 'Pin a badge that’s shown.', 'invalid');
  await q.query('UPDATE guild_badge_awards SET shown = false, pinned = false, position = NULL WHERE guild_id = $1', [guildId]);
  for (const [i, id] of order.entries()) await q.query('UPDATE guild_badge_awards SET position = $3 WHERE guild_id = $1 AND badge_id = $2', [guildId, id, i + 1]);
  if (shown.length) await q.query('UPDATE guild_badge_awards SET shown = true WHERE guild_id = $1 AND badge_id = ANY($2::text[])', [guildId, shown]);
  if (pinned) await q.query('UPDATE guild_badge_awards SET pinned = true WHERE guild_id = $1 AND badge_id = $2', [guildId, pinned]);
}

/** Validates an id the admin typed for a new definition. */
export function definitionId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(id) || id.includes('--') || id.endsWith('-')) throw new HttpError(400, 'An id is 2–48 lower-case letters, digits and single hyphens, starting with a letter.', 'invalid');
  return id;
}

export { ROW_MAX, RIBBON_DAYS };
