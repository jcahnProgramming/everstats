import { PRIMARY_SCOPE } from '../core/config.js';
import { versionById } from '../core/gameVersions.js';
import { pathSlug } from '../core/scope.js';
import { seasonOfKey } from '../stats/seasons.js';
import { fromCollectionsFetch } from '../stats/feeds.js';
import { boardCounts, characterRanks, everyoneTied } from '../stats/boards.js';
import { categoryKey, loadCatalog } from '../stats/catalog.js';
import { inlineBadges } from '../badges/store.js';
import { gearItemIds } from '../crawler/items.js';
import { renderSwitch } from './renders.js';

/**
 * A tracked character as the public API shows it. Everything carries its freshness: fetchedAt (the last full fetch:
 * statistics, gear), checkedAt (the profile, read even when nothing changed), media.fetchedAt (renders lag the profile
 * by hours) and each statistic's own updatedAt from Blizzard.
 */
/**
 * Each equipped item with its icon: { icon: url | null, iconState: 'ok' | 'pending' | 'missing' | 'failed' }, and its
 * transmog (0.8.0) with the transmog item's own icon the same way. transmog: null = not transmogged; undefined = stored
 * before 0.8.0, not known until the next full fetch.
 */
// 0.10.0: icons are per game version and region; `scope` is the character's (default: the primary pages').
export async function equipmentWithIcons(db, equipment, scope = PRIMARY_SCOPE) {
  const list = Array.isArray(equipment) ? equipment : [];
  const ids = gearItemIds(list);
  const rows = ids.length ? await db.query('SELECT item_id, state, icon_url FROM item_media WHERE game_version = $2 AND region = $3 AND item_id = ANY($1::bigint[]) LIMIT 100', [ids, scope.version, scope.region]) : [];
  const byId = new Map(rows.map((r) => [Number(r.item_id), r]));
  const iconOf = (id) => {
    const m = byId.get(id);
    return { icon: m?.state === 'ok' ? m.icon_url : null, iconState: m ? m.state : 'pending' };
  };
  // mediaHref is how the crawler finds the icon; the page doesn't need it.
  return list.map(({ mediaHref: _href, ...i }) => ({
    ...i,
    ...iconOf(i.itemId),
    ...(i.transmog ? { transmog: { ...i.transmog, ...iconOf(i.transmog.itemId) } } : {}),
  }));
}

/** Whether the character's owner hid its render (0.7.1, character_render_hidden). */
export const renderHiddenFor = async (db, characterId) => Boolean(await db.one('SELECT 1 AS x FROM character_render_hidden WHERE character_id = $1', [characterId]));

/** The ids among these whose render is hidden. */
export async function hiddenRenders(db, ids) {
  if (!ids.length) return new Set();
  return new Set((await db.query('SELECT character_id FROM character_render_hidden WHERE character_id = ANY($1::bigint[]) LIMIT 1000', [ids])).map((r) => Number(r.character_id)));
}

/** 0.11.1: a character's realm (versions with realms): its slug, Blizzard's name for it and its type, or null. */
export async function realmOf(db, row) {
  if (!row.realm_slug) return null;
  const r = await db.one('SELECT name, type_key, type_name FROM realms WHERE game_version = $1 AND region = $2 AND slug = $3', [row.game_version, row.region, row.realm_slug]);
  return { slug: row.realm_slug, name: r?.name ?? null, type: row.realm_type ?? r?.type_key ?? null, typeName: r?.type_name ?? null };
}

export async function characterView(db, row, { mine = false } = {}) {
  const ruleset = row.ruleset_id !== null ? await db.one('SELECT id, name FROM rulesets WHERE id = $1', [row.ruleset_id]) : null;
  const guild = row.guild_id !== null ? await db.one('SELECT name, slug, realm_slug, faction FROM guilds WHERE id = $1', [row.guild_id]) : null;
  const scope = { version: row.game_version, region: row.region };
  // "Claimed by @username": only for a character that isn't hidden, and only once its owner has a real username.
  const owner = row.owner_account_id !== null && !row.hidden
    ? await db.one('SELECT username FROM accounts WHERE id = $1 AND username_claimed AND NOT everstats_banned(id)', [row.owner_account_id])
    : null;
  const renderHidden = await renderHiddenFor(db, row.id);
  const switched = await renderSwitch(db);
  return {
    id: row.id,
    // 0.11.1: how URLs write it: "name-surname", or "realm/name" on a version with realms (core/scope.js pathSlug).
    slug: pathSlug(row),
    version: row.game_version,
    region: row.region,
    realm: await realmOf(db, row),
    name: row.name,
    surname: row.surname,
    level: row.level,
    race: row.race,
    class: row.class,
    // The character's OWN faction, from its own profile. Never the guild's: a guild can hold both (0.11.1, rule 11).
    faction: row.faction,
    gender: row.gender,
    ruleset,
    guild: guild ? { name: guild.name, slug: pathSlug(guild), faction: guild.faction ?? null } : null,
    // 0.11.1: collections on this version are shared across the Battle.net account (Warband): pages say so.
    accountWide: Boolean(versionById(row.game_version)?.collections?.accountWide),
    lastLoginAt: row.last_login_at,
    fetchedAt: row.last_fetched_at,
    checkedAt: row.last_checked_at,
    statsFetchedAt: row.stats_fetched_at,
    trackedSince: row.tracked_since,
    // 0.7.1: "Hide my render". Blizzard's render server sometimes draws a character wrong (a different race, sex or
    // build) while our data and the URL are right; its owner can hide the render and avatar everywhere on Everstats.
    // Hidden: neither URL is sent at all (state 'hidden'), the owner included, so nothing can show it by mistake.
    // 0.8.1: renders switched off by the admin (characters/renders.js): state 'paused', no URL, the admin's note.
    media: renderHidden
      ? { state: 'hidden', render: null, avatar: null, fetchedAt: null }
      : switched.paused ? { state: 'paused', render: null, avatar: null, fetchedAt: null, note: switched.note }
      : {
        state: row.media_state ?? 'not_ready',
        render: row.media?.['main-raw'] ?? null,
        avatar: row.media?.avatar ?? null,
        fetchedAt: row.media_fetched_at,
      },
    renderHidden,
    equipment: row.equipment ? await equipmentWithIcons(db, row.equipment, scope) : null,
    attributes: row.attributes ?? null,
    hidden: row.hidden,
    mine,
    // 0.7.0: the owner's one inline badge (pinned, else first featured), never on leaderboards.
    claimedBy: owner ? { username: owner.username, badge: (await inlineBadges(db, [row.owner_account_id])).get(Number(row.owner_account_id)) ?? null } : null,
  };
}

/**
 * Every statistic in the catalog for this character, grouped by category (the owner's decision, else the
 * suggestion). A statistic the character doesn't have is zero (Blizzard lists only what a character has done), and a
 * zero has no rank. "of N" is how many have any (withAny). Hidden characters (seen by their owner) get no ranks.
 */
export async function characterStatistics(db, row) {
  // The catalog of the CHARACTER's game version (a profile or dashboard lists characters of several).
  const { statistics, categories } = await loadCatalog(db, { version: row.game_version });
  const ranked = row.ruleset_id !== null && !row.hidden;
  const mineById = row.ruleset_id !== null ? await characterRanks(db, row.id, row.ruleset_id) : new Map();
  const counts = ranked ? await boardCounts(db, row.ruleset_id) : null;
  // 0.11.1: collections never fetched (a sign-in fetches only the account's highest-level characters; the rest load on
  // a look-up or when the Collections tab is opened). Its collection-fed statistics are UNKNOWN, not zero: sent as
  // `waiting` with a null value, and the page says when they load.
  const collectionsWaiting = !row.collections_fetched_at;
  return {
    population: counts?.population ?? null,
    ranked,
    collectionsWaiting,
    seasons: seasonCards(statistics, mineById, counts, ranked),
    categories: categories.map((c) => ({
      label: c.label,
      key: categoryKey(c.label),
      farmable: c.farmable,
      graded: c.graded,
      tierCounted: c.tierCounted ?? 0,
      inOverall: Boolean(c.inOverall),
      statistics: c.statisticIds.map((id) => {
        const s = statistics.get(id);
        const mine = mineById.get(id);
        const value = mine?.value ?? 0;
        const bc = counts?.byStat.get(id) ?? { nonzero: 0, min: null, max: null };
        // Zero is never ranked (0.4.1): "#2 of 116" for none at all read like an achievement.
        const rank = ranked && value > 0 ? mine.rank : null;
        const waiting = collectionsWaiting && !mine && fromCollectionsFetch(s.derived);
        return {
          id,
          name: s.name,
          value: waiting ? null : value,
          waiting,
          text: mine?.text ?? null,
          named: s.named,
          grading: s.grading,
          tierRole: s.tierRole ?? 'undecided',
          rank,
          withAny: bc.nonzero,
          updatedAt: mine?.updatedAt ?? null,
        };
      }),
    })),
  };
}

/**
 * 0.11.1 season cards (stats/seasons.js): the character's CURRENT values on its season boards, grouped per season and
 * bracket, each with its board id and rank. Only what the character has a value for; a version without season boards
 * (or a character with none) gets an empty list and the page shows no card.
 *   → [{ kind: 'mplus' | 'pvp', seasonId, bracket, bracketLabel, fields: { rating | best_level | played | won: { id, value, rank, withAny } } }]
 */
function seasonCards(statistics, mineById, counts, ranked) {
  const cards = new Map();
  for (const [id, mine] of mineById) {
    const s = statistics.get(id);
    const k = s?.derived ? seasonOfKey(s.derived) : null;
    if (!k || !(mine.value > 0)) continue;
    const key = `${k.kind}:${k.seasonId}:${k.bracket ?? ''}`;
    if (!cards.has(key)) cards.set(key, { kind: k.kind, seasonId: k.seasonId, bracket: k.bracket, bracketLabel: k.bracketLabel ?? null, fields: {} });
    cards.get(key).fields[k.field] = { id, value: mine.value, rank: ranked ? mine.rank : null, withAny: counts?.byStat.get(id)?.nonzero ?? 0 };
  }
  // The newest season first; Mythic+ before PvP; brackets in a steady order.
  return [...cards.values()].sort((a, b) => (a.kind === b.kind ? b.seasonId - a.seasonId || String(a.bracket).localeCompare(String(b.bracket)) : a.kind === 'mplus' ? -1 : 1));
}

/**
 * 0.10.4: the profile's featured character, its third column: the owner's pinned badge (the one inline badge, null when
 * none is public) and the character's best overall placements, from the same ranks the character page shows. A placement
 * needs a rank (value above zero, ranked character) on a board where at least two have any and not everyone is tied
 * ("#1 of 1" or a shared #1 says nothing),
 * and never a "bad" statistic (deaths and the like are leaderboard-only, not something to show off). Best rank first,
 * then the busier board. Read live; nothing stored.
 */
export const FEATURED_PLACEMENTS = 3;
export async function featuredExtras(db, row, accountId) {
  const badge = (await inlineBadges(db, [accountId])).get(Number(accountId)) ?? null;
  if (row.ruleset_id === null || row.ruleset_id === undefined || row.hidden) return { badge, placements: [] };
  const { statistics } = await loadCatalog(db, { version: row.game_version });
  const mine = await characterRanks(db, row.id, row.ruleset_id);
  const counts = await boardCounts(db, row.ruleset_id);
  const placements = [];
  for (const [id, m] of mine) {
    const s = statistics.get(id);
    const bc = counts.byStat.get(id);
    const withAny = bc?.nonzero ?? 0;
    // A board where everyone with any is tied makes everyone #1: not a placement worth showing.
    if (everyoneTied(bc)) continue;
    // 0.11.1: "bad" is a statistic nobody should show off (deaths and the like). A board Everstats makes whose group
    // simply doesn't count toward tiers (collections, reputations) is a fine placement, as it was before 0.11.1.
    if (!s || !s.name || !m.rank || m.value <= 0 || withAny < 2 || (s.tierRole === 'bad' && !s.derived) || s.category === 'Deaths & mishaps') continue;
    placements.push({ id, name: s.name, rank: m.rank, withAny, value: m.value });
  }
  placements.sort((a, b) => a.rank - b.rank || b.withAny - a.withAny || a.id - b.id);
  return { badge, placements: placements.slice(0, FEATURED_PLACEMENTS) };
}
