import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp } from './helpers.js';

// A fake Blizzard + Battle.net, shaped like the responses discovery runs 1 and 2 stored. Every name here is a test
// fixture, never shipped data. Requests are counted per path so the tests can measure what each flow costs.
const API = 'https://us.api.blizzard.com';
const calls = [];
const world = { characters: new Map(), accounts: new Map(), rosters: new Map(), failStats: false };

const stat = (id, name, quantity, description) => ({ id, name, quantity, last_updated_timestamp: 1794000000000, ...(description ? { description } : {}) });
function addCharacter(slug, { id, level = 20, ruleset = { id: 2, name: 'Normal' }, login = 1794100000000, stats = [], guild = null }) {
  const [name, surname] = slug.split('-').map((x) => x[0].toUpperCase() + x.slice(1));
  world.characters.set(slug, { id, slug, name, surname, level, ruleset, login, stats, guild });
}
const statsDoc = (c) => ({
  character: { id: c.id, name: c.name, slug: c.slug },
  categories: [
    { id: 130, name: 'Character', statistics: c.stats.filter((s) => s.cat === 'char').map((s) => s.s) },
    { id: 122, name: 'Deaths', statistics: c.stats.filter((s) => s.cat === 'death').map((s) => s.s) },
    { id: 128, name: 'Kills', sub_categories: [{ id: 135, name: 'Creatures', statistics: c.stats.filter((s) => s.cat === 'kill').map((s) => s.s) }] },
  ],
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  calls.push(u.pathname);
  const auth = String(opts.headers?.Authorization ?? '');
  if (u.href === 'https://oauth.battle.net/token') {
    const body = new URLSearchParams(String(opts.body));
    if (body.get('grant_type') === 'client_credentials') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
    return json(200, { access_token: `tok-${body.get('code')}`, token_type: 'bearer' });
  }
  if (u.href === 'https://oauth.battle.net/userinfo') return json(200, { sub: `bnet-${auth.replace('Bearer tok-', '')}`, battletag: 'Fixture#1' });
  if (u.origin !== API) return json(404, {});
  if (u.pathname === '/profile/user/wow') {
    const who = auth.replace('Bearer tok-', '');
    const list = world.accounts.get(who);
    if (list === 'error') return json(500, {});
    if (!list) return json(404, { code: 404 });
    return json(200, { wow_accounts: [{ id: 1, characters: list.map((c) => ({ character: { href: `${API}/profile/wow/character/${c.slug}?namespace=profile-forever-us` }, id: c.id, name: c.name, surname: c.surname, level: c.level })) }] });
  }
  if (u.pathname === '/data/wow/ruleset/index') return json(200, { rulesets: [{ key: { href: `${API}/data/wow/ruleset/2?namespace=dynamic-forever-us` }, id: 2 }] });
  if (u.pathname === '/data/wow/ruleset/2') return json(200, { id: 2, name: 'Normal' });
  const g = /^\/data\/wow\/guild\/([^/]+)\/roster$/.exec(u.pathname);
  if (g) return world.rosters.has(g[1]) ? json(200, { members: world.rosters.get(g[1]) }) : json(404, {});
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) return json(404, {});
  const c = world.characters.get(decodeURIComponent(m[1]));
  if (!c) return json(404, { code: 404 });
  const sub = m[2] ?? '';
  if (sub === '') {
    return json(200, {
      _links: { self: { href: `${API}/profile/wow/character/${encodeURIComponent(c.slug)}?namespace=profile-forever-us` } },
      id: c.id, name: c.name, surname: c.surname, level: c.level, faction: { type: 'HORDE', name: 'Horde' }, race: { name: 'Undead' }, character_class: { name: 'Priest' },
      ruleset: { key: { href: `${API}/data/wow/ruleset/${c.ruleset.id}` }, id: c.ruleset.id, name: c.ruleset.name }, last_login_timestamp: c.login,
      ...(c.guild ? { guild: { id: c.guild.id, name: c.guild.name, slug: c.guild.slug } } : {}),
    });
  }
  if (sub === '/achievements/statistics') return world.failStats ? json(503, {}) : json(200, statsDoc(c));
  if (sub === '/statistics') return json(200, { health: 400, power: 100, power_type: { name: 'Mana' }, stamina: { base: 30, effective: 40 } });
  if (sub === '/equipment') return json(200, { equipped_items: [{ slot: { type: 'HEAD', name: 'Head' }, name: 'Fixture Hood', quality: { type: 'RARE' }, level: { value: 20 } }] });
  if (sub === '/character-media') return c.noMedia ? json(404, {}) : json(200, { assets: [{ key: 'main-raw', value: `https://render.worldofwarcraft.com/forever-us/character/1/${c.id}-main-raw.png` }, { key: 'avatar', value: 'https://evil.example/x.png' }] });
  return json(404, {});
}

let t;
let crawler;
before(async () => {
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
});
beforeEach(async () => {
  const { clearCatalogCache } = await import('../stats/catalog.js');
  clearCatalogCache();
});

const STATS = (deaths, camped, killed, named = 'Undead') => [
  { cat: 'char', s: stat(64222, 'Times camped', camped) },
  { cat: 'death', s: stat(60, 'Total deaths', deaths) },
  { cat: 'kill', s: stat(107, 'Creatures killed', killed) },
  { cat: 'kill', s: stat(1336, 'Creature type killed the most', killed, named) },
];
const countSince = (mark, re = /\/profile\/wow\/|\/data\/wow\//) => calls.slice(mark).filter((p) => re.test(p)).length;

test('a lookup fetches the character at once: profile, statistics, attributes, gear and render: 5 requests', async () => {
  addCharacter('alpha-fixture', { id: 101, stats: STATS(3, 5, 900) });
  const mark = calls.length;
  const res = await t.client({ ip: '198.51.100.1' }).get('/api/characters/alpha-fixture');
  assert.equal(res.json.status, 'ok', JSON.stringify(res.json));
  assert.equal(countSince(mark), 5);
  const ch = res.json.character;
  assert.equal(ch.name, 'Alpha');
  assert.equal(ch.ruleset.name, 'Normal');
  assert.equal(ch.media.render, 'https://render.worldofwarcraft.com/forever-us/character/1/101-main-raw.png');
  assert.equal(ch.media.avatar, null); // a URL on any other host is dropped, never shown
  assert.equal(ch.equipment[0].name, 'Fixture Hood');
  const all = res.json.statistics.categories.flatMap((c) => c.statistics);
  assert.equal(all.find((s) => s.name === 'Creature type killed the most').text, 'Undead');
  assert.equal(all.find((s) => s.name === 'Total deaths').rank, 1);
  // Deaths are leaderboard-only: their category comes last.
  assert.equal(res.json.statistics.categories.at(-1).label, 'Deaths & mishaps');

  // Asked again within ten minutes: served from what was just fetched, no new request.
  const again = calls.length;
  await t.client({ ip: '198.51.100.1' }).get('/api/characters/Alpha-Fixture');
  assert.equal(countSince(again), 0);
});

test('the daily check is one request when the character has not logged in since, five when it has', async () => {
  const { fetchCharacter } = await import('../crawler/fetch.js');
  const ctx = { db: t.db, client: crawler.client };
  let mark = calls.length;
  assert.equal(await fetchCharacter(ctx, { key: 'alpha-fixture', priority: 3, mode: 'check' }), 'unchanged');
  assert.equal(countSince(mark), 1);
  world.characters.get('alpha-fixture').login += 60_000;
  world.characters.get('alpha-fixture').stats = STATS(4, 6, 950);
  mark = calls.length;
  assert.equal(await fetchCharacter(ctx, { key: 'alpha-fixture', priority: 3, mode: 'check' }), 'fetched');
  assert.equal(countSince(mark), 5);
  const row = await t.db.one('SELECT last_checked_at, last_fetched_at FROM characters WHERE id = 101');
  assert.ok(row.last_checked_at && row.last_fetched_at);
  // Still one snapshot for today: at most one per character per day.
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM character_snapshots WHERE character_id = 101')).n, 1);
});

test('no raw Blizzard body is stored in any production table', async () => {
  const cols = await t.db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('characters', 'character_statistics', 'character_snapshots', 'statistics', 'guilds', 'rulesets') AND column_name IN ('body', 'raw', 'response')`);
  assert.deepEqual(cols, []);
});

test('not found is honest; a statistic Blizzard adds appears in the catalog by itself', async () => {
  const nf = await t.client({ ip: '198.51.100.2' }).get('/api/characters/nobody-here');
  assert.deepEqual(nf.json, { status: 'not_found', slug: 'nobody-here', known: null });

  addCharacter('beta-fixture', { id: 102, stats: [...STATS(0, 9, 100), { cat: 'char', s: stat(99999, 'Fixture statistic from a patch', 2) }] });
  await t.client({ ip: '198.51.100.2' }).get('/api/characters/beta-fixture');
  const row = await t.db.one('SELECT name FROM statistics WHERE id = 99999');
  assert.equal(row.name, 'Fixture statistic from a patch');
});

test('boards: ties share a rank, a zero is never ranked, hidden characters are on no board', async () => {
  addCharacter('gamma-fixture', { id: 103, stats: STATS(4, 6, 950) }); // same as alpha now
  await t.client({ ip: '198.51.100.3' }).get('/api/characters/gamma-fixture');
  const board = (await t.client().get('/api/leaderboards/2/107')).json;
  assert.equal(board.population, 3);
  assert.deepEqual(board.rows.map((r) => [r.name, r.rank, r.value]), [['Alpha', 1, 950], ['Gamma', 1, 950], ['Beta', 3, 100]]);

  // Deaths: alpha and gamma have 4 each, beta has none. Beta is not a row and has no rank; the two with any are tied.
  const deaths = (await t.client().get('/api/leaderboards/2/60')).json;
  assert.equal(deaths.nonzero, 2);
  assert.equal(deaths.atZero, 1);
  assert.equal(deaths.tied, true);
  assert.deepEqual(deaths.rows, []);
  const beta = (await t.client({ ip: '198.51.100.3' }).get('/api/characters/beta-fixture')).json;
  const betaDeaths = beta.statistics.categories.flatMap((c) => c.statistics).find((x) => x.id === 60);
  assert.deepEqual([betaDeaths.value, betaDeaths.rank, betaDeaths.withAny], [0, null, 2]); // never "#3 of 3" for none
  const betaKills = beta.statistics.categories.flatMap((c) => c.statistics).find((x) => x.id === 107);
  assert.deepEqual([betaKills.rank, betaKills.withAny], [3, 3]); // "#3 of 3 with any"

  // A statistic only one character has, and the patch one: not "everyone tied" (two have 0, one has 2).
  assert.equal((await t.client().get('/api/leaderboards/2/99999')).json.tied, false);

  // Hide alpha (its owner would; here directly): off every board, and the population.
  const { setHidden } = await import('../crawler/store.js');
  await t.db.tx((q) => setHidden(q, 101, true));
  const after = (await t.client().get('/api/leaderboards/2/107')).json;
  assert.equal(after.population, 2);
  assert.deepEqual(after.rows.map((r) => r.name), ['Gamma', 'Beta']);
  assert.equal((await t.client().get('/api/characters/alpha-fixture')).json.status, 'hidden');
  await t.db.tx((q) => setHidden(q, 101, false));
});

test('a board where everyone has the same value says so instead of ranking', async () => {
  addCharacter('delta-fixture', { id: 104, ruleset: { id: 3, name: 'Roleplay' }, stats: STATS(1, 1, 1) });
  addCharacter('epsilon-fixture', { id: 105, ruleset: { id: 3, name: 'Roleplay' }, stats: STATS(1, 1, 1) });
  await t.client({ ip: '198.51.100.4' }).get('/api/characters/delta-fixture');
  await t.client({ ip: '198.51.100.4' }).get('/api/characters/epsilon-fixture');
  const b = (await t.client().get('/api/leaderboards/3/60')).json;
  assert.equal(b.tied, true);
  assert.equal(b.tiedValue, 1);
  assert.deepEqual(b.rows, []);
});

test('boards page with a cursor and never return more than asked', async () => {
  const p1 = (await t.client().get('/api/leaderboards/2/107?limit=2')).json;
  assert.equal(p1.rows.length, 2);
  assert.ok(p1.next);
  const p2 = (await t.client().get(`/api/leaderboards/2/107?limit=2&cursor=${p1.next}`)).json;
  assert.deepEqual(p2.rows.map((r) => [r.name, r.rank]), [['Beta', 3]]);
  assert.equal(p2.next, null);
});

test('weekly boards say "collecting" until a whole period of snapshots exists, then rank gains', async () => {
  const w = (await t.client().get('/api/leaderboards/2/107?period=week')).json;
  assert.equal(w.collecting, true);
  assert.ok(w.periods.week.opensAt);
  // Pretend snapshots began long ago (the test can't wait a week). Every character's baseline is its first
  // snapshot this week, so a gain only counts from there.
  await t.db.query("UPDATE pipeline_facts SET at = '2020-01-01' WHERE key = 'first_snapshot_at'");
  world.characters.get('beta-fixture').stats = STATS(0, 9, 175);
  world.characters.get('beta-fixture').login += 1;
  const { fetchCharacter } = await import('../crawler/fetch.js');
  await fetchCharacter({ db: t.db, client: crawler.client }, { key: 'beta-fixture', priority: 3, mode: 'check' });
  const open = (await t.client().get('/api/leaderboards/2/107?period=week')).json;
  assert.equal(open.collecting, false);
  // Beta gained 75 since its first snapshot this week; Alpha 50 (its 900 → 950 refresh was this week too).
  assert.deepEqual(open.rows.map((r) => [r.name, r.value]), [['Beta', 75], ['Alpha', 50]]);
});

test('period boundaries: the US weekly reset (Tuesday 15:00 UTC) and the rolling "last N days" window', async () => {
  const { periodStart, periodOpen, rollingOpen } = await import('../stats/periods.js');
  assert.equal(periodStart('week', Date.parse('2026-11-10T14:59:59Z')).toISOString(), '2026-11-03T15:00:00.000Z');
  assert.equal(periodStart('week', Date.parse('2026-11-10T15:00:00Z')).toISOString(), '2026-11-10T15:00:00.000Z');
  assert.equal(periodStart('week', Date.parse('2026-11-15T03:00:00Z')).toISOString(), '2026-11-10T15:00:00.000Z');
  // Snapshots from Wednesday: that week is partial, so the board opens at the next reset.
  assert.deepEqual(periodOpen('week', '2026-11-11T09:00:00Z', Date.parse('2026-11-14T00:00:00Z')), { open: false, opensAt: '2026-11-17T15:00:00.000Z' });
  assert.equal(periodOpen('week', '2026-11-11T09:00:00Z', Date.parse('2026-11-17T15:00:00Z')).open, true);
  // Last 26 days (a 30-day window): opens once 26 whole days of snapshots exist, never earlier.
  assert.deepEqual(rollingOpen('2026-11-07T10:00:00Z', 26, Date.parse('2026-12-03T09:59:00Z')), { open: false, opensAt: '2026-12-03T10:00:00.000Z', days: 26 });
  assert.equal(rollingOpen('2026-11-07T10:00:00Z', 26, Date.parse('2026-12-03T10:00:00Z')).open, true);
  assert.equal(rollingOpen(null, 26).open, false);
});

async function bnetSignIn(c, who, intent = 'sign_in') {
  const start = await c.post('/api/auth/battlenet/start', { intent });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const state = new URL(start.json.url).searchParams.get('state');
  const cb = await c.get(`/auth/battlenet/callback?code=${who}&state=${state}`);
  assert.equal(cb.status, 303);
  return cb.headers.get('location');
}

test('Battle.net sign-in brings in every Forever character: owned, with honest states, for one request', async () => {
  addCharacter('zeta-fixture', { id: 201, level: 30, stats: STATS(2, 2, 2) });
  world.accounts.set('p1', [
    { id: 201, slug: 'zeta-fixture', name: 'Zeta', surname: 'Fixture', level: 30 },
    { id: 202, slug: 'eta-fixture', name: 'Eta', surname: 'Fixture', level: 1 },   // under 10: never fetched
    { id: 203, slug: 'theta-fixture', name: 'Theta', surname: 'Fixture', level: 12 }, // 10+, but the profile 404s
  ]);
  const c = t.client({ ip: '198.51.100.9' });
  const mark = calls.length;
  assert.equal(await bnetSignIn(c, 'p1'), '/');
  assert.equal(countSince(mark, /^\/profile\/user\/wow$/), 1);
  // The two level 10+ characters are queued at auto-fetch priority; wait for the crawler.
  for (let i = 0; i < 100; i++) {
    const left = await t.db.one("SELECT count(*)::int AS n FROM crawl_queue WHERE state IN ('queued', 'running')");
    if (left.n === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // zeta: 5 requests; theta: 1 (404 profile); eta: none.
  assert.equal(countSince(mark, /^\/profile\/wow\/character\//), 6);
  const dash = (await c.get('/api/dashboard')).json;
  const state = Object.fromEntries(dash.characters.map((x) => [x.name, x.state]));
  assert.deepEqual(state, { Zeta: 'tracked', Theta: 'not_visible', Eta: 'under_10' });
  assert.equal(dash.featured.name, 'Zeta');
  assert.equal(dash.lastCheck.outcome, 'ok');
  // Default pins, matched by name against the live catalog; no rank history yet, so no movement.
  assert.deepEqual(dash.pins.map((p) => p.name), ['Times camped', 'Total deaths', 'Quests completed', 'Creatures killed'].filter((n) => n !== 'Quests completed'));
  assert.ok(dash.pins.every((p) => p.move === null));
  // A rank and its "of N" come from the same moment: never "#2 of 1".
  assert.ok(dash.pins.every((p) => p.rank === null ? p.value === 0 : p.rank >= 1 && p.rank <= p.withAny), JSON.stringify(dash.pins));
  assert.equal(dash.pinsAreDefault, true);
});

test('"couldn\'t check" is a different answer from "no characters"', async () => {
  world.accounts.set('p2', 'error');
  const c = t.client({ ip: '198.51.100.10' });
  await bnetSignIn(c, 'p2');
  assert.equal((await c.get('/api/dashboard')).json.lastCheck.outcome, 'error');
  const d = t.client({ ip: '198.51.100.11' });
  await bnetSignIn(d, 'p3'); // no Forever characters at all: Blizzard answers 404
  assert.equal((await d.get('/api/dashboard')).json.lastCheck.outcome, 'none');
});

test('owners hide a character; the owner still sees it, nobody else does', async () => {
  const c = t.client({ ip: '198.51.100.9' });
  await bnetSignIn(c, 'p1');
  const res = await c.put('/api/account/characters/201/hidden', { hidden: true });
  assert.equal(res.status, 200);
  assert.equal((await t.client().get('/api/characters/zeta-fixture')).json.status, 'hidden');
  const own = (await c.get('/api/characters/zeta-fixture')).json;
  assert.equal(own.status, 'ok');
  assert.equal(own.character.hidden, true);
  // Someone else's character can't be hidden.
  assert.equal((await c.put('/api/account/characters/103/hidden', { hidden: true })).status, 404);
});

test('pins: choose, cap at 12, unknown ids dropped', async () => {
  const c = t.client({ ip: '198.51.100.9' });
  await bnetSignIn(c, 'p1');
  assert.deepEqual((await c.put('/api/account/pins', { statisticIds: [60, 424242] })).json.pinIds, [60]);
  assert.equal((await c.put('/api/account/pins', { statisticIds: Array.from({ length: 13 }, (_, i) => i) })).status, 400);
  assert.equal((await c.get('/api/dashboard')).json.pinsAreDefault, false);
});

test('beta membership is set by the window at creation, can never be edited or back-filled, and survives a merge', async () => {
  const { setBetaOpen } = await import('../beta.js');
  const open = t.client({ ip: '198.51.100.12' });
  await bnetSignIn(open, 'b1');
  const a1 = (await open.get('/api/account')).json.account;
  assert.equal(a1.beta.member, true);
  assert.ok(a1.beta.since);

  await setBetaOpen(t.db, false);
  const closed = t.client({ ip: '198.51.100.13' });
  await bnetSignIn(closed, 'b2');
  const a2 = (await closed.get('/api/account')).json.account;
  assert.equal(a2.beta.member, false);
  assert.equal((await closed.get('/api/session')).json.beta.open, false);

  // Reopening grants nothing to an account made while it was closed; nothing can write the flag directly.
  await setBetaOpen(t.db, true);
  assert.equal((await closed.get('/api/account')).json.account.beta.member, false);
  await assert.rejects(t.db.query('UPDATE accounts SET beta_member = true, beta_since = now() WHERE id = $1', [a2.id]), /beta membership is permanent/);
  await assert.rejects(t.db.query('UPDATE accounts SET beta_member = false WHERE id = $1', [a1.id]), /beta membership is permanent/);

  // Merge the beta account INTO the non-beta one: the kept account becomes a member, from the earlier date.
  const { mergeAccounts } = await import('../account/merge.js');
  await t.db.tx((q) => mergeAccounts(q, a1.id, a2.id));
  const kept = await t.db.one('SELECT beta_member, beta_since FROM accounts WHERE id = $1', [a2.id]);
  assert.equal(kept.beta_member, true);
  assert.equal(new Date(kept.beta_since).getTime(), new Date(a1.beta.since).getTime());
});

test('deleting an account removes it; its characters stay tracked, a hidden one stays hidden', async () => {
  const c = t.client({ ip: '198.51.100.9' });
  await bnetSignIn(c, 'p1');
  const before = (await c.get('/api/account')).json.account;
  assert.equal((await c.del('/api/account')).status, 400); // needs the confirmation
  const del = (await c.del('/api/account', undefined, { confirm: 'delete' })).status;
  assert.equal(del, 200);
  assert.equal(await t.db.one('SELECT id FROM accounts WHERE id = $1', [before.id]), null);
  const z = await t.db.one('SELECT owner_account_id, hidden FROM characters WHERE id = 201');
  assert.deepEqual(z, { owner_account_id: null, hidden: true });
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM account_pins WHERE account_id = $1', [before.id])).n, 0);
});

test('lookups that ask Blizzard are rate limited per network; cached answers are not', async () => {
  const c = t.client({ ip: '198.51.100.30' });
  let last;
  const letters = (i) => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
  for (let i = 0; i < 31; i++) last = await c.get(`/api/characters/nobody${letters(i)}-fixture`);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  // A character fetched minutes ago is served without asking Blizzard, so it isn't limited.
  assert.equal((await c.get('/api/characters/gamma-fixture')).json.status, 'ok');
  assert.equal((await t.client({ ip: '198.51.100.31' }).get('/api/characters/nobodyaa-fixture')).status, 200);
});

test('the budget serves a waiting person before queued background requests, and back-off is per endpoint', async () => {
  const { createBudget, createBackoff, SUCCESS_TO_RESET } = await import('../crawler/budget.js');
  let clock = 0;
  const timers = [];
  const budget = createBudget({ perSecond: 1, now: () => clock, setTimer: (fn, ms) => timers.push({ fn, at: clock + ms }) });
  const order = [];
  budget.take(4).then(() => order.push('first background'));
  for (let i = 0; i < 3; i++) budget.take(4).then(() => order.push(`background ${i}`));
  budget.take(1).then(() => order.push('lookup'));
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
    const tm = timers.shift();
    if (!tm) break;
    clock = tm.at;
    tm.fn();
  }
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order.slice(0, 2), ['first background', 'lookup']);

  const b = createBackoff({ now: () => clock });
  b.fail('profile');
  b.fail('profile');
  assert.ok(b.waitMs('profile') >= 2000);
  assert.equal(b.waitMs('equipment'), 0);
  for (let i = 0; i < SUCCESS_TO_RESET - 1; i++) b.succeed('profile');
  b.fail('profile'); // not yet sustained: the next wait keeps doubling
  assert.ok(b.waitMs('profile') >= 4000);
});

test('admin crawler status: queue depth by priority, request counts, characters refreshed today', async () => {
  const s = await (await import('../admin/crawler.js')).crawlerStatus(t.db);
  assert.ok(s.today.tracked >= 4);
  assert.ok(s.today.checked >= 4);
  assert.ok(s.queue[1]);
  assert.ok(Array.isArray(s.hours));
});
