import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { ORIGIN, startApp } from './helpers.js';

// Badges (0.7.0). Fixture names and made-up ids only; nothing here reaches Blizzard or Discord.
let t;
let admin;
let discordUser = 9100;
before(async () => {
  t = await startApp({
    fetch: async (url) => {
      const u = String(url);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u === 'https://discord.com/api/oauth2/token') return json(200, { access_token: 'tok' });
      if (u === 'https://discord.com/api/users/@me') return json(200, { id: `1000000000000${discordUser}`, username: 'fixture' });
      return json(404, {});
    },
  });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  const { sha256Hex } = await import('../credentials/crypto.js');
  const token = randomBytes(32).toString('base64url');
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
  await t.db.query("INSERT INTO rulesets (id, name) VALUES (2, 'Normal') ON CONFLICT DO NOTHING");
});
after(() => t.close());

let ip = 10;
/** A new account through a Discord sign-in (the beta window is open, so it's a beta member), with a username. */
async function newPlayer(username) {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  if (username) await c.put('/api/account/username', { username });
  const id = (await c.get('/api/account')).json.account.id;
  return { c, id };
}

let nextChar = 50_000;
async function addCharacter(owner, { cls, faction = 'Horde', level = 20, hidden = false, guildId = null, fetched = true } = {}) {
  nextChar += 1;
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, class, level, profile_state, source, data_fetched_at, stats_fetched_at, owner_account_id, hidden, guild_id)
     VALUES ($1, $2, 'Fixture', $3, 2, $4, $5, $6, 'ok', 'account', now(), CASE WHEN $9 THEN now() END, $7, $8, $10)`,
    [nextChar, `fixture-c${nextChar}`, `C${nextChar}`, faction, cls, level, owner, hidden, fetched, guildId],
  );
  return nextChar;
}

const held = async (accountId) => (await t.db.query("SELECT badge_id FROM badge_awards WHERE account_id = $1 AND state = 'held' ORDER BY badge_id", [accountId])).map((r) => r.badge_id);

test('the seeded definitions match the design export: 22 badges, staff and partner verified, only S-Tier kept while held', async () => {
  const defs = await t.db.query('SELECT id, family, award, verified, kept_while_held FROM badge_definitions ORDER BY sort');
  assert.equal(defs.length, 22);
  assert.deepEqual(defs.filter((d) => d.kept_while_held).map((d) => d.id), ['s-tier']);
  for (const d of defs) assert.equal(d.verified, ['staff', 'partner'].includes(d.family), d.id);
  assert.deepEqual(defs.filter((d) => d.award === 'manual').map((d) => d.id), ['dev-team', 'moderator', 'community-partner', 'blizzard-employee', 'discord-employee']);
});

test('automatic badges: beta at sign-in; class, faction, Envoy from level 10+ owned characters (hidden ones too); never from under 10', async () => {
  const { evaluateAccount } = await import('../badges/rules.js');
  const p = await newPlayer('ruletester');
  assert.deepEqual(await held(p.id), ['beta-tester'], 'a sign-in during the open beta gives Beta Tester at once');
  await addCharacter(p.id, { cls: 'Mage', faction: 'Horde', level: 9 });
  await evaluateAccount(t.db, p.id);
  assert.deepEqual(await held(p.id), ['beta-tester'], 'level 9 earns nothing');
  const mage = await addCharacter(p.id, { cls: 'Mage', faction: 'Horde', level: 12, hidden: true });
  const r = await evaluateAccount(t.db, p.id);
  assert.deepEqual(r.earned.sort(), ['class-mage', 'horde']);
  await addCharacter(p.id, { cls: 'Rogue', faction: 'Alliance', level: 60 });
  await evaluateAccount(t.db, p.id);
  assert.deepEqual(await held(p.id), ['alliance', 'beta-tester', 'class-mage', 'class-rogue', 'envoy', 'horde']);
  // The award keeps the earning character's id and nothing Blizzard sent about it.
  const row = await t.db.one("SELECT * FROM badge_awards WHERE account_id = $1 AND badge_id = 'class-mage'", [p.id]);
  assert.equal(row.character_id, mage);
  assert.ok(!JSON.stringify(row).includes('Fixture'));

  // Stays once earned: the character is purged (Blizzard data stripped), the other deleted from the account.
  await t.db.query("UPDATE characters SET profile_state = 'purged', class = NULL, faction = NULL, level = NULL WHERE owner_account_id = $1", [p.id]);
  await evaluateAccount(t.db, p.id);
  assert.deepEqual(await held(p.id), ['alliance', 'beta-tester', 'class-mage', 'class-rogue', 'envoy', 'horde']);
});

test('Every Calling needs every class: each class badge AND any class Blizzard returned that has no badge yet', async () => {
  const { evaluateAccount } = await import('../badges/rules.js');
  const p = await newPlayer('allclasses');
  for (const cls of ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock']) await addCharacter(p.id, { cls });
  await evaluateAccount(t.db, p.id);
  assert.ok(!(await held(p.id)).includes('every-calling'));
  await addCharacter(p.id, { cls: 'Druid' });
  // Someone else has a class no badge names yet: Every Calling now needs it too.
  const other = await newPlayer(null);
  await addCharacter(other.id, { cls: 'Skyborne' });
  await evaluateAccount(t.db, p.id);
  assert.ok(!(await held(p.id)).includes('every-calling'));
  await addCharacter(p.id, { cls: 'Skyborne' });
  await evaluateAccount(t.db, p.id);
  assert.ok((await held(p.id)).includes('every-calling'));
});

test('S-Tier is kept only while held: removed with a toast and a log row when the S goes, restored when it comes back', async () => {
  const { evaluateAccount } = await import('../badges/rules.js');
  const p = await newPlayer('stierfixture');
  const ch = await addCharacter(p.id, { cls: 'Hunter' });
  const tier = (letter) => t.db.query(
    `INSERT INTO character_tiers (character_id, ruleset_id, score, letter, reason, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at)
     VALUES ($1, 2, 0.99, $2, $3, 1, 1, 1, '{}', '{}', 'full', now())
     ON CONFLICT (character_id) DO UPDATE SET letter = EXCLUDED.letter, reason = EXCLUDED.reason`,
    [ch, letter, letter ? null : 'few_categories'],
  );
  await tier('S');
  await evaluateAccount(t.db, p.id);
  assert.ok((await held(p.id)).includes('s-tier'));
  await t.db.query('UPDATE badge_awards SET toast = NULL WHERE account_id = $1', [p.id]);
  await tier('A');
  const r = await evaluateAccount(t.db, p.id);
  assert.deepEqual(r.removed, ['s-tier']);
  const row = await t.db.one("SELECT state, revoked_by, toast, revoked_reason FROM badge_awards WHERE account_id = $1 AND badge_id = 's-tier'", [p.id]);
  assert.deepEqual([row.state, row.revoked_by, row.toast], ['revoked', 'rule', 'removed']);
  assert.ok(row.revoked_reason);
  assert.ok(await t.db.one("SELECT 1 AS x FROM badge_events WHERE account_id = $1 AND badge_id = 's-tier' AND type = 'removed'", [p.id]));
  // The toast reaches the player once, then is acknowledged.
  const toasts = (await p.c.get('/api/account/badges/toasts')).json.toasts;
  assert.deepEqual(toasts.map((x) => [x.kind, x.badge.id]), [['removed', 's-tier']]);
  await p.c.post('/api/account/badges/toasts/ack', { ids: ['s-tier'] });
  assert.equal((await p.c.get('/api/account/badges/toasts')).json.toasts.length, 0);
  await tier('S');
  await evaluateAccount(t.db, p.id);
  assert.ok((await held(p.id)).includes('s-tier'));
});

test('display: public / featured (max 6, staff and partner first) / pinned; private badges appear nowhere; the inline badge follows the pin', async () => {
  const { evaluateAccount } = await import('../badges/rules.js');
  const p = await newPlayer('displayfixture');
  for (const cls of ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman']) await addCharacter(p.id, { cls, faction: 'Alliance' });
  await evaluateAccount(t.db, p.id);
  await admin_grant(p.id, 'dev-team', 'Builds Everstats (fixture).');
  const s = (await p.c.get('/api/account/badges')).json;
  assert.equal(s.earned.length, 9);
  assert.equal(s.earned[0].id, 'dev-team', 'staff first');
  assert.equal(s.earned.filter((b) => b.featured).length, 6, 'new badges are featured while there is room');
  // Dev Team was granted with the row already full: staff leads anyway, and the last ordinary badge moved to "more".
  assert.equal(s.earned.find((b) => b.id === 'dev-team').featured, true);
  assert.equal(s.earned.find((b) => b.id === 'dev-team').position, 1);
  const all = s.earned.map((b) => b.id);
  // 7 featured is refused with the design's note.
  const seven = await p.c.put('/api/account/badges', { shown: all, featured: all.slice(0, 7), pinned: null });
  assert.equal(seven.status, 400);
  assert.match(seven.json.error, /up to 6\. Turn one off first/);
  // A badge you don't hold, a featured one that isn't public, a pin on a private one: refused.
  assert.equal((await p.c.put('/api/account/badges', { shown: ['moderator'], featured: [], pinned: null })).status, 400);
  assert.equal((await p.c.put('/api/account/badges', { shown: [], featured: ['class-rogue'], pinned: null })).status, 400);
  assert.equal((await p.c.put('/api/account/badges', { shown: ['alliance'], featured: [], pinned: 'class-rogue' })).status, 400);

  // Mage-less, Dev Team put LAST by the player: staff still comes first. Rogue pinned. Paladin private.
  const shown = all.filter((x) => x !== 'class-paladin');
  const ok = await p.c.put('/api/account/badges', { shown, featured: ['class-rogue', 'alliance', 'dev-team'], pinned: 'class-rogue' });
  assert.equal(ok.status, 200);
  const pub = (await t.client().get('/api/users/displayfixture')).json.badges;
  assert.deepEqual(pub.featured.map((b) => b.id), ['dev-team', 'class-rogue', 'alliance']);
  assert.ok(!pub.more.some((b) => b.id === 'class-paladin') && !pub.featured.some((b) => b.id === 'class-paladin'), 'private is private');
  assert.equal(pub.more.length, shown.length - 3);
  // Inline: the pinned one, in the header and on "Claimed by".
  assert.equal((await p.c.get('/api/session')).json.user.badge.id, 'class-rogue');
  // Unpinned → the first featured (staff first). Nothing public → no inline badge, and no badge row at all.
  await p.c.put('/api/account/badges', { shown, featured: ['class-rogue', 'dev-team'], pinned: null });
  assert.equal((await p.c.get('/api/session')).json.user.badge.id, 'dev-team');
  await p.c.put('/api/account/badges', { shown: [], featured: [], pinned: null });
  assert.equal((await p.c.get('/api/session')).json.user.badge, null);
  assert.equal((await t.client().get('/api/users/displayfixture')).json.badges, null);
});

async function admin_grant(accountId, badgeId, reason, notify = false) {
  return t.client({ ip: '203.0.113.200' }).post(`/api/admin/badges/accounts/${accountId}/grant`, { badgeId, reason, notify }, admin);
}

test('admin: grants need a reason and a manual badge; revoking is a logged state, never a delete; Dev Team grants no admin access', async () => {
  const p = await newPlayer('grantee');
  const a = t.client({ ip: '203.0.113.201' });
  assert.equal((await a.post(`/api/admin/badges/accounts/${p.id}/grant`, { badgeId: 'dev-team', reason: '' }, admin)).json.code, 'reason_required');
  assert.equal((await a.post(`/api/admin/badges/accounts/${p.id}/grant`, { badgeId: 'horde', reason: 'x' }, admin)).json.code, 'automatic');
  // Without an admin session the admin badge API is a plain 404.
  assert.equal((await p.c.post(`/api/admin/badges/accounts/${p.id}/grant`, { badgeId: 'dev-team', reason: 'me' })).status, 404);
  const g = await a.post(`/api/admin/badges/accounts/${p.id}/grant`, { badgeId: 'dev-team', reason: 'Fixture builder', notify: true }, admin);
  assert.equal(g.status, 200);
  // Beta Tester's "earned" toast from the sign-in, then the grant's "granted" toast (the admin ticked "notify").
  assert.deepEqual((await p.c.get('/api/account/badges/toasts')).json.toasts.map((x) => [x.kind, x.badge.id]), [['earned', 'beta-tester'], ['granted', 'dev-team']]);
  // Dev Team is cosmetic: the admin API still answers 404 to this player.
  assert.equal((await p.c.get('/api/admin/state')).status, 404);
  const rv = await a.post(`/api/admin/badges/accounts/${p.id}/revoke`, { badgeId: 'dev-team', reason: 'Fixture: left the team' }, admin);
  assert.equal(rv.status, 200);
  const row = await t.db.one("SELECT state, revoked_by, revoked_reason FROM badge_awards WHERE account_id = $1 AND badge_id = 'dev-team'", [p.id]);
  assert.deepEqual(row, { state: 'revoked', revoked_by: 'admin', revoked_reason: 'Fixture: left the team' });
  const log = (await a.get('/api/admin/badges', admin)).json.log.filter((e) => e.accountId === p.id).map((e) => e.type);
  assert.deepEqual(log, ['revoked', 'granted']);
});

async function upload(id, body, { permission = true, type = 'image/png' } = {}) {
  const res = await fetch(`${t.base}/api/admin/badges/${id}/mark${permission ? '?permission=confirmed' : ''}`, {
    method: 'POST', headers: { ...admin, Origin: ORIGIN, 'Content-Type': type, 'CF-Connecting-IP': '203.0.113.202' }, body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('partner marks: PNG/WebP only (never SVG), permission confirmed, re-encoded without metadata; Pro Team badges can’t be granted before a saved mark', async () => {
  const a = t.client({ ip: '203.0.113.203' });
  const made = await a.post('/api/admin/badges/definitions', { template: 'partner-pro', id: 'fixture-team-partner', name: 'Fixture Team Partner', description: 'A fixture team.' }, admin);
  assert.equal(made.status, 200);
  const p = await newPlayer('teamfixture');
  assert.equal((await admin_grant(p.id, 'fixture-team-partner', 'Partnership signed (fixture)')).json.code, 'needs_mark');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await upload('fixture-team-partner', svg, { type: 'image/svg+xml' })).status, 415);
  assert.equal((await upload('fixture-team-partner', svg, { type: 'image/png' })).status, 415, 'the bytes decide, not the header');
  const png = await sharp({ create: { width: 300, height: 260, channels: 4, background: { r: 10, g: 120, b: 140, alpha: 1 } } })
    .png().withMetadata({ exif: { IFD0: { Copyright: 'FixtureSecretMetadata' } } }).toBuffer();
  assert.ok(png.includes('FixtureSecretMetadata'));
  assert.equal((await upload('fixture-team-partner', png, { permission: false })).json.code, 'permission_required');
  const tiny = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.equal((await upload('fixture-team-partner', tiny)).json.code, 'too_small');
  const up = await upload('fixture-team-partner', png);
  assert.equal(up.status, 200);
  assert.match(up.json.preview, /^data:image\/png;base64,/);
  // Not live until saved with a reason and the preview box ticked.
  assert.equal((await admin_grant(p.id, 'fixture-team-partner', 'x')).json.code, 'needs_mark');
  assert.equal((await a.post('/api/admin/badges/fixture-team-partner/mark/save', { reason: 'Signed', previewChecked: false }, admin)).json.code, 'preview_required');
  const saved = await a.post('/api/admin/badges/fixture-team-partner/mark/save', { reason: 'Signed agreement (fixture)', previewChecked: true }, admin);
  assert.equal(saved.status, 200);
  const served = await fetch(`${t.base}${saved.json.mark}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await served.arrayBuffer());
  assert.ok(!bytes.includes('FixtureSecretMetadata'), 'metadata is stripped');
  const meta = await sharp(bytes).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.exif], ['png', 256, 256, undefined]);
  assert.equal((await admin_grant(p.id, 'fixture-team-partner', 'Partnership signed (fixture)')).status, 200);
});

test('badge detail: holders listed only for automatic badges and only where public; granted badges show a count only', async () => {
  const pub = await t.client().get('/api/badges/beta-tester');
  assert.equal(pub.status, 200);
  assert.ok(pub.json.heldBy >= 1);
  assert.ok(Array.isArray(pub.json.holders.list));
  const dev = await t.client().get('/api/badges/dev-team');
  assert.equal(dev.json.holders, null);
  // Early Supporter with no window shows nowhere.
  assert.equal((await t.client().get('/api/badges/early-supporter')).status, 404);
});

test('Early Supporter: unset → nowhere; a window → earned by accounts made inside it; closed → "No longer available"', async () => {
  const { setSetting } = await import('../admin/settings.js');
  const p = await newPlayer('earlyfixture');
  let s = (await p.c.get('/api/account/badges')).json;
  assert.ok(![...s.earned, ...s.earnable, ...s.unavailable].some((b) => b.id === 'early-supporter'));
  const today = new Date().toISOString().slice(0, 10);
  await setSetting(t.db, 'badges.earlySupporter', { start: '2020-01-01', end: today });
  const { evaluateAccount } = await import('../badges/rules.js');
  await evaluateAccount(t.db, p.id);
  assert.ok((await held(p.id)).includes('early-supporter'));
  await setSetting(t.db, 'badges.earlySupporter', { start: '2020-01-01', end: '2020-01-02' });
  const late = await newPlayer('latefixture');
  s = (await late.c.get('/api/account/badges')).json;
  assert.ok(s.unavailable.some((b) => b.id === 'early-supporter'));
  assert.ok(!s.earnable.some((b) => b.id === 'early-supporter'));
  await setSetting(t.db, 'badges.earlySupporter', null);
});

test('the back-fill runs once, gives no toasts, and records its counts', async () => {
  const { backfillOnce } = await import('../badges/rules.js');
  const p = await newPlayer(null);
  await t.db.query('DELETE FROM badge_awards WHERE account_id = $1', [p.id]);
  await addCharacter(p.id, { cls: 'Druid', faction: 'Alliance' });
  const counts = await backfillOnce(t.db);
  assert.ok(counts.earned['class-druid'] >= 1);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM badge_awards WHERE account_id = $1 AND toast IS NOT NULL', [p.id])).n, 0);
  assert.equal(await backfillOnce(t.db), null, 'once');
  const ev = await t.db.one("SELECT detail FROM badge_events WHERE type = 'backfill'");
  assert.ok(ev.detail.accounts >= 1);
});

test('a merge moves badges to the kept account (earlier date wins) without touching its display choices', async () => {
  const { mergeAccounts } = await import('../account/merge.js');
  const src = await newPlayer(null);
  const dst = await newPlayer(null);
  await admin_grant(src.id, 'moderator', 'Fixture moderator');
  await t.db.tx((q) => mergeAccounts(q, src.id, dst.id));
  assert.deepEqual(await held(dst.id), ['beta-tester', 'moderator']);
  const m = await t.db.one("SELECT featured, pinned FROM badge_awards WHERE account_id = $1 AND badge_id = 'moderator'", [dst.id]);
  assert.deepEqual(m, { featured: false, pinned: false });
});
