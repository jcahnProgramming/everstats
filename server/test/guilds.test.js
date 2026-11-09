import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp } from './helpers.js';

// A fake Blizzard, shaped like the guild responses discovery runs 1 and 2 stored (guild profile: id, name, slug,
// faction, ruleset, member_count, created_timestamp; roster: members[].character{ id, name, surname, slug, level },
// rank as a number). Every name here is a test fixture, never shipped data.
const API = 'https://us.api.blizzard.com';
const calls = [];
const world = { characters: new Map(), guilds: new Map() };

const stat = (id, name, quantity) => ({ id, name, quantity, last_updated_timestamp: 1794000000000 });
function addCharacter(slug, { id, level = 30, guild = null, deaths = 0, killed = 0 }) {
  const [name, surname] = slug.split('-').map((x) => x[0].toUpperCase() + x.slice(1));
  world.characters.set(slug, { id, slug, name, surname, level, guild, deaths, killed });
}
function addGuild(slug, { id, name, members, ruleset = { id: 2, name: 'Normal' } }) {
  world.guilds.set(slug, { id, slug, name, ruleset, members });
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url) {
  const u = new URL(String(url));
  calls.push(u.pathname);
  if (u.href === 'https://oauth.battle.net/token') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
  if (u.origin !== API) return json(404, {});
  const gm = /^\/data\/wow\/guild\/([^/]+)(\/roster)?$/.exec(u.pathname);
  if (gm) {
    const g = world.guilds.get(decodeURIComponent(gm[1]));
    if (!g) return json(404, {});
    const ref = { key: { href: `${API}/data/wow/guild/${g.slug}?namespace=profile-forever-us` }, name: g.name, id: g.id, faction: { type: 'HORDE', name: 'Horde' }, slug: g.slug };
    if (gm[2]) {
      return json(200, {
        guild: ref,
        members: g.members.map(([slug, level, rank, id]) => {
          const [name, surname] = slug.split('-');
          return { character: { key: { href: `${API}/profile/wow/character/${slug}?namespace=profile-forever-us` }, name, surname, id, level, slug, playable_class: { id: 5 }, playable_race: { id: 5 }, faction: { type: 'HORDE' } }, rank };
        }),
      });
    }
    return json(200, {
      id: g.id, name: g.name, slug: g.slug, faction: { type: 'HORDE', name: 'Horde' }, achievement_points: 0, member_count: g.members.length,
      created_timestamp: 1793847870000, ruleset: { key: { href: `${API}/data/wow/ruleset/${g.ruleset.id}` }, name: g.ruleset.name, id: g.ruleset.id }, name_search: g.name,
    });
  }
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) return json(404, {});
  const c = world.characters.get(decodeURIComponent(m[1]));
  if (!c) return json(404, {});
  const sub = m[2] ?? '';
  const g = c.guild ? world.guilds.get(c.guild) : null;
  if (sub === '') {
    return json(200, {
      _links: { self: { href: `${API}/profile/wow/character/${c.slug}?namespace=profile-forever-us` } },
      id: c.id, name: c.name, surname: c.surname, level: c.level, faction: { type: 'HORDE', name: 'Horde' }, race: { name: 'Orc' }, character_class: { name: 'Warrior' },
      ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000,
      ...(g ? { guild: { id: g.id, name: g.name, slug: g.slug, faction: { type: 'HORDE', name: 'Horde' } } } : {}),
    });
  }
  if (sub === '/achievements/statistics') {
    return json(200, { categories: [{ id: 122, name: 'Deaths', statistics: [stat(60, 'Total deaths', c.deaths)].filter((s) => s.quantity > 0) }, { id: 128, name: 'Kills', statistics: [stat(107, 'Creatures killed', c.killed)].filter((s) => s.quantity > 0) }] });
  }
  if (sub === '/statistics') return json(200, { health: 400 });
  if (sub === '/equipment') return json(200, { equipped_items: [] });
  if (sub === '/character-media') return json(404, {});
  return json(404, {});
}

let t;
let crawler;
const ctx = () => ({ db: t.db, client: crawler.client });
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  const { createCrawler } = await import('../crawler/service.js');
  // Paused before the loop starts: background items (rosters, roster members) stay queued and these tests fetch by
  // hand; a person's look-up (priority 1) still runs while paused.
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'crawler.paused', true);
  crawler = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await crawler.start();
});
after(async () => {
  await crawler.stop();
  await t.close();
});
beforeEach(async () => {
  const { clearCatalogCache } = await import('../stats/catalog.js');
  clearCatalogCache();
});

// Guild "big": six tracked members (level 30) + one under level 10 + one level 30 never fetched. Guild "small": two.
const BIG = [['ana-fixture', 30, 0, 1001], ['bo-fixture', 30, 1, 1002], ['cy-fixture', 30, 3, 1003], ['di-fixture', 30, 3, 1004], ['ed-fixture', 30, 2, 1005], ['flo-fixture', 30, 3, 1006], ['gus-fixture', 5, 3, 1007], ['hal-fixture', 30, 3, 1008]];
const SMALL = [['ivy-fixture', 40, 0, 2001], ['jo-fixture', 40, 1, 2002]];
const countSince = (mark, re) => calls.slice(mark).filter((p) => re.test(p)).length;

test('a guild costs two requests a day: its profile and its roster; ranks are numbers, members are stored without names', async () => {
  addGuild('big-guild', { id: 900, name: 'Big Guild', members: BIG });
  addGuild('small-guild', { id: 901, name: 'Small Guild', members: SMALL });
  const deaths = { 'ana-fixture': 10, 'bo-fixture': 10, 'cy-fixture': 4, 'di-fixture': 3, 'ed-fixture': 2, 'flo-fixture': 0 };
  for (const [slug, level, , id] of BIG) if (slug !== 'gus-fixture' && slug !== 'hal-fixture') addCharacter(slug, { id, level, guild: 'big-guild', deaths: deaths[slug], killed: 100 });
  addCharacter('ivy-fixture', { id: 2001, level: 40, guild: 'small-guild', deaths: 50, killed: 5000 });
  addCharacter('jo-fixture', { id: 2002, level: 40, guild: 'small-guild', deaths: 40, killed: 5000 });

  const { fetchCharacter, fetchGuildRoster } = await import('../crawler/fetch.js');
  for (const slug of [...Object.keys(deaths), 'ivy-fixture', 'jo-fixture']) assert.equal(await fetchCharacter(ctx(), { key: slug, priority: 1, mode: 'full' }), 'fetched');

  const mark = calls.length;
  const outcome = await fetchGuildRoster(ctx(), { key: 'big-guild', priority: 4 });
  assert.match(outcome, /^roster: 8 members/);
  assert.equal(countSince(mark, /\/data\/wow\/guild\//), 2);
  const g = await t.db.one('SELECT name, member_count, created_at_blizzard, roster_members, profile_state FROM guilds WHERE id = 900');
  assert.equal(g.member_count, 8);
  assert.equal(g.roster_members, 8);
  assert.equal(g.profile_state, 'ok');
  assert.ok(g.created_at_blizzard);
  const cols = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'guild_roster'")).map((r) => r.column_name);
  assert.ok(!cols.includes('name') && !cols.includes('slug'), 'roster rows never hold a name');
  assert.equal((await t.db.one('SELECT rank FROM guild_roster WHERE character_id = 1001')).rank, 0);
  await fetchGuildRoster(ctx(), { key: 'small-guild', priority: 4 });
  // The level-30 member nobody fetched yet was queued from the roster; the level-5 one wasn't.
  const queued = (await t.db.query("SELECT key FROM crawl_queue WHERE kind = 'character' AND state = 'queued'")).map((r) => r.key);
  assert.ok(queued.includes('hal-fixture'));
  assert.ok(!queued.includes('gus-fixture'));

  const { rebuildDueGuilds } = await import('../stats/guildTotals.js');
  assert.ok((await rebuildDueGuilds(t.db)) >= 2);
});

test('the guild page: honest counts, rank names only for the guild master, totals of the default pins', async () => {
  const res = await t.client({ ip: '198.51.100.20' }).get('/api/guilds/big-guild');
  assert.equal(res.json.status, 'ok', JSON.stringify(res.json));
  const v = res.json;
  assert.deepEqual(v.counts, { roster: 8, tracked: 6, underTen: 1, notTracked: 1 });
  assert.equal(v.guild.ruleset.name, 'Normal');
  assert.equal(v.guild.faction, 'Horde');
  assert.equal(v.guild.memberCount, 8);
  const ana = v.roster.find((m) => m.slug === 'ana-fixture');
  assert.equal(ana.rankName, 'Guild Master');
  assert.equal(v.roster.find((m) => m.slug === 'cy-fixture').rankName, 'Rank 3');
  assert.ok(!v.roster.some((m) => m.slug === 'gus-fixture' || m.slug === 'hal-fixture'), 'untracked members are never listed');
  const deaths = v.totals.cards.find((c) => c.name === 'Total deaths');
  assert.equal(deaths.total, 29);
  assert.equal(v.ranked, true);
  assert.ok(Array.isArray(v.placements));

  const small = (await t.client({ ip: '198.51.100.20' }).get('/api/guilds/small-guild')).json;
  assert.equal(small.ranked, false);
  assert.equal(small.placements, null);
  assert.equal(small.minMembers, 5);
});

test('guild boards: total by default, average on request, ties share a rank, small guilds are "not ranked yet"', async () => {
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'guilds.minMembers', 2);
  let b = (await t.client().get('/api/guild-boards/2/60')).json;
  assert.equal(b.mode, 'total');
  assert.deepEqual(b.rows.map((r) => [r.slug, r.rank, r.value]), [['small-guild', 1, 90], ['big-guild', 2, 29]]);
  b = (await t.client().get('/api/guild-boards/2/60?mode=average')).json;
  assert.deepEqual(b.rows.map((r) => [r.slug, r.rank]), [['small-guild', 1], ['big-guild', 2]]);
  assert.equal(b.rows[1].value, 29 / 6);
  // Creatures killed: big 600 total (6 × 100), small 10,000. Average: small 5,000 vs big 100.
  b = (await t.client().get('/api/guild-boards/2/107?mode=total')).json;
  assert.deepEqual(b.rows.map((r) => r.slug), ['small-guild', 'big-guild']);

  await setSetting(t.db, 'guilds.minMembers', 5);
  b = (await t.client().get('/api/guild-boards/2/60')).json;
  assert.deepEqual(b.rows.map((r) => r.slug), ['big-guild']);
  assert.equal(b.rows[0].rank, 1);
  assert.deepEqual(b.notYet.map((r) => [r.slug, r.members]), [['small-guild', 2]]);

  // The guild-only board: ties share a rank, a zero isn't ranked (flo has 0 deaths).
  const own = (await t.client().get('/api/guilds/big-guild/boards/60')).json;
  assert.deepEqual(own.rows.map((r) => [r.slug, r.rank]), [['ana-fixture', 1], ['bo-fixture', 1], ['cy-fixture', 3], ['di-fixture', 4], ['ed-fixture', 5]]);
  assert.equal(own.atZero, 1);
  const top = (await t.client().get('/api/guilds/big-guild/top')).json;
  const td = top.categories.flatMap((c) => c.statistics).find((s) => s.name === 'Total deaths');
  assert.equal(td.top.length, 5);
  assert.equal(td.withAny, 5);
});

test('a hidden member leaves the roster and every guild total at once', async () => {
  const { setHidden } = await import('../crawler/store.js');
  await t.db.tx((q) => setHidden(q, 1001, true));
  const v = (await t.client({ ip: '198.51.100.21' }).get('/api/guilds/big-guild')).json;
  assert.ok(!v.roster.some((m) => m.slug === 'ana-fixture'));
  assert.equal(v.counts.tracked, 5);
  assert.equal(v.totals.cards.find((c) => c.name === 'Total deaths').total, 19);
  const own = (await t.client().get('/api/guilds/big-guild/boards/60')).json;
  assert.ok(!own.rows.some((r) => r.slug === 'ana-fixture'));
  const search = (await t.client().get('/api/search?q=ana')).json;
  assert.equal(search.characters.length, 0);
  await t.db.tx((q) => setHidden(q, 1001, false));
});

test('a member who moves takes their numbers to the new guild', async () => {
  const { fetchCharacter } = await import('../crawler/fetch.js');
  const { rebuildDueGuilds } = await import('../stats/guildTotals.js');
  world.characters.get('ed-fixture').guild = 'small-guild';
  await fetchCharacter(ctx(), { key: 'ed-fixture', priority: 1, mode: 'full' });
  await rebuildDueGuilds(t.db);
  const big = await t.db.one("SELECT total, members FROM guild_totals WHERE guild_id = 900 AND statistic_id = 60 AND period = 'overall'");
  const small = await t.db.one("SELECT total, members FROM guild_totals WHERE guild_id = 901 AND statistic_id = 60 AND period = 'overall'");
  assert.deepEqual([big.total, big.members], [27, 5]);
  assert.deepEqual([small.total, small.members], [92, 3]);
  world.characters.get('ed-fixture').guild = 'big-guild';
  await fetchCharacter(ctx(), { key: 'ed-fixture', priority: 1, mode: 'full' });
  await rebuildDueGuilds(t.db);
});

test('a renamed guild: its old address redirects by id', async () => {
  const { fetchGuildRoster } = await import('../crawler/fetch.js');
  const old = world.guilds.get('small-guild');
  world.guilds.delete('small-guild');
  world.guilds.set('tiny-guild', { ...old, slug: 'tiny-guild', name: 'Tiny Guild' });
  await fetchGuildRoster(ctx(), { key: 'tiny-guild', priority: 4 });
  const r = (await t.client({ ip: '198.51.100.22' }).get('/api/guilds/small-guild')).json;
  assert.deepEqual(r, { status: 'moved', slug: 'tiny-guild' });
});

test('an unknown guild is looked up once, at once; one Blizzard has never heard of is "not found"', async () => {
  addGuild('fresh-guild', { id: 902, name: 'Fresh Guild', members: [['kai-fixture', 20, 0, 3001]] });
  const mark = calls.length;
  const r = (await t.client({ ip: '198.51.100.23' }).get('/api/guilds/fresh-guild')).json;
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.guild.name, 'Fresh Guild');
  assert.equal(r.counts.tracked, 0);
  assert.ok(countSince(mark, /\/data\/wow\/guild\/fresh-guild/) === 2);
  const none = (await t.client({ ip: '198.51.100.23' }).get('/api/guilds/no-such-guild')).json;
  assert.equal(none.status, 'not_found');
  assert.equal((await t.client().get('/api/guilds/%3Cscript%3E')).status, 400);
});

test('search finds guilds and characters, labelled apart', async () => {
  const r = (await t.client().get('/api/search?q=big')).json;
  assert.deepEqual(r.guilds.map((g) => g.slug), ['big-guild']);
  assert.equal(r.guilds[0].ruleset, 'Normal');
  const c = (await t.client().get('/api/search?q=bo')).json;
  assert.ok(c.characters.some((x) => x.slug === 'bo-fixture'));
});

test('/guilds lists the largest guilds by tracked members on a ruleset', async () => {
  const r = (await t.client().get('/api/guilds?ruleset=2')).json;
  assert.equal(r.guilds[0].slug, 'big-guild');
  assert.equal(r.guilds[0].tracked, 6);
  assert.equal(r.guilds[0].ranked, true);
});

test('retention: guild data past the window is swept like any Blizzard data', async () => {
  const { runRetentionSweep } = await import('../retention/sweep.js');
  await t.db.query("UPDATE guild_roster SET fetched_at = now() - interval '40 days' WHERE guild_id = 900");
  await t.db.query("UPDATE guild_totals SET computed_at = now() - interval '40 days' WHERE guild_id = 900");
  await t.db.query("UPDATE guilds SET profile_fetched_at = now() - interval '40 days' WHERE id = 900");
  await runRetentionSweep(t.db, { log: { error() {} } });
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM guild_roster WHERE guild_id = 900')).n, 0);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM guild_totals WHERE guild_id = 900')).n, 0);
  const g = await t.db.one('SELECT member_count, created_at_blizzard FROM guilds WHERE id = 900');
  assert.deepEqual(g, { member_count: null, created_at_blizzard: null });
});
