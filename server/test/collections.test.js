import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { PRIORITY } from '../crawler/queue.js';

// A fake Blizzard shaped like the 0.8.3 probe's stored responses (run #4). Every name and number here is a test
// fixture, never shipped data. Requests are counted per path so the tests can measure what each flow costs.
const API = 'https://us.api.blizzard.com';
const NS = 'static-9.9.9_1-forever-us';
const href = (p, ns = NS) => `${API}${p}?namespace=${ns}`;
const calls = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Position, bind position and the WoW account id: distinctive values the gold test hunts for in every table.
const SECRET = { zone: 'Zzsecretzone', x: 4242.4242, account: 98765432123 };

const chars = new Map();
function addCharacter(slug, { id, cls = 'Priest', level = 30, mounts = [3001], pets = [[5154, 3]], toys = [1692], appearances = { HEAD: [11, 12], CHEST: [21] }, achievements = [], reps = [], quests = 3, titles = [] }) {
  const [name, surname] = slug.split('-').map((x) => x[0].toUpperCase() + x.slice(1));
  chars.set(slug, { id, slug, name, surname, cls, level, mounts, pets, toys, appearances, achievements, reps, quests, titles });
}
const accounts = new Map();

function characterResponse(c, sub) {
  const link = { _links: { self: { href: `${API}/profile/wow/character/${c.slug}${sub}?namespace=profile-forever-us` } } };
  switch (sub) {
    case '': return {
      ...link, id: c.id, name: c.name, surname: c.surname, level: c.level, faction: { type: 'HORDE', name: 'Horde' }, race: { name: 'Undead' },
      character_class: { name: c.cls }, ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000,
    };
    case '/achievements/statistics': return { categories: [{ id: 130, name: 'Character', statistics: [{ id: 60, name: 'Total deaths', quantity: 3 }] }] };
    case '/statistics': return { health: 100 };
    case '/equipment': return { equipped_items: [{ slot: { type: 'HEAD', name: 'Head' }, name: 'Fixture Hood', quality: { type: 'RARE' }, item: { id: 900 }, transmog: { item: { id: 901, name: 'Fixture Veil' } } }] };
    case '/character-media': return { assets: [] };
    case '/collections/mounts': return { ...link, mounts: c.mounts.map((id) => ({ mount: { key: { href: href(`/data/wow/mount/${id}`) }, name: `Mount ${id}`, id }, is_useable: true })) };
    case '/collections/pets': return { ...link, pets: c.pets.map(([sp, lvl], i) => ({ species: { key: { href: href(`/data/wow/pet/${sp}`) }, name: `Pet ${sp}`, id: sp }, level: lvl, quality: { type: 'UNCOMMON', name: 'Uncommon' }, stats: { breed_id: 0, health: 100, power: 0, speed: 0 }, id: 1000 + i })), unlocked_battle_pet_slots: 0 };
    case '/collections/toys': return { ...link, toys: c.toys.map((id) => ({ toy: { key: { href: href(`/data/wow/toy/${id}`) }, name: `Toy ${id}`, id } })) };
    case '/collections/transmogs': return { ...link, slots: Object.entries(c.appearances).map(([type, ids]) => ({ slot: { type, name: type[0] + type.slice(1).toLowerCase() }, appearances: ids.map((id) => ({ key: { href: href(`/data/wow/item-appearance/${id}`) }, id })) })) };
    case '/titles': return c.titles.length ? { ...link, titles: c.titles.map((id) => ({ name: `Title ${id}`, id })), active_title: { name: `Title ${c.titles[0]}`, id: c.titles[0] } } : link;
    case '/achievements': return { ...link, total_quantity: c.achievements.length, total_points: 0, achievements: c.achievements.map(([id, done]) => ({ id, achievement: { name: `Ach ${id}`, id }, criteria: { id: id * 10, is_completed: done }, ...(done ? { completed_timestamp: 1794178440000 } : {}) })) };
    case '/reputations': return { ...link, reputations: c.reps.map(([id, standing]) => ({ faction: { name: `Faction ${id}`, id }, standing: { raw: 1, value: 1, max: 3000, tier: 3, name: standing } })) };
    case '/professions': return { ...link, primaries: [{ profession: { name: 'Tailoring', id: 197 }, tiers: [{ skill_points: 98, max_skill_points: 150, tier: { name: 'Tailoring', id: 2948 }, known_recipes: [{ id: 1 }] }] }] };
    case '/quests': return { ...link, in_progress: [{ name: 'Fixture quest', id: 77 }] };
    case '/quests/completed': return { ...link, quests: Array.from({ length: c.quests }, (_, i) => ({ name: i === 1 ? 'The Weaver' : `Done ${i}`, id: 500 + i })) };
    case '/encounters/dungeons': return link;
    case '/encounters/raids': return link;
    case '/pvp-summary': return { ...link, honorable_kills: 4, pvp_rank: 0 };
    case '/hunter-pets': return c.cls === 'Hunter' ? { ...link, hunter_pets: [{ name: 'Fang', level: 20, creature: { name: 'Wolf', id: 1 }, is_active: true }] } : null;
    default: return null;
  }
}

const CATALOG = {
  '/data/wow/mount/index': { mounts: [{ id: 3001, name: 'Mount 3001' }, { id: 3002, name: 'Mount 3002' }] },
  '/data/wow/mount/3001': { id: 3001, creature_displays: [{ id: 51 }] },
  '/data/wow/mount/3002': { id: 3002, creature_displays: [{ id: 52 }] },
  '/data/wow/media/creature-display/51': { assets: [{ key: 'zoom', value: 'https://render.worldofwarcraft.com/forever-us/npcs/zoom/creature-display-51.jpg' }] },
  '/data/wow/media/creature-display/52': { assets: [{ key: 'zoom', value: 'https://evil.example/52.jpg' }] },
  '/data/wow/pet/index': { pets: [{ id: 5154, name: 'Pet 5154' }] },
  '/data/wow/pet/5154': { id: 5154, icon: 'https://render.worldofwarcraft.com/forever-us/icons/56/1.jpg', battle_pet_type: { name: 'Critter' } },
  '/data/wow/toy/index': { toys: [{ id: 1692, name: 'Toy 1692' }] },
  '/data/wow/toy/1692': { id: 1692, item: { id: 269900 }, media: { id: 269900 } },
  '/data/wow/media/item/269900': { assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/forever-us/icons/56/2.jpg' }] },
  '/data/wow/heirloom/index': {},
  '/data/wow/title/index': { titles: [{ id: 30, name: 'Champion' }, { id: 31, name: 'Marshal' }] },
  '/data/wow/achievement/index': { achievements: [{ id: 62041, name: 'Rank 3' }, { id: 62042, name: 'Rank 7' }, { id: 62043, name: 'Odd one' }, { id: 62044, name: 'Tabard' }] },
  '/data/wow/achievement/62041': { id: 62041, name: 'Rank 3', category: { id: 15597, name: 'Ranks' }, points: 0, is_account_wide: true, criteria: { id: 1, description: 'Rank 3', amount: 0 }, reward_description: 'Earn 1 Legacy Point.', media: { id: 62041 } },
  '/data/wow/achievement/62042': { id: 62042, name: 'Rank 7', category: { id: 15597, name: 'Ranks' }, points: 0, is_account_wide: true, criteria: { id: 2, amount: 0 }, reward_description: 'Earn 3 Legacy Points.' },
  '/data/wow/achievement/62043': { id: 62043, name: 'Odd one', category: { id: 15597, name: 'Ranks' }, points: 0, is_account_wide: true, criteria: { id: 3, amount: 0 }, reward_description: 'Earn a Legacy Point and a hat.' },
  '/data/wow/achievement/62044': { id: 62044, name: 'Tabard', category: { id: 15598, name: 'Other' }, points: 0, is_account_wide: false, criteria: { id: 4, amount: 0 }, reward_description: 'Reward: Tabard' },
  '/data/wow/media/achievement/62041': { assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/forever-us/icons/56/3.jpg' }] },
  '/data/wow/achievement-category/index': { categories: [{ id: 15597, name: 'Ranks' }], root_categories: [{ id: 15597, name: 'Ranks' }] },
  '/data/wow/achievement-category/15597': { id: 15597, name: 'Ranks', subcategories: [] },
  '/data/wow/reputation-faction/index': { factions: [{ id: 892, name: 'Horde Forces' }, { id: 81, name: 'Faction 81' }], root_factions: [{ id: 892, name: 'Horde Forces' }] },
  '/data/wow/reputation-faction/892': { id: 892, name: 'Horde Forces', factions: [{ id: 81, name: 'Faction 81' }] },
  '/data/wow/reputation-faction/81': { id: 81, name: 'Faction 81', reputation_tiers: { id: 0 } },
  '/data/wow/item-appearance/slot/index': { slots: [{ key: { href: href('/data/wow/item-appearance/slot/HEAD') } }, { key: { href: href('/data/wow/item-appearance/slot/CHEST') } }] },
  '/data/wow/item-appearance/slot/HEAD': { appearances: [{ id: 11 }, { id: 12 }, { id: 13 }] },
  '/data/wow/item-appearance/slot/CHEST': { appearances: [{ id: 21 }, { id: 22 }] },
  '/data/wow/item-appearance/set/index': { appearance_sets: [{ id: 3634, name: 'Fixture Set' }] },
  '/data/wow/item-appearance/set/3634': { id: 3634, set_name: 'Fixture Set', appearances: [{ id: 11 }, { id: 13 }] },
};
for (const [id, slot, cls, sub] of [[11, 'HEAD', 'Armor', 'Plate'], [12, 'HEAD', 'Armor', 'Cloth'], [13, 'HEAD', 'Armor', 'Plate'], [21, 'CHEST', 'Armor', 'Mail'], [22, 'CHEST', 'Armor', 'Mail']]) {
  CATALOG[`/data/wow/item-appearance/${id}`] = { id, slot: { type: slot, name: slot }, item_class: { id: 4, name: cls }, item_subclass: { id: 1, name: sub }, items: [{ id: id * 100, name: `Item ${id}` }], media: { id: id * 100 } };
  CATALOG[`/data/wow/media/item/${id * 100}`] = { assets: [{ key: 'icon', value: `https://render.worldofwarcraft.com/forever-us/icons/56/${id}.jpg` }] };
}

async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  calls.push(u.pathname + (u.pathname.startsWith('/data/wow/search') ? u.search : ''));
  const auth = String(opts.headers?.Authorization ?? '');
  if (u.href === 'https://oauth.battle.net/token') {
    const body = new URLSearchParams(String(opts.body));
    if (body.get('grant_type') === 'client_credentials') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
    return json(200, { access_token: `tok-${body.get('code')}`, token_type: 'bearer' });
  }
  if (u.href === 'https://oauth.battle.net/userinfo') return json(200, { sub: `bnet-${auth.replace('Bearer tok-', '')}`, battletag: 'Fixture#1' });
  if (u.origin !== API) return json(404, {});
  if (u.pathname === '/data/wow/ruleset/index') return json(200, { rulesets: [] });
  if (u.pathname === '/profile/user/wow') {
    const who = auth.replace('Bearer tok-', '');
    const list = accounts.get(who);
    if (!list) return json(404, {});
    return json(200, { wow_accounts: [{ id: SECRET.account, characters: list.map((c) => ({ character: { href: `${API}/profile/wow/character/${c.slug}?namespace=profile-forever-us` }, protected_character: { href: `${API}/profile/user/wow/protected-character/6929-${c.id}?namespace=profile-forever-us` }, id: c.id, name: c.name, surname: c.surname, level: c.level })) }] });
  }
  const pc = /^\/profile\/user\/wow\/protected-character\/6929-(\d+)$/.exec(u.pathname);
  if (pc) {
    if (!auth.startsWith('Bearer tok-')) return json(403, {});
    const id = Number(pc[1]);
    return json(200, {
      id, name: 'X', money: 34046, protected_stats: { total_number_deaths: 41, total_gold_gained: 167982, total_gold_lost: 133936, total_item_value_gained: 139827, level_gold_gained: 37184 },
      position: { zone: { name: SECRET.zone, id: 1497 }, map: { name: 'Eastern Kingdoms', id: 0 }, x: SECRET.x, y: 729.9, z: 88.1, facing: 0.1 },
      bind_position: { zone: { name: SECRET.zone, id: 1497 }, x: SECRET.x, y: 221.5, z: -43.1 }, wow_account: SECRET.account,
    });
  }
  if (u.pathname === '/data/wow/search/item') {
    const from = Number(/\[(\d+),\]/.exec(u.searchParams.get('id') ?? '')?.[1] ?? 0);
    const items = [1100, 1200, 1300, 2100, 2200].filter((id) => id >= from).map((id) => ({ data: { id, name: { en_US: `Item ${id / 100}` }, quality: { type: id === 1300 ? 'EPIC' : 'RARE' }, appearances: [{ id: id / 100 }] } }));
    return json(200, { page: 1, pageCount: 1, results: items });
  }
  if (FAILING.has(u.pathname)) return json(500, {});
  if (CATALOG[u.pathname]) {
    if (!u.searchParams.get('namespace')?.startsWith('static-')) return json(404, {});
    return json(200, { _links: { self: { href: href(u.pathname) } }, ...CATALOG[u.pathname] });
  }
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  const c = m && chars.get(decodeURIComponent(m[1]));
  if (!c) return json(404, {});
  const body = characterResponse(c, m[2] ?? '');
  return body ? json(200, body) : json(404, {});
}

const FAILING = new Set();
let t;
let client;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  const { createCrawler } = await import('../crawler/service.js');
  // Not started: tests run each crawl item themselves, so request counts are exact.
  client = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } }).client;
});
after(async () => {
  await t.close();
});

const ctx = () => ({ db: t.db, client });
const since = (mark, re) => calls.slice(mark).filter((p) => re.test(p)).length;
async function fetchChar(slug) {
  const { fetchCharacter } = await import('../crawler/fetch.js');
  return fetchCharacter(ctx(), { key: slug, priority: PRIORITY.lookup, mode: 'full' });
}
async function fetchColl(slug, priority = PRIORITY.daily) {
  const { fetchCollections } = await import('../collections/fetch.js');
  return fetchCollections(ctx(), { key: slug, priority, attempts: 1 });
}
/** Runs every queued catalog item (and the ones they queue) until none is left. */
async function buildCatalogs() {
  const { queueDueCatalogs, fetchCatalogStep } = await import('../collections/catalog.js');
  await queueDueCatalogs(t.db);
  for (let i = 0; i < 200; i++) {
    const item = await t.db.one("UPDATE crawl_queue SET state = 'running', attempts = attempts + 1 WHERE id = (SELECT id FROM crawl_queue WHERE kind = 'catalog' AND state = 'queued' ORDER BY id LIMIT 1) RETURNING *");
    if (!item) return;
    let out;
    try {
      out = await fetchCatalogStep(ctx(), item);
    } catch (err) {
      // What the crawler does with a RetryableError: the same item, queued again (its attempts count goes up).
      if (err?.code !== 'blizzard') throw err;
      await t.db.query("UPDATE crawl_queue SET state = 'queued' WHERE id = $1", [item.id]);
      continue;
    }
    await t.db.query("UPDATE crawl_queue SET state = 'done', outcome = $2, finished_at = now() WHERE id = $1", [item.id, out]);
  }
  throw new Error('catalog build did not finish');
}
const COLLECTION_RE = /\/profile\/wow\/character\/[^/]+\/(collections|titles|achievements$|reputations|professions|quests|encounters|pvp-summary|hunter-pets)/;

test('a collections refresh is 13 requests (14 for a hunter), stores parsed lists and records the static namespace', async () => {
  addCharacter('alpha-coll', { id: 7001, achievements: [[62041, true], [62042, false], [62043, true]], reps: [[81, 'Exalted'], [82, 'Neutral']], titles: [30] });
  addCharacter('hunt-coll', { id: 7002, cls: 'Hunter' });
  await fetchChar('alpha-coll');
  await fetchChar('hunt-coll');
  // 0.9.2: a full fetch never queues a FIRST collections fetch (that sat behind every daily check); the backfill does,
  // capped per day, at daily priority, and only for characters that have none.
  assert.equal(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections' AND key = 'alpha-coll'"), null);
  const { runBackfill, backfillStatus } = await import('../collections/backfill.js');
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'collections.backfillPerDay', 50);
  assert.match(await runBackfill(t.db), /^Queued 2 first collections fetches \(2 of 50 today\)/);
  assert.ok(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections' AND key = 'alpha-coll' AND priority = $1", [PRIORITY.daily]));
  assert.match(await runBackfill(t.db), /Every tracked character has collections/); // queued ones aren't queued twice
  const bs = await backfillStatus(t.db);
  assert.deepEqual({ tracked: bs.tracked, done: bs.withCollections, today: bs.queuedToday, per: bs.perCharacter }, { tracked: 2, done: 0, today: 2, per: 13 });
  await setSetting(t.db, 'collections.backfill', false);
  assert.equal(await runBackfill(t.db), 'Off');
  await setSetting(t.db, 'collections.backfill', true);
  await t.db.query("DELETE FROM crawl_queue WHERE kind = 'collections'");
  let mark = calls.length;
  assert.match(await fetchColl('alpha-coll'), /13 of 13 returned/);
  assert.equal(since(mark, COLLECTION_RE), 13);
  mark = calls.length;
  assert.match(await fetchColl('hunt-coll'), /14 of 14 returned/);
  assert.equal(since(mark, /hunter-pets$/), 1);
  // Heirlooms aren't asked for: no heirloom catalog says any exist.
  assert.equal(since(0, /heirlooms$/), 0);
  const rows = await t.db.query("SELECT kind, state FROM character_collections WHERE character_id = 7001 ORDER BY kind");
  assert.equal(rows.find((r) => r.kind === 'mounts').state, 'ok');
  assert.equal(rows.find((r) => r.kind === 'raids').state, 'empty');
  assert.equal((await t.db.one("SELECT detail FROM collection_catalog_state WHERE kind = 'namespace'")).detail, NS);
  // No raw body anywhere: the stored mounts are parsed { id, name, useable }.
  const m = await t.db.one("SELECT data FROM character_collections WHERE character_id = 7001 AND kind = 'mounts'");
  assert.deepEqual(m.data.items, [{ id: 3001, name: 'Mount 3001', useable: true }]);
});

test('collection counts are statistics: boards, zero never ranked, and a stats refresh keeps them', async () => {
  const { COUNTS, countByKey } = await import('../collections/registry.js');
  const mounts = countByKey.get('mounts');
  const v = await t.db.one('SELECT value FROM character_statistics WHERE character_id = 7001 AND statistic_id = $1', [mounts.id]);
  assert.equal(v.value, 1);
  // Exalted with 1; titles 1; achievements earned 2; quests 3; appearances 3.
  const val = async (key) => (await t.db.one('SELECT value FROM character_statistics WHERE character_id = 7001 AND statistic_id = $1', [countByKey.get(key).id]))?.value ?? 0;
  assert.equal(await val('exalted'), 1);
  assert.equal(await val('achievements'), 2);
  assert.equal(await val('appearances'), 3);
  assert.equal(await val('quests'), 3);
  // Legacy Points can't be counted before the achievement catalog exists: no row, no guess.
  assert.equal(await val('legacy'), 0);
  // Every count is in the statistics table under the Collections category.
  const st = await t.db.query('SELECT id, derived FROM statistics WHERE derived IS NOT NULL ORDER BY id');
  // Heirlooms aren't registered while Blizzard's heirloom catalog has none; boss kills not until someone has one (0.9.1);
  // decor (0.11.1) never on Forever: its characters aren't asked for it.
  const fixed = st.filter((x) => !String(x.derived).includes(':')).map((x) => x.derived);
  assert.deepEqual(fixed.sort(), COUNTS.filter((c) => c.key !== 'heirlooms' && c.key !== 'boss-kills' && c.kind !== 'decor').map((c) => c.key).sort());
  // A board: both characters have one mount → tied at #1; a statistics refresh (storeDetails) leaves the counts alone.
  await fetchChar('alpha-coll');
  assert.equal(await val('mounts'), 1);
  const board = (await t.client().get(`/api/leaderboards/2/${mounts.id}`)).json;
  assert.equal(board.statistic.name, 'Mounts collected');
  assert.equal(board.statistic.category, 'Collections');
  assert.equal(board.nonzero, 2);
  // Population counts only characters whose collections were fetched.
  assert.equal(board.population, 2);
});

test('a first collections fetch is never a weekly gain', async () => {
  const { countByKey } = await import('../collections/registry.js');
  const gains = await t.db.query('SELECT gain FROM stat_gains WHERE character_id = 7001 AND statistic_id = $1', [countByKey.get('appearances').id]);
  assert.deepEqual(gains, []);
});

test('catalogs are built once, shared, in short items; heirlooms are empty and stay out', async () => {
  const mark = calls.length;
  await buildCatalogs();
  const state = Object.fromEntries((await t.db.query('SELECT kind, state, total, requests FROM collection_catalog_state')).map((r) => [r.kind, r]));
  assert.equal(state.mount.state, 'ok');
  assert.equal(state.mount.total, 2);
  assert.equal(state.heirloom.state, 'empty');
  assert.equal(state.appearance.total, 5);
  assert.equal(state.item.state, 'ok');
  // The measured cost is recorded per catalog: appearances = slot index + 2 slots + 5 details + 5 icons.
  assert.equal(state.appearance.requests, 13);
  assert.ok(since(mark, /^\/data\/wow\//) > 0);
  // Only render-host images are kept.
  const m = await t.db.one("SELECT data FROM collection_catalog WHERE kind = 'mount' AND id = 3002");
  assert.equal(m.data.icon, null);
  // Not due again: a second pass asks nothing.
  const again = calls.length;
  await buildCatalogs();
  assert.equal(calls.length, again);
});

test('Legacy Points: only "Earn N Legacy Point(s)" counts; account-wide because Blizzard says so', async () => {
  const { legacyPatterns, legacyPointsOf } = await import('../collections/legacy.js');
  assert.equal(legacyPointsOf('Earn 1 Legacy Point.'), 1);
  assert.equal(legacyPointsOf('Earn 3 Legacy Points.'), 3);
  assert.equal(legacyPointsOf('Earn a Legacy Point and a hat.'), null);
  const { catalogMap } = await import('../collections/catalog.js');
  const report = legacyPatterns([...(await catalogMap(t.db, 'achievement')).values()]);
  assert.deepEqual(report.counted.map((x) => x.text).sort(), ['Earn N Legacy Point.', 'Earn N Legacy Points.']);
  assert.deepEqual(report.uncounted.map((x) => x.text), ['Earn a Legacy Point and a hat.']);
  // Re-count with the catalog: 62041 earned (1 point), 62042 not earned, 62043 earned but not the pattern → 1.
  await fetchColl('alpha-coll');
  const { countByKey } = await import('../collections/registry.js');
  assert.equal((await t.db.one('SELECT value FROM character_statistics WHERE character_id = 7001 AND statistic_id = $1', [countByKey.get('legacy').id])).value, 1);
  const legacy = (await t.client().get('/api/characters/alpha-coll/collections/legacy')).json.section;
  assert.equal(legacy.points, 1);
  assert.deepEqual(legacy.earning.map((e) => e.id), [62041]);
  // 62044 (not a Legacy reward) says is_account_wide: false, but only Legacy-granting ones decide: all true.
  assert.equal(legacy.accountWide, true);
});

test('with catalogs: collected vs missing, N / total, the transmog tracker and Wowhead-ready item ids', async () => {
  const c = t.client({ ip: '198.51.100.40' });
  const tab = (await c.get('/api/characters/alpha-coll/collections')).json;
  assert.equal(tab.status, 'ok');
  const mounts = tab.counts.find((x) => x.key === 'mounts');
  assert.equal(mounts.value, 1);
  assert.equal(mounts.total, 2);
  assert.equal(mounts.rank, 1);
  assert.ok(!tab.counts.some((x) => x.key === 'heirlooms'), 'no heirloom count without heirlooms');
  assert.ok(!tab.sections.some((x) => x.id === 'heirlooms'), 'no empty heirlooms section');
  assert.ok(!tab.sections.some((x) => x.id === 'hunter-pets'), 'hunter pets for hunters only');
  const ms = (await c.get('/api/characters/alpha-coll/collections/mounts')).json.section;
  assert.deepEqual(ms.collected.map((x) => x.id), [3001]);
  assert.deepEqual(ms.missing.map((x) => x.id), [3002]);
  const tm = (await c.get('/api/characters/alpha-coll/collections/transmog?slot=HEAD')).json.section;
  assert.equal(tm.have, 3);
  assert.equal(tm.total, 5);
  assert.deepEqual(tm.slots.map((s) => [s.type, s.have, s.total]).sort(), [['CHEST', 1, 2], ['HEAD', 2, 3]]);
  const missing = tm.tiles.find((x) => x.id === 13);
  assert.equal(missing.collected, false);
  assert.equal(missing.armour, 'Plate');
  assert.equal(missing.quality, 'epic'); // from Blizzard's item search
  assert.deepEqual(missing.items, [{ id: 1300, name: 'Item 13', quality: 'epic' }]);
  assert.deepEqual(tm.sets, [{ id: 3634, name: 'Fixture Set', total: 2, have: 1 }]);
  assert.deepEqual(tm.worn, [{ slot: 'HEAD', slotName: 'Head', item: 'Fixture Hood', transmog: 'Fixture Veil' }]);
  const reps = (await c.get('/api/characters/alpha-coll/collections/reputations')).json.section;
  assert.equal(reps.exalted, 1);
  assert.equal(reps.groups.find((g) => g.name === 'Horde Forces').items[0].id, 81);
});

test('quests are searched and paged on the server', async () => {
  const q = (await t.client().get('/api/characters/alpha-coll/collections/quests?q=weaver')).json.section;
  assert.equal(q.completed.total, 3);
  assert.equal(q.completed.matched, 1);
  assert.equal(q.completed.items[0].name, 'The Weaver');
  assert.equal(q.inProgress.items[0].name, 'Fixture quest');
});

test('opening the tab on stale data queues a lookup-priority refresh; fresh data asks nothing', async () => {
  await t.db.query("DELETE FROM crawl_queue WHERE kind = 'collections'");
  const fresh = (await t.client({ ip: '198.51.100.41' }).get('/api/characters/alpha-coll/collections')).json;
  assert.equal(fresh.refreshing, false);
  await t.db.query("UPDATE characters SET collections_fetched_at = now() - interval '2 days' WHERE id = 7001");
  const stale = (await t.client({ ip: '198.51.100.41' }).get('/api/characters/alpha-coll/collections')).json;
  assert.equal(stale.refreshing, true);
  assert.ok(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections' AND key = 'alpha-coll' AND priority = $1", [PRIORITY.lookup]));
});

test('collection counts are listed in Discovery with a "not graded" suggestion, and count toward no tier', async () => {
  const { loadCatalogFresh } = await import('../stats/catalog.js');
  const { countByKey } = await import('../collections/registry.js');
  const { statistics } = await loadCatalogFresh(t.db);
  const s = statistics.get(countByKey.get('mounts').id);
  assert.equal(s.category, 'Collections');
  assert.equal(s.grading, 'none');
  assert.equal(s.tierRole, 'undecided');
  assert.equal(s.countsOverall, false);
});

async function bnetSignIn(c, who) {
  const start = await c.post('/api/auth/battlenet/start', { intent: 'sign_in' });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const state = new URL(start.json.url).searchParams.get('state');
  const cb = await c.get(`/auth/battlenet/callback?code=${who}&state=${state}`);
  assert.equal(cb.status, 303);
}

test('gold: read with the owner\'s token at sign-in; position, bind position and the WoW account id are NEVER stored', async () => {
  addCharacter('gold-one', { id: 7101, mounts: [3001, 3002] });
  addCharacter('gold-two', { id: 7102, mounts: [3001, 3002] });
  accounts.set('goldie', [{ id: 7101, slug: 'gold-one', name: 'Gold', surname: 'One', level: 30 }, { id: 7102, slug: 'gold-two', name: 'Gold', surname: 'Two', level: 30 }]);
  const owner = t.client({ ip: '198.51.100.50' });
  const mark = calls.length;
  await bnetSignIn(owner, 'goldie');
  assert.equal(since(mark, /protected-character/), 2);
  // Collections were queued at sign-in priority.
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM crawl_queue WHERE kind = 'collections' AND priority = $1", [PRIORITY.auto])).n, 2);
  const g = await t.db.one('SELECT money, gold_gained, gold_lost, item_value_gained FROM character_gold WHERE character_id = 7101');
  assert.deepEqual({ ...g }, { money: 34046, gold_gained: 167982, gold_lost: 133936, item_value_gained: 139827 });

  // Every table, every row, as text: none holds the position, the bind position or the WoW account id.
  const tables = (await t.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).map((r) => r.table_name);
  for (const table of tables) {
    const hits = await t.db.query(`SELECT 1 FROM "${table}" x WHERE x::text ILIKE '%' || $1 || '%' OR x::text LIKE '%' || $2 || '%' OR x::text LIKE '%' || $3 || '%' LIMIT 1`, [SECRET.zone, String(SECRET.x), String(SECRET.account)]);
    assert.deepEqual(hits, [], `${table} holds protected-character location or account data`);
  }
  // And no column could: character_gold is four numbers and its keys.
  const cols = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'character_gold' ORDER BY ordinal_position")).map((r) => r.column_name);
  assert.deepEqual(cols, ['character_id', 'account_id', 'money', 'gold_gained', 'gold_lost', 'item_value_gained', 'fetched_at']);
});

test('gold is private to the owner until they opt in; boards rank only opted-in characters; off removes them at once', async () => {
  await fetchChar('gold-one');
  await fetchChar('gold-two');
  const owner = t.client({ ip: '198.51.100.50' });
  await bnetSignIn(owner, 'goldie');
  const stranger = t.client({ ip: '198.51.100.51' });
  const mine = (await owner.get('/api/characters/gold-one/collections')).json;
  assert.equal(mine.gold.state, 'shown');
  assert.equal(mine.gold.public, false);
  assert.equal(mine.gold.fields.money, 34046);
  assert.equal((await stranger.get('/api/characters/gold-one/collections')).json.gold, null);
  let board = (await stranger.get('/api/gold-boards/2/money')).json;
  assert.equal(board.ranked, 0);

  assert.equal((await owner.put('/api/account/characters/7101/gold-public', { public: true })).status, 200);
  assert.equal((await stranger.get('/api/characters/gold-one/collections')).json.gold.fields.gained, 167982);
  board = (await stranger.get('/api/gold-boards/2/money')).json;
  assert.deepEqual(board.rows.map((r) => [r.slug, r.rank, r.value]), [['gold-one', 1, 34046]]);
  // Someone else's character can't be switched.
  assert.equal((await stranger.put('/api/account/characters/7101/gold-public', { public: true })).status, 401);

  await owner.put('/api/account/characters/7101/gold-public', { public: false });
  assert.equal((await stranger.get('/api/gold-boards/2/money')).json.ranked, 0);
  assert.equal((await stranger.get('/api/characters/gold-one/collections')).json.gold, null);
});

test('account-wide is detected, never assumed: identical on every fetched character → shared; one differs → not', async () => {
  await fetchColl('gold-one');
  await fetchColl('gold-two');
  const row = await t.db.one("SELECT shared, characters FROM collection_sharing WHERE kind = 'mounts'");
  assert.deepEqual({ ...row }, { shared: true, characters: 2 });
  const tab = (await t.client().get('/api/characters/gold-one/collections')).json;
  assert.deepEqual(tab.counts.find((x) => x.key === 'mounts').shared, { how: 'detected' });
  chars.get('gold-two').mounts = [3001];
  await fetchColl('gold-two');
  assert.equal((await t.db.one("SELECT shared FROM collection_sharing WHERE kind = 'mounts'")).shared, false);
  assert.equal((await t.client().get('/api/characters/gold-one/collections')).json.counts.find((x) => x.key === 'mounts').shared, null);
});

test('retention: an old collection, catalog row or gold row is swept; the derived statistic names are ours and stay', async () => {
  const { BLIZZARD } = await import('../retention/registry.js');
  await t.db.query("UPDATE character_gold SET fetched_at = now() - interval '40 days' WHERE character_id = 7102");
  await t.db.query("UPDATE character_collections SET data_fetched_at = now() - interval '40 days' WHERE character_id = 7102 AND kind = 'toys'");
  await t.db.query("UPDATE statistics SET last_seen_at = now() - interval '40 days' WHERE derived IS NOT NULL");
  const cutoff = new Date(Date.now() - 29 * 86_400_000);
  for (const entry of BLIZZARD) await entry.sweep(t.db, cutoff);
  assert.equal(await t.db.one('SELECT 1 AS x FROM character_gold WHERE character_id = 7102'), null);
  assert.equal(await t.db.one("SELECT 1 AS x FROM character_collections WHERE character_id = 7102 AND kind = 'toys'"), null);
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM statistics WHERE derived IS NOT NULL AND name IS NOT NULL")).n > 0, true);
});

test('the Collections share card carries real counts only, and the account glyph only where sharing is known', async () => {
  const { buildCard } = await import('../cards/data.js');
  const { cleanOptions } = await import('../cards/catalog.js');
  const card = await buildCard(t.db, 'collections', { c: 'alpha-coll' }, cleanOptions('collections', { format: 'wide' }));
  assert.equal(card.status, 'ok');
  assert.deepEqual(card.data.transmog, { big: '60%', sub: '3 / 5 appearances', w: 60 });
  assert.ok(card.data.counts.every((k) => Number(k.value.replace(/,/g, '')) > 0));
  assert.ok(card.data.counts.some((k) => k.label === 'Quests'));
  assert.equal(card.data.show.acct, false);
  assert.equal(card.page, '/c/alpha-coll/collections');
  // A character without collections yet can't have one.
  const none = await buildCard(t.db, 'collections', { c: 'hunt-coll' }, cleanOptions('collections', {}));
  assert.ok(['ok', 'unavailable'].includes(none.status));
});

test('0.9.1: a board for every collection: per achievement category, per transmog slot, per PvP field; hunters ranked among hunters', async () => {
  // The catalogs are built by now (achievement categories come from them); refresh to count with them.
  await fetchColl('alpha-coll');
  await fetchColl('hunt-coll');
  const keys = new Map((await t.db.query('SELECT id, derived, name FROM statistics WHERE derived IS NOT NULL')).map((r) => [r.derived, r]));
  // One board per transmog slot Blizzard returned, named from Blizzard's slot names.
  assert.equal(keys.get('slot:HEAD').name, 'Appearances collected: Head');
  assert.ok(keys.has('slot:CHEST'));
  // Achievements per category: 62041 and 62043 are earned, both in "Ranks".
  assert.equal(keys.get('achcat:15597').name, 'Achievements earned: Ranks');
  const v = async (key, cid = 7001) => (await t.db.one('SELECT value FROM character_statistics WHERE character_id = $1 AND statistic_id = $2', [cid, keys.get(key).id]))?.value ?? 0;
  assert.equal(await v('achcat:15597'), 2);
  assert.equal(await v('slot:HEAD'), 2);
  // Every PvP summary number Blizzard returns above zero gets a board; pvp_rank is 0 for everyone: no board.
  assert.equal(await v('pvp:honorable_kills'), 4);
  assert.ok(!keys.has('pvp:pvp_rank'));
  // No encounter data on Forever so far: no boss-kill boards at all.
  assert.ok(!keys.has('boss-kills'));
  assert.ok(![...keys.keys()].some((k) => k.startsWith('instance:')));
  // Ids are stable per key and above the fixed range.
  const { DERIVED_DYNAMIC } = await import('../collections/registry.js');
  assert.ok(Number(keys.get('slot:HEAD').id) > DERIVED_DYNAMIC);
  await fetchColl('alpha-coll');
  assert.equal(Number((await t.db.one("SELECT id FROM statistics WHERE derived = 'slot:HEAD'")).id), Number(keys.get('slot:HEAD').id));
  // Hunter pets: registered once a hunter has one; the board's population is hunters only.
  const hp = keys.get('hunter-pets');
  assert.ok(hp);
  const board = (await t.client().get(`/api/leaderboards/2/${hp.id}`)).json;
  assert.equal(board.nonzero, 1);
  assert.equal(board.population, 1);
  // The tab lists the character's family boards, linked by id.
  const tab = (await t.client({ ip: '198.51.100.70' }).get('/api/characters/alpha-coll/collections')).json;
  assert.ok(tab.familyBoards.some((b) => b.name === 'Appearances collected: Head' && b.rank === 1));
  assert.ok(!tab.counts.some((k) => k.key === 'hunter-pets'), 'hunter pets: hunters only');
  // Leaderboards index: the Collections group carries the gold boards too.
  const idx = (await t.client().get('/api/leaderboards?ruleset=2')).json;
  assert.equal(idx.categories.find((c) => c.label === 'Collections').extra, 'gold');
  // Family boards are listed in Discovery like any statistic, and count toward no tier.
  const { loadCatalogFresh } = await import('../stats/catalog.js');
  const s = (await loadCatalogFresh(t.db)).statistics.get(Number(keys.get('slot:HEAD').id));
  assert.equal(s.category, 'Collections');
  assert.equal(s.tierRole, 'undecided');
});

test('0.9.2: a catalog row Blizzard keeps failing is skipped after 3 tries, never failing the build; a stopped build resumes', async () => {
  // A fresh appearance build where one appearance always answers 500.
  await t.db.query("UPDATE collection_catalog_state SET fetched_at = now() - interval '20 days' WHERE kind = 'appearance'");
  FAILING.add('/data/wow/item-appearance/12');
  const mark = calls.length;
  await buildCatalogs();
  const st = await t.db.one("SELECT state, detail FROM collection_catalog_state WHERE kind = 'appearance'");
  assert.equal(st.state, 'ok');
  assert.match(st.detail, /1 skipped/);
  assert.equal((await t.db.one("SELECT data->>'unavailable' AS u FROM collection_catalog WHERE kind = 'appearance' AND id = 12")).u, '500');
  // Exactly 3 tries for the bad one, no loop.
  assert.equal(calls.slice(mark).filter((x) => x === '/data/wow/item-appearance/12').length, 3);
  FAILING.clear();

  // A build that stopped part-way (2 of 5 rows refreshed, no crawl item left, e.g. it failed or the worker went away):
  // the hourly job RESUMES it from the detail steps, with the same start time, asking only for the 3 rows left.
  const started = new Date(Date.now() - 60 * 60 * 1000);
  await t.db.query("UPDATE collection_catalog_state SET state = 'building', started_at = $1, finished_at = NULL WHERE kind = 'appearance'", [started]);
  await t.db.query("UPDATE collection_catalog SET fetched_at = $1::timestamptz - interval '1 second' WHERE kind = 'appearance' AND id IN (13, 21, 22)", [started]);
  await t.db.query("DELETE FROM crawl_queue WHERE kind = 'catalog'");
  const before = calls.length;
  await buildCatalogs();
  const asked = calls.slice(before).filter((x) => x.startsWith('/data/wow/item-appearance/'));
  assert.deepEqual(asked.sort(), ['/data/wow/item-appearance/13', '/data/wow/item-appearance/21', '/data/wow/item-appearance/22']);
  assert.equal((await t.db.one("SELECT state FROM collection_catalog_state WHERE kind = 'appearance'")).state, 'ok');
});

test('0.9.2: slots Blizzard names alike read "Chest" and "Chest (robe)"; a building catalog still names collected tiles', async () => {
  const { slotLabels, slotGroup } = await import('../collections/registry.js');
  const l = slotLabels([{ type: 'CHEST', name: 'Chest' }, { type: 'ROBE', name: 'Chest' }, { type: 'HEAD', name: 'Head' }]);
  assert.deepEqual([...l.values()], ['Chest', 'Chest (robe)', 'Head']);
  assert.equal(slotGroup('TWOHWEAPON'), 'Weapon');
  assert.equal(slotGroup('BAG'), null);
  // The appearance catalog half-built (no finished build): collected-only, but the rows it has already name tiles.
  await t.db.query("UPDATE collection_catalog_state SET fetched_at = NULL, state = 'building' WHERE kind = 'appearance'");
  const tm = (await t.client({ ip: '198.51.100.80' }).get('/api/characters/alpha-coll/collections/transmog?slot=HEAD')).json.section;
  assert.equal(tm.catalog, false);
  assert.equal(tm.total, null);
  assert.equal(tm.catalogState, 'building');
  assert.ok(tm.tiles.every((x) => x.collected));
  assert.equal(tm.tiles.find((x) => x.id === 11).name, 'Item 11');
  assert.equal(tm.slots.find((s) => s.type === 'HEAD').group, 'Armor');
  await t.db.query("UPDATE collection_catalog_state SET fetched_at = now(), state = 'ok' WHERE kind = 'appearance'");
});
