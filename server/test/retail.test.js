import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { PRIORITY } from '../crawler/queue.js';

// 0.11.1: World of Warcraft (Retail, US), switched on for this file only. Shapes follow what probe #7 stored; every
// name and number here is a test fixture. Covers the owner's decisions: one pool per region with realm type as a board
// filter, the trimmed boards and their reasons, Everstats-made boards under group choices (Forever's plan unchanged),
// Retail's group choices, season boards, decor, on-demand collections, capped seeding, the versioned API, and faction.
const API = 'https://us.api.blizzard.com';
const calls = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stat = (id, name, quantity) => ({ id, name, quantity, last_updated_timestamp: 1794000000000 });
const href = (path, ns) => ({ href: `${API}${path}?namespace=${ns}` });

const REALMS = {
  'area-52': { id: 3676, name: 'Area 52', type: { type: 'NORMAL', name: 'Normal' }, connected: 3676 },
  'moon-guard': { id: 3675, name: 'Moon Guard', type: { type: 'RP', name: 'Roleplaying' }, connected: 3675 },
};
// name → { realm, id, level, faction, class, kills, mplus, brackets, decor }
const CHARS = {
  thrall: { realm: 'area-52', id: 501, faction: 'Horde', cls: 'Shaman', kills: 900, mplus: { rating: 2450.4, levels: [12, 15, 9] }, brackets: { '2v2': { rating: 1800, played: 40, won: 25 } }, guild: true },
  jaina: { realm: 'moon-guard', id: 502, faction: 'Alliance', cls: 'Mage', kills: 300, mplus: null, brackets: {}, guild: true },
  rookie: { realm: 'area-52', id: 503, faction: 'Horde', cls: 'Warrior', kills: 5, mplus: null, brackets: {} },
  keyrunner: { realm: 'moon-guard', id: 504, faction: 'Alliance', cls: 'Rogue', kills: 50, mplus: { rating: 3000, levels: [20] }, brackets: {} },
  newkey: { realm: 'moon-guard', id: 505, faction: 'Horde', cls: 'Druid', kills: 20, mplus: { rating: 2900, levels: [19] }, brackets: {} },
};
const GUILD = { id: 9100, name: 'Fixture Alliance', slug: 'fixture-alliance', realm: 'area-52' };
let leaderboardHits = 0;

function profileDoc(name, c) {
  return {
    _links: { self: href(`/profile/wow/character/${c.realm}/${name}`, 'profile-us') },
    id: c.id, name: name[0].toUpperCase() + name.slice(1), level: 80, faction: { type: c.faction.toUpperCase(), name: c.faction }, race: { name: 'Fixture Race' }, character_class: { name: c.cls },
    realm: { id: REALMS[c.realm].id, name: REALMS[c.realm].name, slug: c.realm }, last_login_timestamp: 1794100000000, average_item_level: 600, equipped_item_level: 598, achievement_points: 12000,
    // The GUILD's own faction, on a cross-faction guild: Horde, whatever the member is (rule 11).
    ...(c.guild ? { guild: { id: GUILD.id, name: GUILD.name, slug: GUILD.slug, faction: { type: 'HORDE', name: 'Horde' }, realm: { id: 3676, slug: GUILD.realm, name: 'Area 52' } } } : {}),
  };
}

async function fakeFetch(url) {
  const u = new URL(String(url));
  const ns = u.searchParams.get('namespace');
  calls.push({ path: u.pathname, ns });
  if (u.href === 'https://oauth.battle.net/token') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
  if (u.origin !== API) return json(404, {});
  if (ns === 'dynamic-us') {
    const realm = /^\/data\/wow\/realm\/([a-z0-9-]+)$/.exec(u.pathname);
    if (realm && REALMS[realm[1]]) {
      const r = REALMS[realm[1]];
      return json(200, { id: r.id, name: r.name, slug: realm[1], type: r.type, category: 'United States', connected_realm: href(`/data/wow/connected-realm/${r.connected}`, 'dynamic-us') });
    }
    if (u.pathname === '/data/wow/connected-realm/index') return json(200, { connected_realms: Object.values(REALMS).map((r) => href(`/data/wow/connected-realm/${r.connected}`, 'dynamic-us')) });
    if (u.pathname === '/data/wow/search/connected-realm') {
      return json(200, { page: 1, pageCount: 1, results: Object.entries(REALMS).map(([slug, r]) => ({ data: { id: r.connected, population: { type: 'HIGH' }, realms: [{ id: r.id, slug, name: { en_US: r.name }, type: { type: r.type.type, name: { en_US: r.type.name } } }] } })) });
    }
    if (u.pathname === '/data/wow/mythic-keystone/season/index') return json(200, { seasons: [{ id: 14 }, { id: 15 }], current_season: { id: 15 } });
    const idx = /^\/data\/wow\/connected-realm\/(\d+)\/mythic-leaderboard\/index$/.exec(u.pathname);
    if (idx) return json(200, { current_leaderboards: [{ id: 249, name: 'Fixture Dungeon', key: href(`/data/wow/connected-realm/${idx[1]}/mythic-leaderboard/249/period/1088`, 'dynamic-us') }] });
    if (/\/mythic-leaderboard\/249\/period\/1088$/.test(u.pathname)) {
      leaderboardHits += 1;
      return json(200, { leading_groups: [{ ranking: 1, members: [
        { profile: { id: 504, name: 'Keyrunner', realm: { id: 3675, slug: 'moon-guard' } }, faction: { type: 'ALLIANCE' } },
        { profile: { id: 501, name: 'Thrall', realm: { id: 3676, slug: 'area-52' } }, faction: { type: 'HORDE' } },
        { profile: { id: 505, name: 'Newkey', realm: { id: 3675, slug: 'moon-guard' } }, faction: { type: 'HORDE' } },
      ] }] });
    }
    return json(404, {});
  }
  if (ns !== 'profile-us') return json(404, {});
  if (u.pathname === `/data/wow/guild/${GUILD.realm}/${GUILD.slug}`) {
    return json(200, { id: GUILD.id, name: GUILD.name, slug: GUILD.slug, faction: { type: 'HORDE', name: 'Horde' }, realm: { id: 3676, slug: GUILD.realm, name: 'Area 52' }, member_count: 3, created_timestamp: 1700000000000, achievement_points: 4000 });
  }
  if (u.pathname === `/data/wow/guild/${GUILD.realm}/${GUILD.slug}/roster`) {
    // Retail rosters give each member's OWN faction as a type; "rookie" comes with none at all.
    const member = (name, rank, faction) => ({ rank, character: { id: CHARS[name].id, name: name[0].toUpperCase() + name.slice(1), level: 80, realm: { id: REALMS[CHARS[name].realm].id, slug: CHARS[name].realm }, ...(faction ? { faction: { type: faction } } : {}), key: href(`/profile/wow/character/${CHARS[name].realm}/${name}`, 'profile-us') } });
    return json(200, { guild: { id: GUILD.id, name: GUILD.name, faction: { type: 'HORDE', name: 'Horde' } }, members: [member('thrall', 0, 'HORDE'), member('jaina', 1, 'ALLIANCE'), member('rookie', 3, null)] });
  }
  const m = /^\/profile\/wow\/character\/([a-z0-9-]+)\/([a-z]+)(\/.*)?$/.exec(u.pathname);
  const c = m ? CHARS[m[2]] : null;
  if (!c || c.realm !== m[1]) return json(404, {});
  const sub = m[3] ?? '';
  if (sub === '') return json(200, profileDoc(m[2], c));
  if (sub === '/achievements/statistics') {
    return json(200, { categories: [
      { id: 128, name: 'Kills', statistics: [stat(107, 'Creatures killed', c.kills)] },
      { id: 122, name: 'Deaths', statistics: [stat(60, 'Total deaths', 3)] },
      { id: 15219, name: 'Legacy', statistics: [stat(9001, 'Old season keys', 7)] },
      { id: 15500, name: 'Delves', statistics: [stat(9002, 'Delves completed', 11)] },
      { id: 15117, name: 'Pet Battles', statistics: [stat(9003, 'Pet battles won', 4)] },
    ] });
  }
  if (sub === '/statistics') return json(200, { health: 9000, power: 250000, mana_regen: 40, mana_regen_combat: 40, spell_penetration: 0, strength: { base: 100, effective: 2000 }, melee_crit: { rating_bonus: 12.5, value: 20.5, rating_normalized: 900 }, main_hand_damage_min: 10, main_hand_damage_max: 20, main_hand_speed: 2.6, main_hand_dps: 5.7 });
  if (sub === '/equipment') return json(200, { equipped_items: [{ slot: { type: 'HEAD', name: 'Head' }, name: 'Fixture Helm', quality: { type: 'EPIC' }, item: { id: 1 }, quantity: 1, context: 5, level: { value: 600 }, sell_price: { value: 100 }, durability: { value: 80 }, armor: { value: 400, display: { color: { r: 255, g: 255, b: 255, a: 1 } } } }] });
  if (sub === '/character-media') return json(404, {});
  if (sub === '/mythic-keystone-profile/season/15') {
    if (!c.mplus) return json(404, {});
    return json(200, { season: { id: 15 }, mythic_rating: { rating: c.mplus.rating, color: { r: 255, g: 128, b: 0, a: 1 } }, best_runs: c.mplus.levels.map((keystone_level) => ({ keystone_level, dungeon: { id: 1, name: 'Fixture Dungeon' }, duration: 1000 })) });
  }
  const bracket = /^\/pvp-bracket\/([a-z0-9]+)$/.exec(sub);
  if (bracket) {
    const b = c.brackets[bracket[1]];
    if (!b) return json(404, {});
    return json(200, { rating: b.rating, season: { id: 40 }, bracket: { id: 1, type: 'ARENA_2v2' }, season_match_statistics: { played: b.played, won: b.won, lost: b.played - b.won }, weekly_match_statistics: { played: 2, won: 1, lost: 1 } });
  }
  // Collections (asked only on demand on Retail).
  if (sub === '/collections/decor') return json(200, { decor_collected: [{ decor: { id: 497, name: 'Fixture Table' }, quantity: 3 }, { decor: { id: 772, name: 'Fixture Ivy' }, quantity: 1 }] });
  if (sub === '/collections/mounts') return json(200, { mounts: [{ mount: { id: 6, name: 'Fixture Horse' } }] });
  if (sub === '/reputations') {
    return json(200, { reputations: [
      { faction: { id: 72, name: 'Fixture City' }, standing: { raw: 42000, value: 0, max: 0, tier: 7, name: 'Exalted' } },
      { faction: { id: 2600, name: 'Fixture Council' }, standing: { raw: 7500, value: 500, max: 2500, renown_level: 12, name: 'Renown 12' }, paragon: { raw: 100, value: 100, max: 10000 } },
    ] });
  }
  if (sub === '/professions') return json(200, { primaries: [{ profession: { id: 171, name: 'Alchemy' }, tiers: [{ tier: { id: 2823, name: 'Fixture Alchemy' }, skill_points: 80, max_skill_points: 100 }] }] });
  if (sub === '/pvp-summary') return json(200, { honor_level: 55, honorable_kills: 1234, pvp_map_statistics: [{ world_map: { id: 30, name: 'Fixture Valley' }, match_statistics: { played: 10, won: 6, lost: 4 } }] });
  return json(404, {});
}

let t;
let crawler;
before(async () => {
  const { enableVersionForTests } = await import('../core/gameVersions.js');
  enableVersionForTests('retail');
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  const { createCrawler } = await import('../crawler/service.js');
  crawler = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await crawler.start();
});
after(async () => {
  await crawler.stop();
  await t.close();
  const { enableVersionForTests } = await import('../core/gameVersions.js');
  enableVersionForTests('retail', false);
});

const RETAIL = { version: 'retail', region: 'us' };
async function run(item) {
  const { enqueue, waitFor } = await import('../crawler/queue.js');
  const row = await enqueue(t.db, { ...RETAIL, ...item });
  const done = await waitFor(t.db, row.id, { timeoutMs: 20_000 });
  assert.equal(done?.state, 'done', JSON.stringify(done));
  return done;
}
const drain = async () => {
  for (let i = 0; i < 200; i += 1) {
    if (!(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE state IN ('queued', 'running') LIMIT 1"))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the crawl queue never drained');
};
const api = (path) => t.client().get(`/api/v/retail/us${path}`);

test('the trim: each owner rule skips what it names, with its reason, on every version; what stays is a board', async () => {
  const { SKIP_RULES, feedKeySkipped, indexThresholdApplies, numericFields } = await import('../stats/feeds.js');
  const keysOf = (feed, doc) => numericFields(feed, doc).fields.map((f) => f.path);
  const ruleOf = (feed, doc, path) => numericFields(feed, doc).skipped.find((s) => s.path === path)?.rule ?? null;

  // The character-stats feed as probe #7 returned it: 67 numbers. The owner's rules leave 45.
  const rating = { rating_bonus: 1.5, value: 2.5, rating_normalized: 300 };
  const pair = { base: 10, effective: 20 };
  const statistics = {
    health: 1, power: 1, speed: { rating_bonus: 1, rating_normalized: 2 }, strength: pair, agility: pair, intellect: pair, stamina: pair,
    melee_crit: rating, melee_haste: rating, mastery: rating, bonus_armor: 1, lifesteal: rating, versatility: 1, versatility_damage_done_bonus: 1, versatility_healing_done_bonus: 1,
    versatility_damage_taken_bonus: 1, avoidance: { rating_bonus: 1, rating_normalized: 2 }, attack_power: 1, main_hand_damage_min: 1, main_hand_damage_max: 2, main_hand_speed: 3, main_hand_dps: 4,
    off_hand_damage_min: 1, off_hand_damage_max: 2, off_hand_speed: 3, off_hand_dps: 4, spell_power: 1, spell_penetration: 1, spell_crit: rating, mana_regen: 1, mana_regen_combat: 1,
    armor: pair, dodge: rating, parry: rating, block: rating, ranged_crit: rating, ranged_haste: rating, spell_haste: rating,
  };
  const before = Object.values(statistics).reduce((n, v) => n + (typeof v === 'number' ? 1 : Object.keys(v).length), 0);
  assert.equal(before, 67, 'the fixture has the 67 numbers probe #7 listed');
  const kept = keysOf('statistics', statistics);
  assert.equal(kept.length, 45);
  for (const gone of ['power', 'mana_regen', 'spell_penetration', 'melee_crit.rating_normalized', 'main_hand_damage_min', 'main_hand_speed', 'off_hand_damage_max']) assert.ok(!kept.includes(gone), gone);
  for (const stays of ['health', 'mana_regen_combat', 'main_hand_dps', 'melee_crit.value', 'melee_crit.rating_bonus', 'strength.effective']) assert.ok(kept.includes(stays), stays);
  assert.equal(ruleOf('statistics', statistics, 'power'), 'power');
  assert.equal(ruleOf('statistics', statistics, 'mana_regen'), 'mana-regen-duplicate');
  assert.equal(ruleOf('statistics', statistics, 'speed.rating_normalized'), 'rating-normalized');
  assert.equal(ruleOf('statistics', statistics, 'off_hand_speed'), 'weapon-range');

  // No equipment boards at all; each field still says why by what it means.
  const equipment = { equipped_items: [{ slot: { type: 'HEAD' }, quantity: 1, context: 5, level: { value: 600 }, sell_price: { value: 1 }, requirements: { level: { value: 80 } }, durability: { value: 80 }, timewalker_level: 70, armor: { value: 5, display: { color: { r: 1, g: 2, b: 3, a: 1 } } }, weapon: { damage: { min_value: 1, max_value: 2 }, attack_speed: { value: 2 }, dps: { value: 3 } }, stats: [{ type: { type: 'STAMINA' }, value: 9 }] }] };
  assert.deepEqual(keysOf('equipment', equipment), []);
  const why = (path) => ruleOf('equipment', equipment, path);
  assert.deepEqual([why('equipped_items[].quantity'), why('equipped_items[].context'), why('equipped_items[].sell_price.value'), why('equipped_items[].requirements.level.value'), why('equipped_items[].durability.value'), why('equipped_items[].timewalker_level'), why('equipped_items[].armor.display.color.r'), why('equipped_items[].weapon.damage.min_value'), why('equipped_items[].level.value')],
    ['item-quantity', 'item-context', 'sell-price', 'requirements', 'durability', 'timewalker-level', 'display', 'weapon-range', 'equipment']);
  // The profile's equipped and average item level stay.
  assert.deepEqual(keysOf('profile', { level: 80, average_item_level: 600, equipped_item_level: 598, guild: { member_count: 400 } }).sort(), ['average_item_level', 'equipped_item_level', 'level']);
  assert.equal(ruleOf('profile', { guild: { member_count: 400 } }, 'guild.member_count'), 'guild-number');

  // One board per faction: raw standing, or the renown level for a renown faction; ceilings and paragon never.
  const reps = { reputations: [
    { faction: { id: 72, name: 'City' }, standing: { raw: 42000, value: 0, max: 0, tier: 7 } },
    { faction: { id: 2600, name: 'Council' }, standing: { raw: 7500, value: 500, max: 2500, renown_level: 12 }, paragon: { raw: 5, value: 5, max: 10000 } },
  ] };
  assert.deepEqual(keysOf('reputations', reps).sort(), ['reputations[faction-2600].standing.renown_level', 'reputations[faction-72].standing.raw']);
  assert.equal(ruleOf('reputations', reps, 'reputations[].standing.max'), 'ceiling');
  assert.equal(ruleOf('reputations', reps, 'reputations[].paragon.max'), 'ceiling');
  assert.equal(numericFields('reputations', reps).skipped.find((s) => s.rule === 'faction-renown')?.path, 'reputations[].standing.raw');
  // Professions: the skill, never its ceiling. PvP summary: each map's numbers; the top-level fields are the 0.9.1 boards.
  assert.deepEqual(keysOf('professions', { primaries: [{ profession: { id: 171, name: 'Alchemy' }, tiers: [{ tier: { id: 1, name: 'T' }, skill_points: 80, max_skill_points: 100 }] }] }), ['primaries[profession-171].tiers[tier-1].skill_points']);
  const pvp = { honor_level: 5, honorable_kills: 9, pvp_map_statistics: [{ world_map: { id: 30, name: 'Valley' }, match_statistics: { played: 3, won: 2, lost: 1 } }] };
  assert.equal(keysOf('pvp-summary', pvp).length, 3);
  assert.equal(ruleOf('pvp-summary', pvp, 'honor_level'), 'covered-elsewhere');
  // Guild numbers are never character boards.
  assert.deepEqual(keysOf('guild-profile', { achievement_points: 1, member_count: 2 }), []);

  // A board that existed before a rule was added is recognised by its key alone, so the catalog drops it at once.
  assert.equal(feedKeySkipped('feed:equipment:equipped_items[HEAD].level.value'), true);
  assert.equal(feedKeySkipped('feed:statistics:melee_crit.rating_normalized'), true);
  assert.equal(feedKeySkipped('feed:statistics:health'), false);
  assert.equal(feedKeySkipped('feed:reputations:reputations[faction-72].standing.raw'), false);
  assert.equal(feedKeySkipped('mounts'), false);
  // Every rule says why, in words.
  assert.ok(SKIP_RULES.every((r) => typeof r.reason === 'string' && r.reason.length > 10));
  // Per-faction, per-instance and per-slot boards are the ones the index threshold holds back; totals never.
  assert.deepEqual(['feed:reputations:reputations[faction-72].standing.raw', 'instance:249', 'slot:HEAD', 'exalted', 'boss-kills', 'appearances', 'feed:statistics:health'].map(indexThresholdApplies), [true, true, true, false, false, false, false]);
});

test('season boards: keyed by Blizzard’s season id, only what Blizzard answered, never a guessed season', async () => {
  const { bracketEntries, currentSeasonOf, mythicEntries, seasonOfKey } = await import('../stats/seasons.js');
  assert.equal(currentSeasonOf({ seasons: [{ id: 14 }, { id: 15 }], current_season: { id: 15 } }), 15);
  assert.equal(currentSeasonOf({ seasons: [{ id: 14 }] }), null, 'no current_season: nothing is asked');
  assert.deepEqual(mythicEntries({ season: { id: 15 }, mythic_rating: { rating: 2450.4 }, best_runs: [{ keystone_level: 12 }, { keystone_level: 15 }] }).map((e) => [e.key, e.value]),
    [['season:mplus:15:rating', 2450.4], ['season:mplus:15:best_level', 15]]);
  assert.deepEqual(mythicEntries({ season: { id: 15 }, best_runs: [] }), []);
  assert.deepEqual(bracketEntries('3v3', { rating: 1500, season: { id: 40 }, season_match_statistics: { played: 10, won: 0, lost: 10 } }).map((e) => e.key), ['season:pvp:40:3v3:rating', 'season:pvp:40:3v3:played'], 'zero wins is no row');
  assert.deepEqual(bracketEntries('2v2', { rating: 1500 }), [], 'an answer that names no season makes no board');
  assert.deepEqual(seasonOfKey('season:pvp:40:rbg:won'), { kind: 'pvp', seasonId: 40, bracket: 'rbg', bracketLabel: 'Rated battlegrounds', field: 'won' });
  assert.equal(seasonOfKey('feed:statistics:health'), null);
});

test('one pool per region: every realm ranks together; the realm type is kept and is only a filter; 9 requests a full fetch', async () => {
  const mark = calls.length;
  await run({ key: 'area-52/thrall', priority: PRIORITY.lookup, mode: 'full' });
  const asked = calls.slice(mark).filter((c) => c.path.includes('/character/area-52/thrall'));
  // profile + statistics, attributes, equipment, media + the Mythic+ season + three PvP brackets.
  assert.equal(asked.length, 9, JSON.stringify(asked.map((c) => c.path)));
  assert.ok(!calls.slice(mark).some((c) => /collections|reputations|professions|pvp-summary|commodities|auctions/.test(c.path)), 'collections are not part of a Retail fetch, and commodities never');
  await run({ key: 'moon-guard/jaina', priority: PRIORITY.lookup, mode: 'full' });
  await run({ key: 'area-52/rookie', priority: PRIORITY.lookup, mode: 'full' });

  const pools = await t.db.query("SELECT id, category_key, name FROM rulesets WHERE game_version = 'retail'");
  assert.deepEqual(pools.map((p) => [p.category_key, p.name]), [['region:us', 'US realms']]);
  const chars = await t.db.query("SELECT slug, realm_slug, realm_type, ruleset_id, faction FROM characters WHERE game_version = 'retail' ORDER BY slug");
  assert.deepEqual(chars.map((c) => [c.slug, c.realm_slug, c.realm_type, c.faction]), [['jaina', 'moon-guard', 'RP', 'Alliance'], ['rookie', 'area-52', 'NORMAL', 'Horde'], ['thrall', 'area-52', 'NORMAL', 'Horde']]);
  assert.ok(chars.every((c) => c.ruleset_id === pools[0].id));

  // Season boards exist only for what Blizzard answered: thrall has Mythic+ and 2v2; nobody has 3v3 or rbg.
  const season = await t.db.query("SELECT s.derived, s.name, cs.value FROM statistics s JOIN character_statistics cs ON cs.statistic_id = s.id WHERE s.game_version = 'retail' AND s.derived LIKE 'season:%' ORDER BY s.derived");
  assert.deepEqual(season.map((s) => [s.derived, s.value]), [
    ['season:mplus:15:best_level', 15], ['season:mplus:15:rating', 2450.4],
    ['season:pvp:40:2v2:played', 40], ['season:pvp:40:2v2:rating', 1800], ['season:pvp:40:2v2:won', 25],
  ]);
  assert.equal(season[1].name, 'Mythic+ rating (season 15)');
  // No equipment board, no trimmed character-stats board, was ever made; the kept ones were.
  const feed = (await t.db.query("SELECT derived FROM statistics WHERE game_version = 'retail' AND derived LIKE 'feed:%'")).map((r) => r.derived);
  assert.ok(feed.includes('feed:statistics:health') && feed.includes('feed:statistics:main_hand_dps') && feed.includes('feed:profile:equipped_item_level'));
  assert.ok(!feed.some((k) => k.startsWith('feed:equipment:') || /rating_normalized|:power$|:mana_regen$|damage_min|spell_penetration/.test(k)), JSON.stringify(feed));
});

test('the versioned API: a character by realm and name, with its realm, season cards and one-pool tiers text', async () => {
  const res = await api('/characters/area-52/thrall');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
  const c = res.json.character;
  assert.deepEqual([c.slug, c.version, c.name, c.surname, c.faction], ['area-52/thrall', 'retail', 'Thrall', '', 'Horde']);
  assert.deepEqual(c.realm, { slug: 'area-52', name: 'Area 52', type: 'NORMAL', typeName: 'Normal' });
  assert.deepEqual([c.ruleset.name, c.accountWide, res.json.scope.onePool], ['US realms', true, true]);
  assert.deepEqual(c.guild, { name: 'Fixture Alliance', slug: 'area-52/fixture-alliance', faction: 'Horde' });
  const cards = res.json.statistics.seasons;
  assert.deepEqual(cards.map((s) => [s.kind, s.seasonId, s.bracket, Object.keys(s.fields).sort().join(',')]), [['mplus', 15, null, 'best_level,rating'], ['pvp', 40, '2v2', 'played,rating,won']]);
  assert.equal(cards[0].fields.rating.rank, 1);
  // Blizzard's "Legacy" statistics are filed as "Past seasons" on Retail; the Everstats-made boards have their own groups.
  const labels = res.json.statistics.categories.map((x) => x.label);
  assert.ok(labels.includes('Past seasons') && !labels.includes('Legacy'), labels.join(', '));
  for (const g of ['Season ratings', 'Character stats (gear)', 'Combat', 'Delves', 'Pet Battles']) assert.ok(labels.includes(g), `${g} in ${labels.join(', ')}`);
  // The same key written the API's own way works too, and a Forever-shaped address doesn't.
  assert.equal((await api('/characters/area-52~thrall')).json.status, 'ok');
  assert.equal((await api('/characters/thrall-durotan')).status, 400);
  // The unprefixed (Forever) API knows nothing of it.
  assert.ok(!JSON.stringify((await t.client().get('/api/search?q=thr')).json).includes('Thrall'));
  assert.equal((await t.client().get('/api/leaderboards')).json.rulesets.length, 0, 'no Forever ruleset was made by Retail characters');
});

test('leaderboards: one pool; RP is a filter that recounts ranks and "of N" inside it; an unknown type is ignored', async () => {
  const all = await api('/leaderboards');
  assert.equal(all.status, 200);
  assert.deepEqual([all.json.scope.version, all.json.rulesets.length, all.json.ruleset.name, all.json.population, all.json.tracked], ['retail', 1, 'US realms', 3, 3]);
  assert.deepEqual(all.json.realmTypes.map((x) => [x.key, x.name, x.tracked]), [['NORMAL', 'Normal', 2], ['RP', 'Roleplaying', 1]]);
  const kills = all.json.categories.flatMap((c) => c.boards).find((b) => b.name === 'Creatures killed');
  assert.deepEqual(kills.top.map((r) => [r.rank, r.slug, r.realm, r.realmType]), [[1, 'area-52/thrall', 'area-52', 'NORMAL'], [2, 'moon-guard/jaina', 'moon-guard', 'RP'], [3, 'area-52/rookie', 'area-52', 'NORMAL']]);
  const pool = all.json.ruleset.id;
  const board = await api(`/leaderboards/${pool}/${kills.id}`);
  assert.deepEqual(board.json.rows.map((r) => [r.rank, r.name]), [[1, 'Thrall'], [2, 'Jaina'], [3, 'Rookie']]);

  const rp = await api('/leaderboards?realmType=RP');
  assert.deepEqual([rp.json.filter, rp.json.population], [{ realmType: 'RP' }, 1]);
  assert.deepEqual(rp.json.categories.flatMap((c) => c.boards).find((b) => b.id === kills.id).top.map((r) => [r.rank, r.name]), [[1, 'Jaina']]);
  const rpBoard = await api(`/leaderboards/${pool}/${kills.id}?realmType=RP`);
  assert.deepEqual([rpBoard.json.rows.map((r) => [r.rank, r.name]), rpBoard.json.nonzero, rpBoard.json.population], [[[1, 'Jaina']], 1, 1]);
  const bogus = await api(`/leaderboards/${pool}/${kills.id}?realmType=${encodeURIComponent("RP' OR 1=1 --")}`);
  assert.deepEqual([bogus.json.filter, bogus.json.rows.length], [null, 3], 'a type Blizzard doesn’t list is no filter at all');
  // Tiers are one pool: the tier board lists the pool and nothing else.
  assert.deepEqual((await api('/tiers/boards')).json.rulesets.map((r) => r.name), ['US realms']);
});

test('collections on demand: no backfill and nothing at fetch time; a look-up queues them; decor, the Warband note, the index threshold', async () => {
  const { runBackfill } = await import('../collections/backfill.js');
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'crawler.paused', false);
  const out = await runBackfill(t.db);
  assert.ok(!(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections' AND game_version = 'retail'")), `the backfill never queues Retail (${out})`);
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM characters WHERE game_version = 'retail' AND collections_fetched_at IS NOT NULL")).n, 0);

  // Someone looks keyrunner up: the look-up itself queues the first collections fetch, behind it.
  const mark = calls.length;
  const res = await t.client({ ip: '198.51.100.77' }).get('/api/v/retail/us/characters/moon-guard/keyrunner');
  assert.equal(res.json.status, 'ok');
  await drain();
  const asked = calls.slice(mark).map((c) => c.path).filter((p) => p.includes('/keyrunner/'));
  assert.ok(asked.some((p) => p.endsWith('/collections/decor')) && asked.some((p) => p.endsWith('/collections/heirlooms')) && asked.some((p) => p.endsWith('/reputations')), asked.join('\n'));
  assert.ok(!calls.slice(mark).some((c) => /commodities/.test(c.path)));

  const tab = await api('/characters/moon-guard/keyrunner/collections');
  assert.deepEqual([tab.json.status, tab.json.accountWide, tab.json.onDemand, tab.json.versionName], ['ok', true, true, 'World of Warcraft']);
  const count = (key) => tab.json.counts.find((k) => k.key === key);
  assert.deepEqual([count('decor-kinds').value, count('decor-total').value, count('mounts').value], [2, 4, 1]);
  assert.ok(!tab.json.counts.some((k) => k.key === 'legacy'), 'Legacy Points are WoW Forever’s');
  assert.ok(tab.json.sections.some((s) => s.id === 'decor' && s.summary.have === 2 && s.summary.owned === 4));
  const decor = await api('/characters/moon-guard/keyrunner/collections/decor');
  assert.deepEqual(decor.json.section.collected.map((d) => [d.name, d.quantity]), [['Fixture Table', 3], ['Fixture Ivy', 1]]);
  assert.equal(decor.json.section.total, null, 'no catalog: collected only, never a made-up total');
  // Forever characters are never asked for decor (its registry entry has none): no decor board on Forever.
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM statistics WHERE game_version = 'forever' AND derived LIKE 'decor%'")).n, 0);

  // The index leaves per-faction boards off until 25 are ranked (they exist, and say how many are held back).
  const idx = await api('/leaderboards');
  const reps = idx.json.categories.find((c) => c.label === 'Reputations');
  assert.deepEqual([idx.json.minIndexEntries, reps.boards.length, reps.unlisted], [25, 0, 2]);
  const rolled = idx.json.categories.find((c) => c.label === 'Collections').boards.map((b) => b.name);
  assert.ok(rolled.includes('Exalted reputations') && rolled.includes('Decor collected (different pieces)'), rolled.join(', '));
  await setSetting(t.db, 'boards.minIndexEntries', 0);
  const open = (await api('/leaderboards')).json.categories.find((c) => c.label === 'Reputations');
  assert.deepEqual([open.boards.map((b) => b.name).sort(), open.unlisted], [['Fixture City: Standing: Raw (reputations)', 'Fixture Council: Standing: Renown level (reputations)'], 0]);
  await setSetting(t.db, 'boards.minIndexEntries', 25);
  // The per-faction board itself always answers, and says the collection is account-wide where it is.
  const mounts = idx.json.categories.find((c) => c.label === 'Collections').boards.find((b) => b.name === 'Mounts collected');
  const mb = await api(`/leaderboards/${idx.json.ruleset.id}/${mounts.id}`);
  assert.deepEqual([mb.json.scope.accountWide, Boolean(mb.json.collection?.how), mb.json.statistic.everstatsMade], [true, true, true]);
});

test('a guild: its own faction, each member’s own (never inferred), found by realm and name; opened rosters seed inside a daily cap', async () => {
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'seeding.openedGuildsPerDay', 1);
  const res = await t.client({ ip: '198.51.100.78' }).get('/api/v/retail/us/guilds/area-52/fixture-alliance');
  assert.equal(res.json.status, 'ok', JSON.stringify(res.json).slice(0, 300));
  assert.deepEqual([res.json.guild.slug, res.json.guild.realm, res.json.guild.faction, res.json.scope.version, res.json.seeding], ['area-52/fixture-alliance', 'area-52', 'Horde', 'retail', 'opened']);
  // Members are those whose OWN profile names the guild: thrall (Horde) and jaina (Alliance, on another realm).
  assert.deepEqual(res.json.roster.map((m) => [m.slug, m.faction, m.realm, m.rank]).sort(), [['area-52/thrall', 'Horde', 'area-52', 0], ['moon-guard/jaina', 'Alliance', 'moon-guard', 1]]);
  // rookie is on the roster with no faction of its own there: its faction is what its own profile said (it was
  // fetched earlier), and a member never fetched would have none: never the guild's.
  const { parseRoster } = await import('../crawler/parse.js');
  const parsed = parseRoster({ guild: { faction: { type: 'HORDE', name: 'Horde' } }, members: [{ rank: 3, character: { id: 1, name: 'Nofaction', realm: { slug: 'area-52' }, level: 80, key: href('/profile/wow/character/area-52/nofaction', 'profile-us') } }] }, { realms: true });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].faction, null);
  // Everyone on this roster is tracked already, so nothing was seeded; the cap is counted per day and version.
  assert.equal((await t.db.one("SELECT coalesce(sum(queued), 0)::int AS n FROM seeding_days WHERE source = 'guild-roster'")).n, 0);
  const { seedFromRoster } = await import('../crawler/seeding.js');
  const fresh = [{ id: 990001, slug: 'newone', realmSlug: 'area-52', level: 80 }, { id: 990002, slug: 'newtwo', realmSlug: 'area-52', level: 80 }, { id: 990003, slug: 'lowbie', realmSlug: 'area-52', level: 5 }];
  assert.equal(await seedFromRoster(t.db, { scope: RETAIL, members: fresh }), 1, 'the daily cap');
  assert.equal(await seedFromRoster(t.db, { scope: RETAIL, members: fresh }), 0, 'the cap is spent for today');
  assert.equal(await seedFromRoster(t.db, { scope: { version: 'forever', region: 'us' }, members: fresh }), 0, 'Forever keeps its own roster expansion');
  await t.db.query("DELETE FROM crawl_queue WHERE key LIKE 'area-52/new%'");
  // The guild's boards and page live in the one pool.
  assert.equal((await api('/guilds')).json.ruleset?.name ?? 'US realms', 'US realms');
});

test('finding characters: the realm list comes from Blizzard; Mythic+ leaderboard members are queued inside the daily cap, one realm a step', async () => {
  const { refreshRealms, seedFromMythicLeaderboards } = await import('../crawler/seeding.js');
  const { setSetting } = await import('../admin/settings.js');
  assert.equal(await refreshRealms({ db: t.db, client: crawler.client }, RETAIL), 2);
  const realms = await api('/realms');
  assert.deepEqual(realms.json.realms, [{ slug: 'area-52', name: 'Area 52', type: 'NORMAL', typeName: 'Normal' }, { slug: 'moon-guard', name: 'Moon Guard', type: 'RP', typeName: 'Roleplaying' }]);
  assert.deepEqual((await t.client().get('/api/realms')).json.realms, [], 'WoW Forever has no realms');

  await setSetting(t.db, 'seeding.mythicPlusPerDay', 0);
  assert.match(await seedFromMythicLeaderboards({ db: t.db, client: crawler.client }, RETAIL), /off/);
  await setSetting(t.db, 'seeding.mythicPlusPerDay', 1);
  const mark = calls.length;
  const line = await seedFromMythicLeaderboards({ db: t.db, client: crawler.client }, RETAIL);
  assert.match(line, /3 leaderboard members, 1 new queued \(1 of 1 today\)/);
  const asked = calls.slice(mark).map((c) => c.path).filter((p) => p.includes('mythic-leaderboard'));
  assert.deepEqual(asked, ['/data/wow/connected-realm/3675/mythic-leaderboard/index', '/data/wow/connected-realm/3675/mythic-leaderboard/249/period/1088'], 'the index, then the leaderboard by its own link');
  assert.match(await seedFromMythicLeaderboards({ db: t.db, client: crawler.client }, RETAIL), /today's 1 queued/);
  await drain();
  assert.equal((await t.db.one("SELECT source FROM characters WHERE slug = 'newkey' AND game_version = 'retail'")).source, 'guild', 'fetched at the lowest priority, like a roster member');
  assert.equal(await seedFromMythicLeaderboards({ db: t.db, client: crawler.client }, { version: 'forever', region: 'us' }), 'not on this version');
  assert.ok(leaderboardHits >= 1);
});

test('search across versions: every result says its version and realm; a version’s own search stays its own', async () => {
  const all = await t.client().get('/api/search/all?q=thr');
  assert.deepEqual(all.json.results.map((r) => r.scope.version), ['forever', 'retail']);
  const retail = all.json.results.find((r) => r.scope.version === 'retail');
  assert.deepEqual(retail.characters.map((c) => [c.slug, c.realm, c.name]), [['area-52/thrall', 'area-52', 'Thrall']]);
  assert.deepEqual(all.json.results.find((r) => r.scope.version === 'forever').characters, []);
  assert.deepEqual((await api('/search?q=fixture')).json.guilds.map((g) => [g.slug, g.realm]), [['area-52/fixture-alliance', 'area-52']]);
  // Link previews and card addresses live under the version's prefix, a character as realm/name.
  const { linkPreviewFor } = await import('../cards/meta.js');
  const p = await linkPreviewFor(t.db, '/retail/us/c/area-52/thrall', {});
  assert.equal(p.title, 'Thrall');
  assert.match(p.image ?? '', /^\/retail\/us\/og\/c\/area-52\/thrall\.png\?v=/);
  assert.equal((await linkPreviewFor(t.db, '/classic/us/c/area-52/thrall', {})).title, 'Everstats', 'a version that is off has no preview');
});

test('group choices: Retail’s are written once as the owner decided; Everstats-made boards follow group choices and Forever’s plan is unchanged', async () => {
  const { ensureGroupsMigrated, migrateDerivedGroups, planFingerprint, seedVersionGroups } = await import('../tiers/groups.js');
  const { clearCatalogCache, loadCatalogFresh } = await import('../stats/catalog.js');
  const { gradingPlan, whatCounts } = await import('../tiers/counting.js');
  // A Forever catalog with history: a counted group, an Everstats-made count the owner approved on its own, another
  // that only its group's choice could reach, and (the trap) a "counts" choice on the Collections group itself.
  await t.db.query(`INSERT INTO statistics (id, name, category_path, game_version) VALUES (4107, 'Fixture kills', '[{"id":128,"name":"Kills"}]'::jsonb, 'forever')`);
  await t.db.query(`INSERT INTO statistics (id, name, category_path, derived, game_version) VALUES
    (2000000001, 'Mounts collected', '[{"id":null,"name":"Collections"}]'::jsonb, 'mounts', 'forever'),
    (2000000003, 'Toys collected', '[{"id":null,"name":"Collections"}]'::jsonb, 'toys', 'forever'),
    (2000050001, 'Health (character stats)', '[{"id":null,"name":"Character"}]'::jsonb, 'feed:statistics:health', 'forever')
    ON CONFLICT (id) DO NOTHING`);
  await t.db.query("INSERT INTO discovery_group_decisions (game_version, group_label, choice, reasoning) VALUES ('forever', 'Combat', 'counts', 'fixture'), ('forever', 'Collections', 'counts', 'fixture')");
  for (const [kind, value] of [['category', 'Collections'], ['grading', 'overall']]) {
    await t.db.query("INSERT INTO discovery_decisions (statistic_id, kind, value, decision, game_version) VALUES (2000000001, $1, $2::jsonb, 'approved', 'forever')", [kind, JSON.stringify(value)]);
  }
  await t.db.query("DELETE FROM pipeline_facts WHERE key IN ('derived_groups_migrated_at', 'tier_groups_seeded_at:retail')");
  await t.db.query("INSERT INTO pipeline_facts (key, at) VALUES ('tier_groups_migrated_at', now()) ON CONFLICT DO NOTHING");
  clearCatalogCache();
  const plan = async (version) => planFingerprint(gradingPlan(whatCounts(await loadCatalogFresh(t.db, { version }))));
  const role = async (id, version = 'forever') => (await loadCatalogFresh(t.db, { version })).statistics.get(id)?.tierRole;
  const before = await plan('forever');
  assert.deepEqual([await role(4107), await role(2000000001), await role(2000000003), await role(2000050001)], ['counted', 'counted', 'undecided', 'undecided']);

  const done = await migrateDerivedGroups(t.db, { log: {} });
  assert.equal(done.done, true);
  assert.equal(await plan('forever'), before, 'what counts on Forever is exactly what it was');
  // Toys sat in a group that "counts": it would have started counting, so it is exempt and counts nothing, as before.
  assert.deepEqual([await role(2000000001), await role(2000000003)], ['counted', 'undecided']);
  assert.ok(done.versions.find((v) => v.version === 'forever').exempt >= 1, 'every count the Collections choice would have started counting is exempt');
  // A feed board now sits in its own group, which starts at "Doesn't count": leaderboard only, not "undecided".
  const cat = await loadCatalogFresh(t.db, { version: 'forever' });
  assert.deepEqual([cat.statistics.get(2000050001).category, cat.statistics.get(2000050001).tierRole], ['Character stats (gear)', 'bad']);
  assert.equal((await migrateDerivedGroups(t.db, { log: {} })).done, false, 'once');

  // Retail: the owner's choices, once; changing one afterwards sticks.
  const seeded = await seedVersionGroups(t.db, { log: {} });
  assert.deepEqual(seeded.map((s) => s.version), ['retail']);
  const choices = new Map((await t.db.query("SELECT DISTINCT ON (group_label) group_label, choice FROM discovery_group_decisions WHERE game_version = 'retail' ORDER BY group_label, id DESC")).map((r) => [r.group_label, r.choice]));
  for (const g of ['Dungeons & Raids', 'Combat', 'Adventure', 'Professions', 'PvP', 'Character', 'Delves']) assert.equal(choices.get(g), 'counts', g);
  for (const g of ['Social', 'Camping & Hearth', 'Pet Battles']) assert.equal(choices.get(g), 'category', g);
  for (const g of ['Deaths & mishaps', 'Past seasons', 'Legion: Remix', 'Dastardly Duos', 'Reputation', 'Collections', 'Guild']) assert.equal(choices.get(g), 'none', g);
  assert.equal(choices.has('Legacy'), false);
  const rc = await loadCatalogFresh(t.db, { version: 'retail' });
  const by = (name) => [...rc.statistics.values()].find((s) => s.name === name);
  assert.deepEqual([by('Creatures killed').tierRole, by('Delves completed').tierRole, by('Total deaths').tierRole, by('Old season keys').tierRole], ['counted', 'counted', 'bad', 'bad']);
  assert.deepEqual([by('Pet battles won').tierRole, by('Pet battles won').countsOverall], ['counted', false], 'its own category letter only');
  assert.deepEqual([by('Old season keys').category, by('Mythic+ rating (season 15)').category, by('Mythic+ rating (season 15)').tierRole], ['Past seasons', 'Season ratings', 'bad']);
  assert.equal(by('Mounts collected').tierRole, 'bad', 'Collections: doesn’t count');
  const { setGroupChoice, groupsView } = await import('../tiers/groups.js');
  await setGroupChoice(t.db, { version: 'retail', group: 'Season ratings', choice: 'category', reasoning: 'test' });
  assert.equal((await loadCatalogFresh(t.db, { version: 'retail' })).statistics.get(by('Mythic+ rating (season 15)').id).tierRole, 'counted', 'a group choice covers Everstats-made boards like any group');
  assert.equal((await seedVersionGroups(t.db, { log: {} })).length, 0, 'never written again');
  const view = await groupsView(t.db, 'retail');
  const gear = view.groups.find((g) => g.label === 'Character stats (gear)');
  assert.deepEqual([gear.everstatsMade, gear.choice.choice, gear.choice.origin], [true, 'none', 'default']);
  // The worker's own entry point is a no-op now, and what counts on Forever still hasn't moved.
  await ensureGroupsMigrated(t.db, { log: { log() {}, error() {} } });
  assert.equal(await plan('forever'), before);
});
