import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { pageLimit } from '../core/db.js';
import { PRIMARY_SCOPE } from '../core/config.js';
import { categoryLabel, regionById, versionById } from '../core/gameVersions.js';
import { getSetting } from './settings.js';

/**
 * 0.10.3: Directory › Characters and Guilds (design/v5-admin pages/directory-characters, directory-guilds, guild-links).
 * Behind the admin gate (admin/routes.js mounts it after the gate): a plain 404 without an admin session. Moderators
 * never reach it (their gate is /api/admin/moderation only).
 *
 *   GET /directory/counts?v=&r=            the tab counts: accounts (global), characters and guilds of the version
 *   GET /directory/characters?v=&r=&…      every tracked character of one version + region, filtered, keyset-paged
 *   GET /directory/guilds?v=&r=&…          every guild of one version + region, filtered, keyset-paged
 *   GET /directory/guilds/:id              one guild's header and ALL its links (removed ones too) with their reports
 *
 * Read only: there are no admin character actions (the public page has the only Refresh). Hidden characters ARE listed
 * here, marked, because the admin sees everything; they stay off every public list. Purged rows (stubs of our own data
 * after Blizzard's data aged out) are not listed: there is nothing of Blizzard's left to show.
 *
 * Never selected, never sent: character position, bind_position, wow_account (they aren't stored anywhere; the gold
 * table has fixed columns and none of them). Every query is bounded (LIMIT + keyset cursor).
 */
const LETTERS = ['S', 'A', 'B', 'C', 'D'];
const FETCHED = { day: '1 day', week: '7 days' };

/** ?v=&r= → a registry scope (unknown values fall back to the primary scope: never interpolated unchecked). */
export function scopeOf(query) {
  const v = versionById(query?.v) ? String(query.v) : PRIMARY_SCOPE.version;
  const r = regionById(query?.r) ? String(query.r) : PRIMARY_SCOPE.region;
  return { version: v, region: r, primary: v === PRIMARY_SCOPE.version && r === PRIMARY_SCOPE.region };
}

const enc = (parts) => Buffer.from(JSON.stringify(parts)).toString('base64url');
function dec(raw, shape) {
  if (typeof raw !== 'string' || !raw || raw.length > 400) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Array.isArray(v) && v.length === shape.length && v.every((x, i) => typeof x === shape[i]) ? v : null;
  } catch {
    return null;
  }
}
const str = (v, max = 60) => (typeof v === 'string' ? v.normalize('NFC').trim().slice(0, max) : '');
const likeOf = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const intOf = (v, lo, hi) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};

/** Builds a WHERE with numbered parameters. */
function whereBuilder(initial = []) {
  const params = [...initial];
  const parts = [];
  return {
    params,
    add(sql, ...values) {
      let out = sql;
      for (const v of values) {
        params.push(v);
        out = out.replace('?', `$${params.length}`);
      }
      parts.push(out);
    },
    sql: () => (parts.length ? parts.join(' AND ') : 'true'),
  };
}

async function characterPage(db, query) {
  const scope = scopeOf(query);
  const limit = pageLimit(query.limit, { fallback: 50, max: 100 });
  const w = whereBuilder();
  w.add('c.game_version = ?', scope.version);
  w.add('c.region = ?', scope.region);
  w.add("c.profile_state <> 'purged'");
  const filters = {};

  const q = str(query.q).toLowerCase().replace(/^@/, '');
  if (q) {
    filters.q = q;
    const like = `${likeOf(q)}%`;
    const any = `%${likeOf(q)}%`;
    w.add(`(c.slug LIKE ? OR lower(c.name) LIKE ? OR lower(c.surname) LIKE ? OR c.realm_slug LIKE ?
            OR c.owner_account_id IN (SELECT a.id FROM accounts a WHERE a.username_claimed AND a.username LIKE ?))`, like, any, any, like, like);
  }
  const realm = str(query.realm, 80).toLowerCase();
  if (realm) {
    filters.realm = realm;
    w.add('c.realm_slug = ?', realm);
  }
  const ruleset = intOf(query.ruleset, 1, 2_147_483_647);
  if (ruleset !== null) {
    filters.ruleset = ruleset;
    w.add('c.ruleset_id = ?', ruleset);
  }
  const levelMin = intOf(query.levelMin, 1, 1000);
  const levelMax = intOf(query.levelMax, 1, 1000);
  if (levelMin !== null) {
    filters.levelMin = levelMin;
    w.add('c.level >= ?', levelMin);
  }
  if (levelMax !== null) {
    filters.levelMax = levelMax;
    w.add('c.level <= ?', levelMax);
  }
  const tier = String(query.tier ?? '');
  if (LETTERS.includes(tier)) {
    filters.tier = tier;
    w.add('t.letter = ?', tier);
  } else if (tier === 'unranked') {
    filters.tier = tier;
    w.add('t.letter IS NULL');
  }
  if (query.visibility === 'hidden' || query.visibility === 'public') {
    filters.visibility = query.visibility;
    w.add(query.visibility === 'hidden' ? 'c.hidden' : 'NOT c.hidden');
  }
  if (query.claimed === 'claimed' || query.claimed === 'unclaimed') {
    filters.claimed = query.claimed;
    w.add(query.claimed === 'claimed' ? 'c.owner_account_id IS NOT NULL' : 'c.owner_account_id IS NULL');
  }
  if (Object.hasOwn(FETCHED, query.fetched)) {
    filters.fetched = query.fetched;
    w.add('c.last_fetched_at >= now() - ?::interval', FETCHED[query.fetched]);
  } else if (query.fetched === 'older') {
    filters.fetched = 'older';
    w.add("c.last_fetched_at < now() - interval '7 days'");
  } else if (query.fetched === 'never') {
    filters.fetched = 'never';
    w.add('c.last_fetched_at IS NULL');
  }

  const from = 'FROM characters c LEFT JOIN character_tiers t ON t.character_id = c.id';
  const total = (await db.one(`SELECT count(*)::int AS n ${from} WHERE ${w.sql()}`, w.params)).n;

  // Newest tracked first; the cursor is (tracked_since, id) of the last row.
  const cur = dec(query.cursor, ['string', 'number']);
  if (cur) w.add('(c.tracked_since, c.id) < (?::timestamptz, ?::bigint)', cur[0], cur[1]);
  w.params.push(limit + 1);
  const rows = await db.query(
    `SELECT c.id, c.slug, c.name, c.surname, c.realm_slug, c.level, c.class, c.race, c.faction, c.hidden, c.profile_state,
            c.missing_since, c.last_fetched_at, c.last_checked_at, c.tracked_since, c.owner_account_id, c.ruleset_id,
            rs.name AS ruleset_name, rl.name AS realm_name, t.letter, t.reason AS tier_reason,
            a.username, a.username_claimed
       FROM characters c
       LEFT JOIN character_tiers t ON t.character_id = c.id
       LEFT JOIN rulesets rs ON rs.id = c.ruleset_id
       LEFT JOIN realms rl ON rl.game_version = c.game_version AND rl.region = c.region AND rl.slug = c.realm_slug
       LEFT JOIN accounts a ON a.id = c.owner_account_id
      WHERE ${w.sql()}
      ORDER BY c.tracked_since DESC, c.id DESC LIMIT $${w.params.length}`,
    w.params,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    scope: { version: scope.version, region: scope.region },
    categoryWord: categoryLabel(scope.version),
    filters,
    total,
    characters: page.map((c) => ({
      id: Number(c.id), slug: c.slug, name: c.name, surname: c.surname, realm: c.realm_slug ? { slug: c.realm_slug, name: c.realm_name ?? null } : null,
      ruleset: c.ruleset_id === null ? null : { id: Number(c.ruleset_id), name: c.ruleset_name ?? null },
      level: c.level, class: c.class, race: c.race, faction: c.faction,
      hidden: c.hidden, state: c.missing_since ? 'missing' : c.profile_state, missingSince: c.missing_since,
      lastFetchedAt: c.last_fetched_at, lastCheckedAt: c.last_checked_at, trackedSince: c.tracked_since,
      tier: c.letter ? { letter: c.letter } : c.tier_reason ? { letter: null, reason: c.tier_reason } : null,
      owner: c.owner_account_id === null ? null : { id: Number(c.owner_account_id), username: c.username_claimed ? c.username : null },
      // Only the primary version has public pages before 0.11.0; a hidden character's page is a 404 for everyone.
      publicPath: scope.primary && c.slug && !c.hidden && c.profile_state === 'ok' ? `/c/${encodeURIComponent(c.slug)}` : null,
    })),
    next: rows.length > limit && last ? enc([new Date(last.tracked_since).toISOString(), Number(last.id)]) : null,
  };
}

async function characterFacets(db, scope) {
  const rulesets = await db.query('SELECT id, name FROM rulesets WHERE game_version = $1 AND region = $2 ORDER BY name, id LIMIT 50', [scope.version, scope.region]);
  // Internal/test realms (realms.excluded, 0.10.1) are never crawled, so no character can be on one: not offered.
  const realms = await db.query('SELECT slug, name FROM realms WHERE game_version = $1 AND region = $2 AND excluded IS NULL ORDER BY name NULLS LAST, slug LIMIT 300', [scope.version, scope.region]);
  return {
    rulesets: rulesets.map((r) => ({ id: Number(r.id), name: r.name })),
    realms: realms.map((r) => ({ slug: r.slug, name: r.name ?? r.slug })),
  };
}

/** SQL pieces for a guild row: tracked members (guildTotals TRACKED_MEMBER), the live Guild Master, links, reports. */
const GUILD_COLUMNS = `
  g.id, g.slug, g.name, g.faction, g.ruleset_id, g.realm_slug, g.roster_members, g.roster_checked_at, g.first_seen_at,
  rs.name AS ruleset_name,
  (SELECT count(*)::int FROM characters c WHERE c.guild_id = g.id AND c.ruleset_id = g.ruleset_id AND c.stats_fetched_at IS NOT NULL
      AND NOT c.hidden AND c.missing_since IS NULL AND c.profile_state = 'ok') AS tracked,
  (SELECT CASE WHEN count(*) = 1 THEN max(c.owner_account_id) END
     FROM guild_roster gr LEFT JOIN characters c ON c.id = gr.character_id WHERE gr.guild_id = g.id AND gr.rank = 0) AS gm_account_id,
  (SELECT count(*)::int FROM guild_links l WHERE l.guild_id = g.id AND l.removed_at IS NULL) AS links,
  (SELECT count(*)::int FROM guild_link_reports x WHERE x.guild_id = g.id AND x.state = 'open')
    + (SELECT count(*)::int FROM reports x WHERE x.target_guild_id = g.id AND x.state = 'open') AS open_reports`;

const guildView = (g, minMembers, names) => ({
  id: Number(g.id), slug: g.slug, name: g.name, faction: g.faction,
  ruleset: g.ruleset_id === null ? null : { id: Number(g.ruleset_id), name: g.ruleset_name ?? null },
  realm: g.realm_slug ?? null,
  tracked: g.tracked, roster: g.roster_members ?? null, rosterCheckedAt: g.roster_checked_at,
  ranked: g.tracked >= minMembers, minMembers,
  gm: g.gm_account_id === null || g.gm_account_id === undefined ? null : { id: Number(g.gm_account_id), username: names.get(Number(g.gm_account_id)) ?? null },
  links: g.links, openReports: g.open_reports,
});

async function accountNames(db, ids) {
  const list = [...new Set(ids.filter((x) => x !== null && x !== undefined).map(Number))];
  if (!list.length) return new Map();
  const rows = await db.query('SELECT id, username, username_claimed FROM accounts WHERE id = ANY($1::bigint[]) LIMIT 500', [list]);
  return new Map(rows.map((r) => [Number(r.id), r.username_claimed ? r.username : null]));
}

async function guildPage(db, query) {
  const scope = scopeOf(query);
  const limit = pageLimit(query.limit, { fallback: 50, max: 100 });
  const minMembers = Number(await getSetting(db, 'guilds.minMembers')) || 5;
  const w = whereBuilder();
  w.add('g.game_version = ?', scope.version);
  w.add('g.region = ?', scope.region);
  const filters = {};
  const q = str(query.q).toLowerCase();
  if (q) {
    filters.q = q;
    w.add('(lower(g.name) LIKE ? OR g.slug LIKE ?)', `%${likeOf(q)}%`, `${likeOf(q)}%`);
  }
  if (typeof query.faction === 'string' && /^[A-Za-z]{2,20}$/.test(query.faction)) {
    filters.faction = query.faction;
    w.add('upper(g.faction) = upper(?)', query.faction);
  }
  const trackedSql = `(SELECT count(*)::int FROM characters c WHERE c.guild_id = g.id AND c.ruleset_id = g.ruleset_id AND c.stats_fetched_at IS NOT NULL
      AND NOT c.hidden AND c.missing_since IS NULL AND c.profile_state = 'ok')`;
  if (query.ranked === 'ranked' || query.ranked === 'not') {
    filters.ranked = query.ranked;
    w.add(`${trackedSql} ${query.ranked === 'ranked' ? '>=' : '<'} ?`, minMembers);
  }
  const gmSql = `(SELECT CASE WHEN count(*) = 1 THEN max(c.owner_account_id) END
     FROM guild_roster gr LEFT JOIN characters c ON c.id = gr.character_id WHERE gr.guild_id = g.id AND gr.rank = 0)`;
  if (query.gm === 'claimed' || query.gm === 'unclaimed') {
    filters.gm = query.gm;
    w.add(`${gmSql} IS ${query.gm === 'claimed' ? 'NOT ' : ''}NULL`);
  }
  if (query.reported === 'yes') {
    filters.reported = 'yes';
    w.add(`(EXISTS (SELECT 1 FROM guild_link_reports x WHERE x.guild_id = g.id AND x.state = 'open')
            OR EXISTS (SELECT 1 FROM reports x WHERE x.target_guild_id = g.id AND x.state = 'open'))`);
  }
  const total = (await db.one(`SELECT count(*)::int AS n FROM guilds g WHERE ${w.sql()}`, w.params)).n;
  const cur = dec(query.cursor, ['string', 'number']);
  if (cur) w.add('(lower(g.name), g.id) > (?, ?::bigint)', cur[0], cur[1]);
  w.params.push(limit + 1);
  const rows = await db.query(
    `SELECT ${GUILD_COLUMNS} FROM guilds g LEFT JOIN rulesets rs ON rs.id = g.ruleset_id
      WHERE ${w.sql()} ORDER BY lower(g.name), g.id LIMIT $${w.params.length}`,
    w.params,
  );
  const page = rows.slice(0, limit);
  const names = await accountNames(db, page.map((g) => g.gm_account_id));
  const last = page[page.length - 1];
  return {
    scope: { version: scope.version, region: scope.region },
    filters, total, minMembers,
    guilds: page.map((g) => ({ ...guildView(g, minMembers, names), publicPath: scope.primary ? `/g/${encodeURIComponent(g.slug)}` : null })),
    next: rows.length > limit && last ? enc([String(last.name).toLowerCase(), Number(last.id)]) : null,
  };
}

/** One guild for its Links subpage: the header and every link (live and removed) with its reports. */
async function guildDetail(db, id) {
  const minMembers = Number(await getSetting(db, 'guilds.minMembers')) || 5;
  const g = await db.one(`SELECT ${GUILD_COLUMNS}, g.game_version, g.region FROM guilds g LEFT JOIN rulesets rs ON rs.id = g.ruleset_id WHERE g.id = $1`, [id]);
  const links = await db.query(
    `SELECT l.id, l.label, l.url, l.host, l.created_at, l.created_by, l.removed_at, l.removed_by, l.removed_reason,
            (SELECT count(*)::int FROM guild_link_reports x WHERE x.link_id = l.id AND x.state = 'open') AS open_reports,
            (SELECT count(*)::int FROM guild_link_reports x WHERE x.link_id = l.id AND x.state <> 'open') AS closed_reports
       FROM guild_links l WHERE l.guild_id = $1 ORDER BY (l.removed_at IS NOT NULL), l.position, l.id LIMIT 100`,
    [id],
  );
  if (!g && !links.length) throw new HttpError(404, 'Everstats has no guild with that id.');
  const reports = links.length ? await db.query(
    `SELECT id, link_id, reported_at, note, state FROM guild_link_reports WHERE link_id = ANY($1::bigint[]) AND state = 'open'
      ORDER BY reported_at LIMIT 200`, [links.map((l) => l.id)]) : [];
  const page = await db.one('SELECT description, discord_invite FROM guild_pages WHERE guild_id = $1', [id]);
  const names = await accountNames(db, [...links.map((l) => l.created_by), g?.gm_account_id]);
  const primary = g ? g.game_version === PRIMARY_SCOPE.version && g.region === PRIMARY_SCOPE.region : false;
  return {
    guild: g ? { ...guildView(g, minMembers, names), version: g.game_version, region: g.region, publicPath: primary ? `/g/${encodeURIComponent(g.slug)}` : null } : { id, name: null, aged: true },
    page: { description: page?.description ?? null, discord: page?.discord_invite ?? null },
    links: links.map((l) => ({
      id: Number(l.id), label: l.label, url: l.url, host: l.host, createdAt: l.created_at,
      addedBy: l.created_by === null ? null : { id: Number(l.created_by), username: names.get(Number(l.created_by)) ?? null },
      removedAt: l.removed_at, removedBy: l.removed_by, removedReason: l.removed_reason,
      openReports: l.open_reports, closedReports: l.closed_reports,
      reports: reports.filter((r) => Number(r.link_id) === Number(l.id)).map((r) => ({ id: Number(r.id), at: r.reported_at, note: r.note })),
    })),
  };
}

export function createAdminDirectoryRouter({ db, writes }) {
  const r = express.Router();
  void writes; // read only: every action here goes through the routes that already own it

  r.get('/directory/counts', route(async (req, res) => {
    const scope = scopeOf(req.query);
    const row = await db.one(
      `SELECT (SELECT count(*)::int FROM accounts) AS accounts,
              (SELECT count(*)::int FROM characters WHERE game_version = $1 AND region = $2 AND profile_state <> 'purged') AS characters,
              (SELECT count(*)::int FROM guilds WHERE game_version = $1 AND region = $2) AS guilds`,
      [scope.version, scope.region],
    );
    res.json({ scope: { version: scope.version, region: scope.region }, ...row });
  }));

  r.get('/directory/characters', route(async (req, res) => {
    const scope = scopeOf(req.query);
    const [page, facets] = await Promise.all([characterPage(db, req.query), req.query.cursor ? null : characterFacets(db, scope)]);
    res.json({ ...page, facets });
  }));

  // An account's claimed characters, every version (the account detail page). Hidden ones included and marked. Gold:
  // only HOW MANY characters hold gold data and how many show it publicly; never an amount (design: "Private · admin
  // sees counts only").
  r.get('/directory/accounts/:id/characters', route(async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await db.one('SELECT 1 AS x FROM accounts WHERE id = $1', [id]))) throw new HttpError(404, 'No such account.');
    const rows = await db.query(
      `SELECT c.id, c.slug, c.name, c.surname, c.realm_slug, c.level, c.class, c.hidden, c.profile_state, c.missing_since,
              c.game_version, c.region, c.last_fetched_at, rs.name AS ruleset_name, t.letter, t.reason AS tier_reason
         FROM characters c LEFT JOIN rulesets rs ON rs.id = c.ruleset_id LEFT JOIN character_tiers t ON t.character_id = c.id
        WHERE c.owner_account_id = $1 ORDER BY c.level DESC NULLS LAST, c.id LIMIT 200`,
      [id],
    );
    const gold = await db.one(
      `SELECT (SELECT count(*)::int FROM character_gold WHERE account_id = $1) AS stored,
              (SELECT count(*)::int FROM character_gold_public WHERE account_id = $1) AS public`,
      [id],
    );
    res.json({
      characters: rows.map((c) => {
        const primary = c.game_version === PRIMARY_SCOPE.version && c.region === PRIMARY_SCOPE.region;
        return {
          id: Number(c.id), slug: c.slug, name: c.name, surname: c.surname, realm: c.realm_slug, level: c.level, class: c.class,
          version: c.game_version, region: c.region, ruleset: c.ruleset_name ?? null,
          hidden: c.hidden, state: c.missing_since ? 'missing' : c.profile_state, lastFetchedAt: c.last_fetched_at,
          tier: c.letter ? { letter: c.letter } : c.tier_reason ? { letter: null, reason: c.tier_reason } : null,
          publicPath: primary && c.slug && !c.hidden && c.profile_state === 'ok' ? `/c/${encodeURIComponent(c.slug)}` : null,
        };
      }),
      gold: { charactersWithGold: gold.stored, shownPublicly: gold.public },
    });
  }));

  r.get('/directory/guilds', route(async (req, res) => res.json(await guildPage(db, req.query))));

  r.get('/directory/guilds/:id', route(async (req, res) => res.json(await guildDetail(db, idParam(req.params.id)))));

  return r;
}
