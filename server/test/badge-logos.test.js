import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { ORIGIN, startApp } from './helpers.js';

// Badge logos (0.10.4): Pro Team, Platform Employee and Community Partner badges. Fixture names and made-up ids only;
// nothing here reaches Blizzard or Discord.
let t;
let admin;
let discordUser = 9500;
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
});
after(() => t.close());

let ip = 10;
async function newPlayer(username) {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  if (username) await c.put('/api/account/username', { username });
  const id = (await c.get('/api/account')).json.account.id;
  return { c, id };
}

const NOTE = { grantedBy: 'Fixture Person, partner lead', grantedAt: '2026-11-01', how: 'Email from the fixture partner, Nov 2026' };
let uploadIp = 1;
async function upload(id, body, { note = NOTE, type = 'image/png', headers = admin } = {}) {
  const qs = new URLSearchParams(Object.entries(note).filter(([, v]) => v !== undefined));
  const res = await fetch(`${t.base}/api/admin/badges/${id}/logo?${qs}`, {
    method: 'POST', headers: { ...headers, Origin: ORIGIN, 'Content-Type': type, 'CF-Connecting-IP': `203.0.113.${uploadIp++}` }, body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const a = () => t.client({ ip: '192.0.2.77' });
const save = (id, extra = {}) => a().post(`/api/admin/badges/${id}/logo/save`, { ...NOTE, reason: 'Partnership signed (fixture)', previewChecked: true, ...extra }, admin);
const grant = (accountId, badgeId) => a().post(`/api/admin/badges/accounts/${accountId}/grant`, { badgeId, reason: 'Fixture grant' }, admin);
const make = (body) => a().post('/api/admin/badges/definitions', body, admin);

const solid = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } });
/** A PNG with a tEXt chunk (inserted before IEND) and EXIF: the logo must come out with neither. */
async function pngWithMetadata() {
  const png = await solid(300, 260).png().withMetadata({ exif: { IFD0: { Copyright: 'FixtureSecretExif' } } }).toBuffer();
  const data = Buffer.from('Comment\0FixtureSecretText', 'latin1');
  const type = Buffer.from('tEXt', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)]);
}

test('a Community Partner badge is made from its template (never seeded); it shows its own art until a logo is saved', async () => {
  assert.equal((await t.db.query("SELECT id FROM badge_definitions WHERE template = 'partner-community' LIMIT 5")).length, 0, 'none seeded');
  const made = await make({ template: 'partner-community', id: 'fixture-site-partner', name: 'Fixture Site', description: 'A fixture partner site.' });
  assert.equal(made.status, 200);
  const list = (await a().get('/api/admin/badges', admin)).json;
  const d = list.definitions.find((x) => x.id === 'fixture-site-partner');
  assert.deepEqual([d.family, d.template, d.art, d.takesLogo, d.logo, d.grantable], ['partner', 'partner-community', 'partner/community-partner', true, null, true]);
  assert.ok(list.templates.some((x) => x.id === 'partner-community'));
  // The seeded Platform Employee badges take one too; the generic Community Partner badge doesn't.
  assert.equal(list.definitions.find((x) => x.id === 'blizzard-employee').takesLogo, true);
  assert.equal(list.definitions.find((x) => x.id === 'community-partner').takesLogo, false);
  assert.equal((await upload('community-partner', await solid(200, 200).png().toBuffer())).status, 404);
});

test('logos: content decides (SVG and JPEG refused, a PNG under another name accepted), 512 KB and 128 px limits, permission note required', async () => {
  await make({ template: 'partner-pro', id: 'fixture-pro-team', name: 'Fixture Pro Team', description: 'A fixture team.' });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await upload('fixture-pro-team', svg, { type: 'image/svg+xml' })).status, 415);
  assert.equal((await upload('fixture-pro-team', svg, { type: 'image/png' })).json.code, 'wrong_type', 'an SVG renamed .png is still an SVG');
  const jpeg = await solid(300, 300).jpeg().toBuffer();
  assert.equal((await upload('fixture-pro-team', jpeg, { type: 'image/jpeg' })).json.code, 'wrong_type');
  // WebP magic bytes in front of something that is not a WebP: the decoder refuses it.
  const fake = Buffer.concat([Buffer.from('RIFF0000WEBP', 'latin1'), await solid(200, 200).png().toBuffer()]);
  assert.equal((await upload('fixture-pro-team', fake)).json.code, 'unreadable');
  assert.equal((await upload('fixture-pro-team', await solid(200, 200).png().toBuffer(), { type: 'image/jpeg' })).status, 200, 'a PNG named as a JPEG is accepted');
  assert.equal((await upload('fixture-pro-team', await solid(200, 200).webp().toBuffer(), { type: 'application/octet-stream' })).status, 200, 'WebP too');
  assert.equal((await upload('fixture-pro-team', await solid(127, 300).png().toBuffer())).json.code, 'too_small');
  const noise = await sharp(randomBytes(460 * 460 * 4), { raw: { width: 460, height: 460, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(noise.length > 512 * 1024 && noise.length < 1024 * 1024, `fixture is ${noise.length} bytes`);
  const big = await upload('fixture-pro-team', noise);
  assert.deepEqual([big.status, big.json.code], [413, 'too_large']);
  // Each of the three permission fields is required, server-side.
  const ok = await solid(200, 200).png().toBuffer();
  for (const k of ['grantedBy', 'grantedAt', 'how']) {
    assert.equal((await upload('fixture-pro-team', ok, { note: { ...NOTE, [k]: undefined } })).json.code, 'permission_required', k);
  }
  assert.equal((await upload('fixture-pro-team', ok, { note: { ...NOTE, grantedAt: '2999-01-01' } })).json.code, 'invalid', 'not in the future');
  // Not an admin: a plain 404, for the upload, the save and the remove alike.
  const p = await newPlayer('logonobody');
  const asPlayer = await upload('fixture-pro-team', ok, { headers: { Cookie: [...p.c.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(asPlayer.status, 404);
  assert.equal((await p.c.post('/api/admin/badges/fixture-pro-team/logo/save', { ...NOTE, reason: 'x', previewChecked: true })).status, 404);
  assert.equal((await p.c.del('/api/admin/badges/fixture-pro-team/logo', undefined, { reason: 'x' })).status, 404);
});

test('logos: re-encoded at 64/128/256 with no metadata; save needs the note and logs it in the audit log; replace; remove → default art, holders keep the badge', async () => {
  await make({ template: 'partner-pro', id: 'fixture-pro-two', name: 'Fixture Pro Two', description: 'Another fixture team.' });
  const p = await newPlayer('logoholder');
  assert.equal((await grant(p.id, 'fixture-pro-two')).json.code, 'needs_logo');
  const src = await pngWithMetadata();
  assert.ok(src.includes('FixtureSecretText') && src.includes('FixtureSecretExif'));
  const up = await upload('fixture-pro-two', src);
  assert.equal(up.status, 200);
  for (const px of [64, 128, 256]) {
    const bytes = Buffer.from(up.json.preview[px].split(',')[1], 'base64');
    const m = await sharp(bytes).metadata();
    assert.deepEqual([m.format, m.width, m.height, m.exif, m.comments ?? []], ['png', px, px, undefined, []], `preview ${px}`);
    assert.ok(!bytes.includes('FixtureSecret'));
  }
  // Not live until saved: the badge still has no logo, and save refuses without the note, a reason or the preview tick.
  assert.equal((await a().get('/api/badges/fixture-pro-two')).json.badge.logo, null);
  assert.equal((await save('fixture-pro-two', { how: '' })).json.code, 'permission_required');
  assert.equal((await save('fixture-pro-two', { reason: '' })).json.code, 'reason_required');
  assert.equal((await save('fixture-pro-two', { previewChecked: false })).json.code, 'preview_required');
  const saved = await save('fixture-pro-two', { backing: 'plate' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.logo.backing, 'plate');
  for (const px of [64, 128, 256]) {
    const res = await fetch(`${t.base}${saved.json.logo.srcs[px]}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('cache-control'), /max-age=/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(!bytes.includes('FixtureSecret'), 'metadata stripped');
    const m = await sharp(bytes).metadata();
    assert.deepEqual([m.width, m.height], [px, px]);
  }
  assert.equal((await fetch(`${t.base}/api/badges/fixture-pro-two/logo/100.png`)).status, 404);
  // The public view has the logo but never the permission note.
  const pub = (await a().get('/api/badges/fixture-pro-two')).json.badge;
  assert.ok(pub.logo.srcs[128]);
  assert.ok(!JSON.stringify(pub).includes('Fixture Person'));
  // The audit log: the badge, the note (who / when / how) and the reason; never image bytes.
  const ev = await t.db.one("SELECT detail FROM admin_events WHERE type = 'badge.logo_saved' AND detail->>'badge' = 'fixture-pro-two' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(ev.detail.permission, { by: NOTE.grantedBy, at: NOTE.grantedAt, how: NOTE.how });
  assert.equal(ev.detail.reason, 'Partnership signed (fixture)');
  assert.ok(JSON.stringify(ev.detail).length < 1000, 'no image in the log');
  const audit = (await a().get('/api/admin/audit?area=badges', admin)).json.entries.find((e) => e.action.startsWith('Badge logo saved: fixture-pro-two'));
  assert.ok(audit, 'shown in the audit log');
  assert.match(audit.action, /Fixture Person, partner lead, 2026-11-01, Email from the fixture partner/);
  assert.equal(audit.reason, 'Partnership signed (fixture)');
  // Now it can be granted.
  assert.equal((await grant(p.id, 'fixture-pro-two')).status, 200);

  // Replace: a new upload + save swaps it; the audit row records the previous note as "before".
  const up2 = await upload('fixture-pro-two', await solid(400, 200).png().toBuffer(), { note: { ...NOTE, grantedBy: 'Second Person' } });
  assert.equal(up2.status, 200);
  const re = await save('fixture-pro-two', { grantedBy: 'Second Person' });
  assert.equal(re.json.replaced, true);
  assert.notEqual(re.json.logo.srcs[256], saved.json.logo.srcs[256]);
  const ev2 = await t.db.one("SELECT detail FROM admin_events WHERE type = 'badge.logo_saved' AND detail->>'badge' = 'fixture-pro-two' ORDER BY id DESC LIMIT 1");
  assert.equal(ev2.detail.permission.by, 'Second Person');
  assert.match(ev2.detail.before, /^Fixture Person/);
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM badge_logos WHERE badge_id = 'fixture-pro-two'")).n, 1);

  // Remove: needs a reason; the badge shows its default art again; the holder keeps it.
  assert.equal((await a().del('/api/admin/badges/fixture-pro-two/logo', admin, { reason: '' })).json.code, 'reason_required');
  const rm = await a().del('/api/admin/badges/fixture-pro-two/logo', admin, { reason: 'Partnership ended (fixture)' });
  assert.equal(rm.status, 200);
  const after2 = (await a().get('/api/badges/fixture-pro-two')).json.badge;
  assert.deepEqual([after2.logo, after2.art], [null, 'templates/partner-pro']);
  assert.equal((await fetch(`${t.base}${re.json.logo.srcs[256]}`)).status, 404);
  assert.equal((await t.db.one("SELECT state FROM badge_awards WHERE account_id = $1 AND badge_id = 'fixture-pro-two'", [p.id])).state, 'held');
  assert.ok((await t.db.one("SELECT 1 AS x FROM admin_events WHERE type = 'badge.logo_removed' AND detail->>'reason' = 'Partnership ended (fixture)'")));
  const types = (await t.db.query("SELECT type FROM badge_events WHERE badge_id = 'fixture-pro-two' AND type LIKE 'logo%' ORDER BY id")).map((r) => r.type);
  assert.deepEqual(types, ['logo_uploaded', 'logo_saved', 'logo_uploaded', 'logo_replaced', 'logo_removed']);
  assert.equal((await a().del('/api/admin/badges/fixture-pro-two/logo', admin, { reason: 'again' })).json.code, 'no_logo');
});

test('Cancel discards a staged upload; a Platform Employee logo falls back to its monogram when removed', async () => {
  assert.equal((await upload('discord-employee', await solid(256, 256).png().toBuffer())).status, 200);
  assert.ok(await t.db.one("SELECT 1 AS x FROM badge_logos WHERE badge_id = 'discord-employee' AND stage = 'pending'"));
  assert.equal((await a().del('/api/admin/badges/discord-employee/logo/pending', admin)).status, 200);
  assert.equal(await t.db.one("SELECT 1 AS x FROM badge_logos WHERE badge_id = 'discord-employee'"), null);
  assert.equal((await save('discord-employee')).json.code, 'no_upload');
  await upload('discord-employee', await solid(256, 256).png().toBuffer());
  assert.equal((await save('discord-employee')).status, 200);
  assert.ok((await a().get('/api/badges/discord-employee')).json.badge.logo);
  await a().del('/api/admin/badges/discord-employee/logo', admin, { reason: 'Fixture removal' });
  const b = (await a().get('/api/badges/discord-employee')).json.badge;
  assert.deepEqual([b.logo, b.monogram], [null, 'D']);
});

test('share cards draw the logo inside the frame only (no template glyph) from our own PNG', async () => {
  const { playerBadgeSvg } = await import('../cards/badgeSvg.js');
  const png = await solid(64, 64).png().toBuffer();
  const svg = playerBadgeSvg({ art: 'partner/blizzard-employee', monogram: 'B', logo: { backing: 'none' } }, { logo: png });
  assert.match(svg, /<image href="data:image\/png;base64,/);
  assert.ok(!svg.includes('>B</text>'), 'the monogram gives way to the logo');
  assert.equal((svg.match(/<path /g) ?? []).length, 4, 'the frame: rim, fill, metal ring, inner ring');
  const plain = playerBadgeSvg({ art: 'partner/blizzard-employee', monogram: 'B', logo: null });
  assert.ok(plain.includes('>B</text>'));
});

test('migration 031: a 0.7.0 partner mark becomes a saved logo whose permission note says it wasn’t recorded (never invented)', async () => {
  const mark = await solid(256, 256).png().toBuffer();
  await t.db.query(
    `INSERT INTO badge_definitions (id, family, name, description, how, art, template, award, verified, sort, created_by, mark, mark_sha, mark_set_at)
     VALUES ('fixture-old-team', 'partner', 'Fixture Old Team', 'Old.', 'Old.', 'templates/partner-pro', 'partner-pro', 'manual', true, 140, 'admin', $1, 'x', now())`,
    [mark],
  );
  // Re-run the migration's body against the current schema (its table first dropped), as a 0.10.3 database would.
  const { migrations } = await import('../core/schema.js');
  await t.db.query('DROP TABLE badge_logos');
  await t.db.tx((q) => migrations.find((m) => m.id === '031_badge_logos').up(q));
  const row = await t.db.one("SELECT stage, permission_by, permission_at, permission_how, png_64, png_256 FROM badge_logos WHERE badge_id = 'fixture-old-team'");
  assert.equal(row.stage, 'saved');
  for (const k of ['permission_by', 'permission_at', 'permission_how']) assert.equal(row[k], 'not recorded (uploaded before 0.10.4)');
  assert.deepEqual([(await sharp(row.png_64).metadata()).width, (await sharp(row.png_256).metadata()).width], [64, 256]);
  assert.equal((await t.db.one("SELECT mark FROM badge_definitions WHERE id = 'fixture-old-team'")).mark, null, 'moved, not copied');
  assert.ok((await t.client().get('/api/badges/fixture-old-team')).json.badge.logo.srcs[256]);
  assert.ok(await t.db.one("SELECT 1 AS x FROM badge_events WHERE type = 'logo_carried_over' AND badge_id = 'fixture-old-team'"));
});
