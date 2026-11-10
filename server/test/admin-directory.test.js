import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Directory › Characters and Guilds (0.10.3, server/admin/directory.js) and the endpoints the v5 Inbox / Directory added
// to the moderation and feedback routers. Fixture names and made-up ids only.
let t;
let admin;
let owner;
const V = 'forever';
const OTHER = 'retail';

before(async () => {
  t = await startApp();
  const { sha256Hex } = await import('../credentials/crypto.js');
  const token = randomBytes(32).toString('base64url');
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };

  owner = Number((await t.db.one("INSERT INTO accounts (username, username_claimed) VALUES ('fixtureowner', true) RETURNING id")).id);
  await t.db.query("INSERT INTO rulesets (id, name, game_version, region) VALUES (2, 'Normal', $1, 'us'), (3, 'Hardcore', $1, 'us'), (900000001, 'Normal', $2, 'us') ON CONFLICT DO NOTHING", [V, OTHER]);
  await t.db.query("INSERT INTO guilds (id, slug, name, faction, ruleset_id, roster_members, game_version, region) VALUES (77, 'fixture-guild', 'Fixture Guild', 'ALLIANCE', 2, 3, $1, 'us'), (78, 'other-guild', 'Other Guild', 'HORDE', 2, 1, $1, 'us')", [V]);
  await t.db.query("INSERT INTO guilds (id, slug, name, faction, ruleset_id, game_version, region, blizzard_id) VALUES (900000077, 'fixture-guild', 'Fixture Guild Retail', 'HORDE', 900000001, $1, 'us', 77)", [OTHER]);
  const ch = (id, slug, level, extra = {}) => t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, class, level, profile_state, source, data_fetched_at, stats_fetched_at,
                             last_fetched_at, owner_account_id, hidden, guild_id, game_version, region, blizzard_id, tracked_since)
     VALUES ($1, $2, $3, 'Fixture', $4, 'Alliance', 'Mage', $5, 'ok', 'lookup', now(), now(), $6, $7, $8, $9, $10, 'us', $11, now() - ($12 || ' minutes')::interval)`,
    [id, slug, extra.name ?? 'Vexa', extra.ruleset ?? 2, level, extra.fetched ?? new Date(), extra.owner ?? null, extra.hidden ?? false,
      extra.guild ?? null, extra.version ?? V, extra.blizzardId ?? id, String(extra.age ?? id % 1000)],
  );
  await ch(501, 'vexa-fixture', 60, { owner, guild: 77 });
  await ch(502, 'brann-fixture', 25, { name: 'Brann', hidden: true, guild: 77 });
  await ch(503, 'cora-fixture', 12, { name: 'Cora', ruleset: 3, fetched: new Date(Date.now() - 10 * 86400000) });
  await ch(900000501, 'vexa-fixture', 70, { version: OTHER, ruleset: 900000001, blizzardId: 501 });
  await t.db.query("INSERT INTO character_tiers (character_id, ruleset_id, score, letter, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at) VALUES (501, 2, 0.9, 'S', 3, 2, 3, '{}', '{}', 'full', now())");
  await t.db.query("INSERT INTO character_tiers (character_id, ruleset_id, score, letter, reason, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at) VALUES (503, 3, null, null, 'no_categories', 0, 2, 3, '{}', '{}', 'full', now())");
  await t.db.query('INSERT INTO guild_roster (guild_id, character_id, rank, level, fetched_at) VALUES (77, 501, 0, 60, now())');
  await t.db.query("INSERT INTO guild_links (guild_id, position, label, url, host, created_by) VALUES (77, 1, 'Recruiting', 'https://example.com/join', 'example.com', $1)", [owner]);
  await t.db.query("INSERT INTO character_gold (character_id, account_id, money) VALUES (501, $1, 12345)", [owner]);
});
after(() => t.close());

const get = (path, headers = admin) => t.client().get(path, headers);
const NEVER = ['position', 'bind_position', 'bindPosition', 'wow_account', 'wowAccount'];
const noSecrets = (json) => {
  const text = JSON.stringify(json);
  for (const k of NEVER) assert.equal(text.includes(`"${k}"`), false, `${k} must never be sent`);
};

test('without an admin session every directory endpoint is a plain 404', async () => {
  for (const p of ['/api/admin/directory/counts', '/api/admin/directory/characters', '/api/admin/directory/guilds', '/api/admin/directory/guilds/77', `/api/admin/directory/accounts/${owner}/characters`]) {
    assert.equal((await get(p, {})).status, 404, p);
  }
});

test('characters: per version, hidden included and marked, owner shown as @username, no secret fields', async () => {
  const r = await get(`/api/admin/directory/characters?v=${V}&r=us`);
  assert.equal(r.status, 200);
  noSecrets(r.json);
  assert.equal(r.json.total, 3);
  assert.deepEqual(r.json.characters.map((c) => c.id).sort(), [501, 502, 503]);
  const vexa = r.json.characters.find((c) => c.id === 501);
  assert.deepEqual(vexa.owner, { id: owner, username: 'fixtureowner' });
  assert.equal(vexa.tier.letter, 'S');
  assert.equal(vexa.publicPath, '/c/vexa-fixture');
  const brann = r.json.characters.find((c) => c.id === 502);
  assert.equal(brann.hidden, true);
  assert.equal(brann.publicPath, null);
  assert.equal(brann.owner, null);
  assert.ok(r.json.facets.rulesets.some((x) => x.name === 'Hardcore'));

  const other = await get(`/api/admin/directory/characters?v=${OTHER}&r=us`);
  assert.deepEqual(other.json.characters.map((c) => c.id), [900000501]);
  assert.equal(other.json.characters[0].publicPath, null); // no public pages for another version yet
});

test('characters: search and every filter narrow the list', async () => {
  const ids = async (qs) => (await get(`/api/admin/directory/characters?v=${V}&r=us&${qs}`)).json.characters.map((c) => c.id).sort();
  assert.deepEqual(await ids('q=bra'), [502]);
  assert.deepEqual(await ids('q=@fixtureowner'), [501]);
  assert.deepEqual(await ids('ruleset=3'), [503]);
  assert.deepEqual(await ids('levelMin=20&levelMax=59'), [502]);
  assert.deepEqual(await ids('tier=S'), [501]);
  assert.deepEqual(await ids('tier=unranked'), [502, 503]);
  assert.deepEqual(await ids('visibility=hidden'), [502]);
  assert.deepEqual(await ids('visibility=public'), [501, 503]);
  assert.deepEqual(await ids('claimed=claimed'), [501]);
  assert.deepEqual(await ids('claimed=unclaimed'), [502, 503]);
  assert.deepEqual(await ids('fetched=older'), [503]);
  assert.deepEqual(await ids('fetched=day'), [501, 502]);
  assert.deepEqual(await ids("q=%25'%3B--"), []); // LIKE wildcards and quotes are data, not SQL
});

test('characters: keyset pages cover everything once, in order, bounded by the limit', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 5; i += 1) {
    const r = await get(`/api/admin/directory/characters?v=${V}&r=us&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
    assert.ok(r.json.characters.length <= 1);
    seen.push(...r.json.characters.map((c) => c.id));
    cursor = r.json.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen.sort(), [501, 502, 503]);
  assert.equal(new Set(seen).size, 3);
  assert.equal((await get(`/api/admin/directory/characters?v=${V}&r=us&limit=100000`)).json.characters.length, 3);
  assert.equal((await get(`/api/admin/directory/characters?v=${V}&r=us&cursor=not-a-cursor`)).status, 200);
});

test('guilds: per version, tracked / roster, ranked, Guild Master, links, filters and paging', async () => {
  const r = await get(`/api/admin/directory/guilds?v=${V}&r=us`);
  assert.equal(r.status, 200);
  noSecrets(r.json);
  assert.deepEqual(r.json.guilds.map((g) => g.id), [77, 78]);
  const g = r.json.guilds[0];
  assert.equal(g.tracked, 1); // the hidden member doesn't count
  assert.equal(g.roster, 3);
  assert.equal(g.links, 1);
  assert.deepEqual(g.gm, { id: owner, username: 'fixtureowner' });
  assert.equal(g.ranked, false); // default minimum 5
  const ids = async (qs) => (await get(`/api/admin/directory/guilds?v=${V}&r=us&${qs}`)).json.guilds.map((x) => x.id);
  assert.deepEqual(await ids('q=fixture'), [77]);
  assert.deepEqual(await ids('faction=horde'), [78]);
  assert.deepEqual(await ids('gm=claimed'), [77]);
  assert.deepEqual(await ids('gm=unclaimed'), [78]);
  assert.deepEqual(await ids('ranked=ranked'), []);
  assert.deepEqual(await ids('ranked=not'), [77, 78]);
  const p1 = await get(`/api/admin/directory/guilds?v=${V}&r=us&limit=1`);
  const p2 = await get(`/api/admin/directory/guilds?v=${V}&r=us&limit=1&cursor=${p1.json.next}`);
  assert.deepEqual([...p1.json.guilds, ...p2.json.guilds].map((x) => x.id), [77, 78]);
  assert.equal(p2.json.next, null);
  assert.deepEqual((await get(`/api/admin/directory/guilds?v=${OTHER}&r=us`)).json.guilds.map((x) => x.id), [900000077]);
});

test('one guild: its links with who added them and their reports; unknown ids 404', async () => {
  const link = await t.db.one('SELECT id FROM guild_links WHERE guild_id = 77');
  await t.db.query("INSERT INTO guild_link_reports (link_id, guild_id, note) VALUES ($1, 77, 'Fixture note')", [link.id]);
  const r = await get('/api/admin/directory/guilds/77');
  assert.equal(r.status, 200);
  assert.equal(r.json.guild.name, 'Fixture Guild');
  assert.equal(r.json.links.length, 1);
  assert.equal(r.json.links[0].openReports, 1);
  assert.equal(r.json.links[0].reports[0].note, 'Fixture note');
  assert.deepEqual(r.json.links[0].addedBy, { id: owner, username: 'fixtureowner' });
  assert.equal((await get('/api/admin/directory/guilds/12345')).status, 404);
  assert.equal((await get('/api/admin/directory/counts?v=forever&r=us')).json.guilds, 2);
});

test('an account’s characters (every version, hidden marked) and gold as counts only', async () => {
  const r = await get(`/api/admin/directory/accounts/${owner}/characters`);
  assert.equal(r.status, 200);
  noSecrets(r.json);
  assert.deepEqual(r.json.characters.map((c) => c.id), [501]);
  assert.deepEqual(r.json.gold, { charactersWithGold: 1, shownPublicly: 0 });
  assert.equal(JSON.stringify(r.json).includes('12345'), false); // never an amount
  assert.equal((await get('/api/admin/directory/accounts/99999/characters')).status, 404);
});

test('accounts list: the v5 filters combine; reveal logs its reason; reports and feedback counts', async () => {
  const list = async (qs) => (await get(`/api/admin/moderation/accounts?${qs}`)).json.accounts.map((a) => a.id);
  assert.ok((await list('status=active')).includes(owner));
  assert.deepEqual(await list('status=banned'), []);
  assert.deepEqual(await list('signin=discord'), []);
  assert.ok((await list('twofa=off&created=7d')).includes(owner));
  assert.ok((await list('status=nonsense')).includes(owner)); // unknown values are ignored, never interpolated

  const rev = await t.client().post(`/api/admin/moderation/accounts/${owner}/reveal`, { reason: 'Checking a fixture' }, admin);
  assert.equal(rev.status, 200);
  const logged = await t.db.one("SELECT reason FROM moderation_actions WHERE account_id = $1 AND type = 'identities_revealed' ORDER BY id DESC LIMIT 1", [owner]);
  assert.equal(logged.reason, 'Checking a fixture');

  assert.equal((await get('/api/admin/moderation/reports/count')).json.open, 1);
  assert.equal((await get('/api/admin/moderation/reports/count', {})).status, 404);
  const fb = await get('/api/admin/feedback/counts');
  assert.equal(fb.status, 200);
  assert.equal(typeof fb.json.counts.unread, 'number');
  assert.equal((await get('/api/admin/feedback?state=all')).status, 200);
});
