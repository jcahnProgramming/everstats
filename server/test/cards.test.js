import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Share cards and link previews (0.8.0). Fixture names and made-up ids only. The renderer is a fake that records what
// it was asked to draw (no Chromium), except the last test, which renders a real card when Chromium is installed.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const renders = [];
const fakeRenderer = {
  async render(job) {
    renders.push(job);
    return { png: PNG, ms: 7 };
  },
  stats: () => ({}),
  async close() {},
};
const RENDER = 'https://render.worldofwarcraft.com/us/character/fixture/main-raw.jpg';
const ICON = (n) => `https://render.worldofwarcraft.com/us/icons/56/fixture_${n}.jpg`;
let imageFetches = 0;

let t;
let owner;
let stranger;
let discordUser = 7700;
before(async () => {
  t = await startApp({
    renderer: fakeRenderer,
    fetch: async (url) => {
      const u = String(url);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u === 'https://discord.com/api/oauth2/token') return json(200, { access_token: 'tok' });
      if (u === 'https://discord.com/api/users/@me') return json(200, { id: `2000000000000${discordUser}`, username: 'fixture' });
      if (u.startsWith('https://render.worldofwarcraft.com/')) {
        imageFetches += 1;
        return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return json(404, {});
    },
  });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  await t.db.query("INSERT INTO rulesets (id, name, listed) VALUES (2, 'Normal', true)");
  for (const [id, name, cat] of [[101, 'Creatures killed', 'Kills'], [102, 'Quests completed', 'Quests'], [103, 'Total deaths', 'Deaths']]) {
    await t.db.query('INSERT INTO statistics (id, name, category_path) VALUES ($1, $2, $3::jsonb)', [id, name, JSON.stringify([{ id: 1, name: cat }])]);
  }
  await t.db.query("INSERT INTO guilds (id, slug, name, ruleset_id, faction, profile_fetched_at, profile_state) VALUES (77, 'fixture-guild', 'Fixture Guild', 2, 'Horde', now(), 'ok')");
  owner = await newPlayer();
  stranger = await newPlayer();
  const gear = [
    { slot: 'HEAD', slotName: 'Head', name: 'Fixture Helm', quality: 'rare', itemId: 9001, tooltip: {}, transmog: { itemId: 9101, name: 'Fixture Look Helm' } },
    { slot: 'CHEST', slotName: 'Chest', name: 'Fixture Robe', quality: 'epic', itemId: 9002, tooltip: {}, transmog: null },
  ];
  for (let i = 1; i <= 6; i++) {
    await t.db.query(
      `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, race, class, level, profile_state, source, stats_fetched_at, last_fetched_at, data_fetched_at,
                               owner_account_id, hidden, guild_id, media, media_state, media_fetched_at, equipment)
       VALUES ($1, $2, $3, 'Fixture', 2, 'Horde', 'Orc', 'Warrior', 40, 'ok', 'lookup', now(), now(), now(), $4, $5, 77, $6::jsonb, 'ok', now(), $7::jsonb)`,
      [i, `card${'abcdef'[i - 1]}-fixture`, `Card${'abcdef'[i - 1]}`, i === 1 ? owner.id : null, i === 4, JSON.stringify({ 'main-raw': RENDER }), JSON.stringify(gear)],
    );
    // 101 for everyone (i × 10), 102 only for some, 103 for nobody: a statistic with no value can't go on a card.
    await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at, hidden) VALUES ($1, 101, 2, $2, now(), $3)', [i, i * 10, i === 4]);
    if (i % 2) await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at, hidden) VALUES ($1, 102, 2, $2, now(), $3)', [i, i, i === 4]);
  }
  await t.db.query("INSERT INTO item_media (item_id, state, icon_url, fetched_at) VALUES (9001, 'ok', $1, now()), (9002, 'ok', $2, now()), (9101, 'ok', $3, now())", [ICON(1), ICON(2), ICON(3)]);
  await t.db.query("INSERT INTO character_render_hidden (character_id, account_id) VALUES (3, NULL)").catch(async () => {
    await t.db.query('INSERT INTO character_render_hidden (character_id, account_id) VALUES (3, $1)', [owner.id]);
  });
});
after(() => t.close());

let ip = 20;
async function newPlayer() {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  return { c, id: (await c.get('/api/account')).json.account.id };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const lastData = () => renders.at(-1).data;

test('options: only what the design has; anything else falls back to the defaults', async () => {
  const { cleanOptions, statsShown } = await import('../cards/catalog.js');
  const o = cleanOptions('character', { format: 'poster', theme: 'neon', accent: '#ff0000', layout: 'c', show: { tier: false, evil: true }, stats: [1, 'x', 2, 2, 3, 4, 5, 6, 7], gear: 'transmog' });
  assert.equal(o.format, 'wide');
  assert.equal(o.theme, 'forever');
  assert.equal(o.accent, 'accent');
  assert.equal(o.layout, 'a');
  assert.equal(o.show.tier, false);
  assert.equal('evil' in o.show, false);
  assert.deepEqual(o.stats, [1, 2, 3, 4, 5, 6]);
  assert.equal(o.gear, 'transmog');
  assert.equal(statsShown('square', 'b'), 3);
  assert.equal(statsShown('wide', 'a'), 3);
  assert.equal(statsShown('story', 'b'), 6);
});

test('a character card: live data, only real values, the owner’s render and transmog choices, dated', async () => {
  const c = t.client({ ip: '203.0.113.50' });
  const r = await c.get(`/card.png?type=character&c=carda-fixture&o=${b64({ format: 'square', stats: [103, 101, 102], gear: 'transmog' })}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  const d = lastData();
  assert.equal(renders.at(-1).type, 'character');
  assert.equal(d.first, 'Carda');
  assert.equal(d.ruleset, 'Normal');
  assert.equal(d.url.endsWith('/c/carda-fixture'), true);
  assert.match(d.asof, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  // 103 has no value for anyone: never on a card (the "missing stat" state), never a placeholder number.
  assert.deepEqual(d.stats.map((s) => s.label), ['Creatures killed', 'Quests completed']);
  assert.equal(d.stats[0].value, '10');
  assert.match(d.stats[0].rank, /^#\d+ · Normal$/);
  // Blizzard's images arrive as data: URIs (the card page makes no request), transmog swaps the transmogged slot only.
  assert.match(d.render, /^data:image\/png;base64,/);
  assert.deepEqual(d.gear.map((g) => g.q), ['q-tmog', 'q-epic']);
  assert.ok(d.gear.every((g) => g.icon?.startsWith('data:image/png')));
  // Too few for a tier: Unranked, in words, never a guessed letter.
  assert.deepEqual(d.tier, { letter: '–', cls: 'u', pct: 'Unranked' });
});

test('a render its owner hid is never on a card: the crest version instead', async () => {
  const r = await t.client({ ip: '203.0.113.51' }).get(`/card.png?type=character&c=cardc-fixture&o=${b64({ show: { render: true } })}`);
  assert.equal(r.status, 200);
  assert.equal(lastData().render, null);
  const m = (await t.client().get('/api/cards/maker?type=character&c=cardc-fixture')).json;
  assert.equal(m.choices.render.available, false);
  assert.match(m.choices.render.reason, /owner hid the render/);
});

test('a hidden character can’t be shared: the maker says so, its images are 404, its page has no preview image', async () => {
  const m = await t.client().get('/api/cards/maker?type=character&c=cardd-fixture');
  assert.equal(m.json.status, 'hidden');
  assert.equal((await t.client().get('/card.png?type=character&c=cardd-fixture')).status, 404);
  assert.equal((await t.client().get('/og/c/cardd-fixture.png')).status, 404);
  assert.equal((await t.client().get('/og/t/cardd-fixture.png')).status, 404);
  const { linkPreviewFor, previewTags } = await import('../cards/meta.js');
  const p = await linkPreviewFor(t.db, '/c/cardd-fixture', {});
  assert.equal(p.image ?? null, null);
  assert.equal(p.title, 'Everstats');
  assert.doesNotMatch(previewTags(p, 'https://x'), /og:image/);
});

test('the cache: the same data and options are served without a render; new data renders again', async () => {
  const c = t.client({ ip: '203.0.113.52' });
  const url = `/card.png?type=character&c=carde-fixture&o=${b64({ format: 'wide' })}`;
  const first = await c.get(url);
  assert.equal(first.headers.get('x-card-cache'), 'miss');
  const n = renders.length;
  const again = await c.get(url);
  assert.equal(again.headers.get('x-card-cache'), 'hit');
  assert.equal(renders.length, n);
  await t.db.query('UPDATE character_statistics SET value = 999 WHERE character_id = 5 AND statistic_id = 101');
  const { clearCardMemo } = await import('../cards/routes.js');
  clearCardMemo();
  assert.equal((await c.get(url)).headers.get('x-card-cache'), 'miss');
  assert.equal(renders.length, n + 1);
});

test('renders are limited per network; a cached image never counts', async () => {
  const c = t.client({ ip: '203.0.113.99' });
  let last;
  for (let i = 0; i < 41; i++) {
    last = await c.get(`/card.png?type=character&c=carda-fixture&o=${b64({ format: 'square', accent: ['accent', 'c2', 'c3', 'c4', 'c5'][i % 5], theme: ['forever', 'alliance', 'horde'][Math.floor(i / 5) % 3], layout: i >= 15 ? 'b' : 'a', show: { gear: i < 30 } })}`);
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  // The first one is cached: still served.
  assert.equal((await c.get(`/card.png?type=character&c=carda-fixture&o=${b64({ format: 'square', accent: 'accent', theme: 'forever', layout: 'a', show: { gear: true } })}`)).status, 200);
});

test('only the owner can save a default; it becomes the link preview (always wide); nobody else’s choices are stored', async () => {
  const body = { type: 'character', subject: { c: 'carda-fixture' }, options: { format: 'story', theme: 'horde', accent: 'c3', layout: 'b', stats: [102] } };
  assert.equal((await t.client().put('/api/cards/default', body)).status, 401);
  assert.equal((await stranger.c.put('/api/cards/default', body)).status, 403);
  assert.equal((await stranger.c.put('/api/cards/default', { ...body, subject: { c: 'cardb-fixture' } })).status, 403); // nobody owns it
  const ok = await owner.c.put('/api/cards/default', body);
  assert.equal(ok.status, 200);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM share_card_defaults')).n, 1);
  assert.ok(await t.db.one("SELECT 1 AS x FROM account_events WHERE account_id = $1 AND type = 'share_card.default_saved'", [owner.id]));
  const m = (await stranger.c.get('/api/cards/maker?type=character&c=carda-fixture')).json;
  assert.equal(m.canSave, false);
  assert.equal(m.initial.theme, 'horde');
  assert.equal((await owner.c.get('/api/cards/maker?type=character&c=carda-fixture')).json.canSave, true);
  const og = await t.client({ ip: '203.0.113.53' }).get('/og/c/carda-fixture.png');
  assert.equal(og.status, 200);
  const job = renders.at(-1);
  assert.equal(job.format, 'wide');
  assert.equal(job.layout, 'b');
  assert.equal(job.data.theme, 'horde');
  assert.equal(job.data.accent, 'c3');
  assert.deepEqual(job.data.stats.map((s) => s.label), ['Quests completed']);
  // A board card belongs to no one: nothing to save.
  assert.equal((await owner.c.put('/api/cards/default', { type: 'board', subject: {}, options: {} })).status, 400);
});

test('link previews: Open Graph and Twitter tags on card pages, pointing at the wide card', async () => {
  const { linkPreviewFor, withPreview } = await import('../cards/meta.js');
  const p = await linkPreviewFor(t.db, '/c/carda-fixture', {});
  assert.match(p.image, /^\/og\/c\/carda-fixture\.png\?v=/);
  const html = withPreview('<html><head><title>Everstats</title><meta name="description" content="x" /></head></html>', p, 'https://everstats.example/c/carda-fixture');
  assert.match(html, /<meta property="og:image" content="[^"]+\/og\/c\/carda-fixture\.png\?v=[^"]+" \/>/);
  assert.match(html, /og:image:width" content="1200"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.match((await linkPreviewFor(t.db, '/c/carda-fixture/tier/share', {})).image, /^\/og\/t\//);
  assert.match((await linkPreviewFor(t.db, '/g/fixture-guild', {})).image, /^\/og\/g\/fixture-guild\.png/);
  assert.match((await linkPreviewFor(t.db, '/leaderboards/2/101', {})).image, /^\/og\/b\/2\/101\.png/);
  assert.equal((await linkPreviewFor(t.db, '/settings', {})).image ?? null, null);
  // Escaped, always.
  assert.doesNotMatch(withPreview('<head></head>', { title: '"><script>', description: 'x', image: null }, 'u'), /"><script>/);
});

test('a guild card: the Discord invite only once its editors set one; the leaderboard period label is live', async () => {
  const c = t.client({ ip: '203.0.113.54' });
  assert.equal((await c.get(`/card.png?type=guild&g=fixture-guild&o=${b64({ show: { recruiting: true } })}`)).status, 200);
  assert.equal(lastData().discord, '');
  assert.equal(lastData().show.recruiting, false);
  await t.db.query("INSERT INTO guild_pages (guild_id, discord_invite) VALUES (77, 'fixtureinv') ON CONFLICT (guild_id) DO UPDATE SET discord_invite = EXCLUDED.discord_invite");
  const { clearCardMemo } = await import('../cards/routes.js');
  clearCardMemo();
  await c.get(`/card.png?type=guild&g=fixture-guild&o=${b64({ show: { recruiting: true } })}`);
  assert.equal(lastData().discord, 'discord.gg/fixtureinv');
  assert.equal(lastData().show.recruiting, true);
  assert.ok(lastData().pinned_svg.startsWith('<svg'));
  const { periodLabel } = await import('../cards/data.js');
  const { retentionPolicy } = await import('../retention/policy.js');
  assert.equal(await periodLabel(t.db, 'rolling'), `Last ${(await retentionPolicy(t.db)).keepDays} days`);
  assert.notEqual(await periodLabel(t.db, 'rolling'), 'Last 30 days');
});

test('a board card: the placement, the top three and the neighbours; hidden characters are on none of them', async () => {
  const r = await t.client({ ip: '203.0.113.55' }).get('/card.png?type=board&ruleset=2&statistic=101&period=overall&c=cardc-fixture');
  assert.equal(r.status, 200);
  const d = lastData();
  assert.equal(d.stat, 'Creatures killed');
  assert.equal(d.scope, 'Normal · Overall');
  assert.equal(d.unit, ''); // Blizzard sends no unit: none is invented
  assert.ok(d.top3.length <= 3);
  assert.ok(d.neighbours.some((n) => n.cls === 'me' && n.name === 'Cardc Fixture'));
  assert.ok([...d.top3, ...d.neighbours].every((n) => !n.name.startsWith('Cardd'))); // character 4 is hidden
  assert.equal(d.render, null); // its owner hid the render
  // Not on the board (a zero): no card.
  assert.equal((await t.client().get('/card.png?type=board&ruleset=2&statistic=102&c=cardb-fixture')).status, 409);
});

test('a tier card: the live categories (never the mockup’s ten), Unranked in words', async () => {
  await t.client({ ip: '203.0.113.56' }).get('/card.png?type=tier&c=carda-fixture');
  const d = lastData();
  const { characterTierView } = await import('../tiers/view.js');
  const row = await t.db.one('SELECT * FROM characters WHERE id = 1');
  const view = await characterTierView(t.db, row);
  assert.equal(d.cats.length, (view.categories ?? []).length);
  assert.notEqual(d.cats.length, 10);
  assert.match(d.pct, /^Unranked on Normal$/);
});

test('hiding a character deletes every cached card that shows it, at once', async () => {
  const before = await t.db.one('SELECT count(*)::int AS n FROM share_card_images WHERE 1::bigint = ANY(character_ids)');
  assert.ok(before.n > 0);
  const { setHidden } = await import('../crawler/store.js');
  await t.db.tx((q) => setHidden(q, 1, true));
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM share_card_images WHERE 1::bigint = ANY(character_ids)')).n, 0);
  await t.db.tx((q) => setHidden(q, 1, false));
});

test('cached images are Blizzard data: swept by the retention window and never in a backup', async () => {
  const { BLIZZARD, OURS } = await import('../retention/registry.js');
  assert.ok(BLIZZARD.some((b) => b.table === 'share_card_images'));
  assert.ok('share_card_defaults' in OURS);
  await t.db.query("UPDATE share_card_images SET data_at = now() - interval '40 days' WHERE key IN (SELECT key FROM share_card_images LIMIT 1)");
  const sweep = BLIZZARD.find((b) => b.table === 'share_card_images').sweep;
  assert.ok(await t.db.tx((q) => sweep(q, new Date(Date.now() - 29 * 86400000))) >= 1);
});

test('the card kit is the design’s files, byte for byte', async () => {
  const kit = resolve(import.meta.dirname, '../cards/kit');
  const design = resolve(import.meta.dirname, '../../design');
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const files = walk(kit);
  assert.ok(files.length >= 40);
  for (const f of files) {
    const rel = relative(kit, f);
    assert.ok(readFileSync(f).equals(readFileSync(join(design, rel))), `${rel} differs from design/${rel}`);
  }
});

const chromium = (() => {
  try {
    const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', '.cache'), 'ms-playwright');
    return existsSync(dir) && readdirSync(dir).some((d) => d.startsWith('chromium'));
  } catch {
    return false;
  }
})();

test('a real render: Chromium draws a card at exactly the format’s size', { skip: chromium ? false : 'Chromium is not installed here' }, async () => {
  const { createCardRenderer } = await import('../cards/render.js');
  const r = createCardRenderer({ maxConcurrent: () => 1 });
  try {
    const data = { ...renders.find((x) => x.type === 'character').data, render: null };
    const out = await r.render({ type: 'character', format: 'wide', layout: 'a', data });
    assert.equal(out.png.subarray(1, 4).toString(), 'PNG');
    assert.equal(out.png.readUInt32BE(16), 1200);
    assert.equal(out.png.readUInt32BE(20), 630);
  } finally {
    await r.close();
  }
});

export { randomBytes };

test('transmog: the parser keeps the transmog item’s id and name only; none is null, a malformed one is none', async () => {
  const { parseEquipment } = await import('../crawler/parse.js');
  const item = (transmog) => ({ slot: { type: 'SHOULDER', name: 'Shoulders' }, name: 'Rugged Spaulders', quality: { type: 'UNCOMMON' }, item: { id: 9201 }, ...(transmog === undefined ? {} : { transmog }) });
  const [a, b, c] = parseEquipment({
    equipped_items: [
      item({ item: { key: { href: 'https://us.api.blizzard.com/data/wow/item/9301' }, name: 'Inscribed Leather Spaulders', id: 9301 }, display_string: 'Transmogrified to:', item_modified_appearance_id: 42 }),
      item(undefined),
      item({ item: { name: 'No id' } }),
    ],
  });
  assert.deepEqual(a.transmog, { itemId: 9301, name: 'Inscribed Leather Spaulders' });
  assert.equal(b.transmog, null);
  assert.equal(c.transmog, null);
  const { gearItemIds } = await import('../crawler/items.js');
  assert.deepEqual(gearItemIds([a, b]).sort(), [9201, 9301]);
});
