import { getSetting } from '../admin/settings.js';
import { BUDGET_SHARES, PRIORITY, enqueue } from '../crawler/queue.js';
import { markGuildsDirty } from '../crawler/store.js';
import { TRACKED_MEMBER } from '../stats/guildTotals.js';
import { requestTierRecompute } from '../tiers/store.js';

/**
 * "Fetch all members" (0.9.0): pull a whole guild in on demand instead of waiting for the daily roster seeding.
 *
 *   Step 1 (readRoster)  the guild's profile + roster, at PRIORITY.lookup (a person is waiting; 2 requests). When the
 *                        roster lands (crawler/fetch.js → noteRoster), its untracked level-10+ members become this
 *                        fetch's work list (guild_fetch_members: id + slug, the only place their slugs are kept) and the
 *                        page shows the counts and the honest cost: ~REQUESTS_PER_MEMBER requests a member.
 *   Step 2 (startFetch)  the person confirms: the fetch is queued. The worker job 'guild-fetch' (runGuildFetches)
 *                        starts at most guilds.fetchConcurrent at once, site-wide, and feeds each running fetch's
 *                        members to the crawler a batch at a time (batchFor) at PRIORITY.guild. Nothing waits on a request, so
 *                        nothing can time out, and leaving the page cancels nothing.
 *   Done                 when every member's crawl item has finished: the guild is marked dirty (totals, then guild
 *                        badges, rebuild from it), a full tier grading is requested (debounced like any burst), and the
 *                        work list is deleted. The button then rests guilds.fetchCooldownHours for that guild.
 *
 * Fairness (crawler/service.js, crawler/budget.js): a guild fetch never delays a lookup (lookups sort first and keep a
 * slot), holds at most GUILD_SLOTS crawler slots, and its requests never use more than half the budget.
 * Hidden characters are never queued and appear in no count; a member Blizzard 404s is recorded the usual way
 * (crawler/fetch.js) and counted as "not found".
 */
export const REQUESTS_PER_MEMBER = 5; // profile, statistics, attributes, equipment, character-media
export const ROSTER_REQUESTS = 2;
export const MIN_BATCH = 8;
/** Members handed to the crawler per running fetch: enough for one worker tick (30 s) and a half at the guild rate. */
export const batchFor = (perSecond, tickMs = 30_000) => Math.max(MIN_BATCH, Math.ceil((perSecond * (tickMs / 1000) * 1.5) / REQUESTS_PER_MEMBER));
export const READY_TTL_MS = 30 * 60 * 1000; // a roster read nobody started goes stale
export const ROSTER_TTL_MS = 10 * 60 * 1000; // a roster read that never came back
export const DONE_SHOWN_MS = 10 * 60 * 1000; // "37 members added" stays this long before the page says "cooling down"
const MIN_LEVEL = 10;
const LIVE = "('roster', 'ready', 'queued', 'running')";
const HOUR = 60 * 60 * 1000;

export class FetchAllError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Requests per second a guild fetch can use: half the crawler's budget. */
export async function guildRate(db) {
  return (await getSetting(db, 'crawler.requestsPerSecond')) * (BUDGET_SHARES[PRIORITY.guild] ?? 1);
}

const liveRow = (db, slug) => db.one(`SELECT * FROM guild_fetches WHERE slug = $1 AND state IN ${LIVE} ORDER BY id DESC LIMIT 1`, [slug]);

async function lastDone(db, guildId) {
  if (guildId === null || guildId === undefined) return null;
  return db.one("SELECT * FROM guild_fetches WHERE guild_id = $1 AND state = 'done' ORDER BY finished_at DESC LIMIT 1", [guildId]);
}

/** When the guild's button opens again (Date), or null when it is open now. */
async function cooldownUntil(db, guildId, now) {
  const done = await lastDone(db, guildId);
  if (!done?.finished_at) return null;
  const until = new Date(new Date(done.finished_at).getTime() + (await getSetting(db, 'guilds.fetchCooldownHours')) * HOUR);
  return until.getTime() > now ? until : null;
}

async function memberCounts(db, fetchId) {
  const rows = await db.query('SELECT state, count(*)::int AS n FROM guild_fetch_members WHERE fetch_id = $1 GROUP BY state LIMIT 5', [fetchId]);
  const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
  return { waiting: by.waiting ?? 0, queued: by.queued ?? 0, done: by.done ?? 0 };
}

const countsOf = (row) => ({ roster: row.roster_members, tracked: row.tracked_before, toFetch: row.to_fetch, underTen: row.under_ten });

/**
 * What the guild page shows. state:
 *   idle      nothing running; the button is offered (step 1 reads the roster)
 *   roster    step 1: reading Blizzard's roster
 *   ready     the roster is in: counts and the cost, waiting for "Start"
 *   queued    started, waiting for a free slot: `ahead` guilds before it
 *   running   members being fetched: progress and an estimate
 *   done      finished in the last few minutes: what it added (the button rests until availableAt)
 *   cooldown  finished earlier; the button opens at availableAt
 *   failed    step 1 didn't work (the reason in words); the button is offered again
 */
export async function fetchStatus(db, { slug, guildId = null, now = Date.now() }) {
  const perSecond = await guildRate(db);
  const paused = await getSetting(db, 'crawler.paused');
  const base = { perSecond, paused, requestsPerMember: REQUESTS_PER_MEMBER, rosterRequests: ROSTER_REQUESTS };
  const row = await liveRow(db, slug);
  if (row) {
    const counts = countsOf(row);
    if (row.state === 'roster') return { ...base, state: 'roster', since: row.requested_at };
    const cost = { requests: (row.to_fetch ?? 0) * REQUESTS_PER_MEMBER, seconds: Math.ceil(((row.to_fetch ?? 0) * REQUESTS_PER_MEMBER) / perSecond) };
    if (row.state === 'ready') return { ...base, state: 'ready', counts, cost, rosterAt: row.roster_at, expiresAt: new Date(new Date(row.roster_at).getTime() + READY_TTL_MS) };
    if (row.state === 'queued') {
      const cap = await getSetting(db, 'guilds.fetchConcurrent');
      const q = await db.one(
        `SELECT count(*) FILTER (WHERE state = 'queued' AND (queued_at, id) < ($1, $2))::int AS ahead,
                count(*) FILTER (WHERE state = 'running')::int AS running
           FROM guild_fetches WHERE state IN ('queued', 'running')`,
        [row.queued_at, row.id],
      );
      // It starts once a running fetch ends (when all slots are taken) and every fetch queued before it has started.
      const ahead = q.ahead + Math.max(0, q.running - cap + 1);
      return { ...base, state: 'queued', counts, cost, ahead, queuedAt: row.queued_at };
    }
    const m = await memberCounts(db, row.id);
    const total = row.to_fetch ?? 0;
    const remaining = m.waiting + m.queued;
    return {
      ...base, state: 'running', counts, cost, startedAt: row.started_at,
      progress: { done: m.done, total, remaining, seconds: Math.ceil((remaining * REQUESTS_PER_MEMBER) / perSecond) },
    };
  }
  const done = await lastDone(db, guildId);
  if (done) {
    const until = new Date(new Date(done.finished_at).getTime() + (await getSetting(db, 'guilds.fetchCooldownHours')) * HOUR);
    if (until.getTime() > now) {
      return {
        ...base,
        state: now - new Date(done.finished_at).getTime() < DONE_SHOWN_MS ? 'done' : 'cooldown',
        counts: countsOf(done),
        result: { added: done.added ?? 0, fetched: done.fetched, notFound: done.not_found, failed: done.failed, total: done.to_fetch },
        finishedAt: done.finished_at,
        availableAt: until,
      };
    }
  }
  const failed = await db.one(
    "SELECT problem, finished_at FROM guild_fetches WHERE slug = $1 AND state = 'failed' AND finished_at > $2 ORDER BY id DESC LIMIT 1",
    [slug, new Date(now - ROSTER_TTL_MS)],
  );
  if (failed) return { ...base, state: 'failed', problem: failed.problem };
  return { ...base, state: 'idle' };
}

/**
 * Step 1: queue the guild's profile + roster at lookup priority (the caller waits on the item). A guild already being
 * fetched answers with that fetch; a guild resting after a fetch is refused with when it opens.
 * → { row, itemId | null }
 */
export async function readRoster(db, { slug, guildId = null, now = Date.now() }) {
  const live = await liveRow(db, slug);
  if (live && live.state !== 'ready') return { row: live, itemId: null };
  const until = await cooldownUntil(db, guildId, now);
  if (until) throw new FetchAllError('cooldown', `This guild was fetched recently. It can be fetched again from ${until.toISOString()}.`);
  return db.tx(async (q) => {
    // Reading it again (the old counts went stale): the same row goes back to step 1.
    if (live) {
      await q.query('DELETE FROM guild_fetch_members WHERE fetch_id = $1', [live.id]);
      await q.query("UPDATE guild_fetches SET state = 'roster', requested_at = now(), roster_at = NULL WHERE id = $1", [live.id]);
    }
    const row = live
      ? await q.one('SELECT * FROM guild_fetches WHERE id = $1', [live.id])
      : await q.one("INSERT INTO guild_fetches (guild_id, slug, state) VALUES ($1, $2, 'roster') RETURNING *", [guildId, slug]);
    const item = await enqueue(q, { kind: 'guild', key: slug, priority: PRIORITY.lookup });
    return { row, itemId: item.id };
  });
}

/** Step 1 didn't come back (Blizzard didn't answer the waiting look-up): said in words, the button is offered again. */
export async function rosterFailed(db, fetchId, problem) {
  await db.query("UPDATE guild_fetches SET state = 'failed', finished_at = now(), problem = $2 WHERE id = $1 AND state = 'roster'", [fetchId, String(problem).slice(0, 200)]);
}

/**
 * Called by the crawler's guild item (crawler/fetch.js) after it stored a roster, or with members = null when
 * Blizzard serves no guild (or no roster) at that slug. Fills in every step-1 fetch waiting for this guild.
 */
export async function noteRoster(q, { key, guild = null, members = null, problem = null }) {
  const keys = [...new Set([String(key).toLowerCase(), guild?.slug].filter(Boolean))];
  const rows = await q.query(
    "SELECT id FROM guild_fetches WHERE state = 'roster' AND (slug = ANY($1::text[]) OR ($2::bigint IS NOT NULL AND guild_id = $2)) LIMIT 10",
    [keys, guild?.id ?? null],
  );
  if (!rows.length) return 0;
  if (!members) {
    await q.query("UPDATE guild_fetches SET state = 'failed', finished_at = now(), problem = $2 WHERE id = ANY($1::bigint[])", [rows.map((r) => r.id), problem ?? 'Blizzard sent no roster for this guild.']);
    return rows.length;
  }
  const g = await q.one('SELECT id, ruleset_id FROM guilds WHERE id = $1', [guild.id]);
  const tracked = g?.ruleset_id === null || !g ? [] : await q.query(`SELECT c.id FROM characters c WHERE ${TRACKED_MEMBER} LIMIT 5000`, [g.id, g.ruleset_id]);
  const trackedIds = new Set(tracked.map((r) => Number(r.id)));
  const eligible = members.filter((m) => Number.isInteger(m.level) && m.level >= MIN_LEVEL);
  // Hidden by their player: never fetched by this, and in no count here.
  const hidden = new Set((await q.query('SELECT id FROM characters WHERE id = ANY($1::bigint[]) AND hidden LIMIT 5000', [eligible.map((m) => m.id)])).map((r) => Number(r.id)));
  const toFetch = eligible.filter((m) => !trackedIds.has(Number(m.id)) && !hidden.has(Number(m.id)));
  const underTen = members.filter((m) => Number.isInteger(m.level) && m.level < MIN_LEVEL).length;
  const [first, ...others] = rows.map((r) => r.id);
  // Only one live fetch per guild: any other step-1 row for it (an old address) is closed.
  if (others.length) await q.query("UPDATE guild_fetches SET state = 'expired', finished_at = now() WHERE id = ANY($1::bigint[])", [others]);
  await q.query(
    `UPDATE guild_fetches SET state = 'ready', guild_id = $2, slug = $3, roster_at = now(), roster_members = $4, tracked_before = $5, to_fetch = $6, under_ten = $7
      WHERE id = $1`,
    [first, guild.id, guild.slug, members.length, trackedIds.size, toFetch.length, underTen],
  );
  if (toFetch.length) {
    await q.query(
      `INSERT INTO guild_fetch_members (fetch_id, character_id, slug) SELECT $1, v.id, v.slug FROM unnest($2::bigint[], $3::text[]) AS v(id, slug)
       ON CONFLICT DO NOTHING`,
      [first, toFetch.map((m) => m.id), toFetch.map((m) => m.slug)],
    );
  }
  return rows.length;
}

/** Step 2: the person confirmed the cost. → the fetch row, now queued. */
export async function startFetch(db, { slug, now = Date.now() }) {
  const row = await liveRow(db, slug);
  if (!row || row.state === 'roster') throw new FetchAllError('no_roster', 'Read the roster first.');
  if (row.state === 'queued' || row.state === 'running') return row; // pressing it again shows the running one
  if (now - new Date(row.roster_at).getTime() > READY_TTL_MS) throw new FetchAllError('stale', 'That roster count is out of date. Read it again first.');
  if (!row.to_fetch) throw new FetchAllError('nothing', 'Every level 10+ member is already tracked.');
  const until = await cooldownUntil(db, row.guild_id, now);
  if (until) throw new FetchAllError('cooldown', `This guild was fetched recently. It can be fetched again from ${until.toISOString()}.`);
  return db.one("UPDATE guild_fetches SET state = 'queued', queued_at = now() WHERE id = $1 AND state = 'ready' RETURNING *", [row.id]);
}

/**
 * The worker job body (every few seconds): expire stale step-1 rows, start queued fetches up to the site-wide cap,
 * feed each running fetch's members to the crawler, and finish the ones whose members are all done. → summary text.
 */
export async function runGuildFetches(db) {
  await db.query(
    "UPDATE guild_fetches SET state = 'expired', finished_at = now() WHERE state = 'ready' AND roster_at < now() - ($1 || ' milliseconds')::interval",
    [String(READY_TTL_MS)],
  );
  await db.query("DELETE FROM guild_fetch_members m USING guild_fetches f WHERE f.id = m.fetch_id AND f.state IN ('expired', 'failed')");
  await db.query(
    `UPDATE guild_fetches SET state = 'failed', finished_at = now(), problem = 'Blizzard didn’t send the roster in time. Try again.'
      WHERE state = 'roster' AND requested_at < now() - ($1 || ' milliseconds')::interval`,
    [String(ROSTER_TTL_MS)],
  );
  if (await getSetting(db, 'crawler.paused')) return 'Paused with the background crawl';

  const cap = await getSetting(db, 'guilds.fetchConcurrent');
  const running = (await db.one("SELECT count(*)::int AS n FROM guild_fetches WHERE state = 'running'")).n;
  if (running < cap) {
    await db.query(
      `UPDATE guild_fetches SET state = 'running', started_at = now()
        WHERE id IN (SELECT id FROM guild_fetches WHERE state = 'queued' ORDER BY queued_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)`,
      [cap - running],
    );
  }
  const active = await db.query("SELECT * FROM guild_fetches WHERE state = 'running' ORDER BY started_at LIMIT 20");
  const batch = batchFor(await guildRate(db));
  let fed = 0;
  let finished = 0;
  for (const f of active) {
    const r = await stepFetch(db, f, batch);
    fed += r.fed;
    if (r.finished) finished += 1;
  }
  const queued = (await db.one("SELECT count(*)::int AS n FROM guild_fetches WHERE state = 'queued'")).n;
  if (!active.length && !queued) return 'No guild fetches';
  return `${active.length - finished} running, ${queued} queued; ${fed} member(s) handed to the crawler, ${finished} finished`;
}

async function stepFetch(db, f, batch) {
  // Members whose crawl item has finished (or was swept: an hour after it finished).
  const queued = await db.query(
    `SELECT m.character_id, q.state AS q_state, q.outcome FROM guild_fetch_members m LEFT JOIN crawl_queue q ON q.id = m.crawl_id
      WHERE m.fetch_id = $1 AND m.state = 'queued' LIMIT 1000`,
    [f.id],
  );
  for (const m of queued) {
    if (m.q_state === 'queued' || m.q_state === 'running') continue;
    await db.query("UPDATE guild_fetch_members SET state = 'done', done_at = now(), outcome = $3 WHERE fetch_id = $1 AND character_id = $2",
      [f.id, m.character_id, m.q_state === 'failed' ? `failed: ${m.outcome ?? ''}`.slice(0, 200) : (m.outcome ?? 'done')]);
  }
  // A member hidden by its player since the roster was read: not fetched.
  await db.query(
    `UPDATE guild_fetch_members m SET state = 'done', done_at = now(), outcome = 'hidden'
      FROM characters c WHERE c.id = m.character_id AND c.hidden AND m.fetch_id = $1 AND m.state = 'waiting'`,
    [f.id],
  );
  const counts = await memberCounts(db, f.id);
  let fed = 0;
  const room = batch - counts.queued;
  if (room > 0 && counts.waiting > 0) {
    const next = await db.query("SELECT character_id, slug FROM guild_fetch_members WHERE fetch_id = $1 AND state = 'waiting' ORDER BY character_id LIMIT $2", [f.id, room]);
    for (const m of next) {
      const item = await enqueue(db, { kind: 'character', key: m.slug, priority: PRIORITY.guild, mode: 'full' });
      await db.query("UPDATE guild_fetch_members SET state = 'queued', crawl_id = $3 WHERE fetch_id = $1 AND character_id = $2", [f.id, m.character_id, item.id]);
      fed += 1;
    }
  }
  const tally = await db.one(
    `SELECT count(*) FILTER (WHERE state = 'done' AND outcome NOT LIKE 'failed%' AND outcome NOT IN ('not_found', 'hidden'))::int AS fetched,
            count(*) FILTER (WHERE state = 'done' AND outcome = 'not_found')::int AS not_found,
            count(*) FILTER (WHERE state = 'done' AND outcome LIKE 'failed%')::int AS failed,
            count(*) FILTER (WHERE state <> 'done')::int AS open
       FROM guild_fetch_members WHERE fetch_id = $1`,
    [f.id],
  );
  await db.query('UPDATE guild_fetches SET fetched = $2, not_found = $3, failed = $4 WHERE id = $1', [f.id, tally.fetched, tally.not_found, tally.failed]);
  if (tally.open > 0) return { fed, finished: false };

  await db.tx(async (q) => {
    const g = await q.one('SELECT id, ruleset_id FROM guilds WHERE id = $1', [f.guild_id]);
    const added = g && g.ruleset_id !== null
      ? (await q.one(
        `SELECT count(*)::int AS n FROM characters c WHERE ${TRACKED_MEMBER} AND c.id IN (SELECT character_id FROM guild_fetch_members WHERE fetch_id = $3)`,
        [g.id, g.ruleset_id, f.id],
      )).n
      : 0;
    await q.query("UPDATE guild_fetches SET state = 'done', finished_at = now(), added = $2 WHERE id = $1", [f.id, added]);
    await q.query('DELETE FROM guild_fetch_members WHERE fetch_id = $1', [f.id]);
    // Totals rebuild from the new members (the guild-totals job), guild badges follow the rebuilt totals, and one
    // full grading places everyone (debounced: a burst of fetches is one grading).
    await markGuildsDirty(q, [f.guild_id]);
    await requestTierRecompute(q, 'guild fetch');
  });
  return { fed, finished: true };
}
