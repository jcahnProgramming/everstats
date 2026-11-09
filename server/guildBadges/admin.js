import express from 'express';
import { isProfaneText } from '../accounts/names.js';
import { MAX_BYTES, processMark } from '../badges/marks.js';
import { sha256 } from '../badges/store.js';
import { HttpError, route } from '../core/errors.js';
import { OVERALL_START } from '../stats/guildTotals.js';
import { DEEDS_TEMPLATE, FAMILIES, LEVELS } from './catalog.js';
import { allGuildIds, evaluateGuilds, statIdsByName } from './rules.js';
import {
  definitionId, earlyGuildWindow, guildAwards, guildDefinitionById, guildHolderCounts, loadGuildDefinitions, logGuildBadgeEvent, markUrl,
  publicGuildBadge,
} from './store.js';

/**
 * /api/admin/guild-badges… (0.7.1), mounted inside the admin router AFTER its gate: a plain 404 without an admin
 * session. Only STAFF badges (manual: Featured Guild, Partner Guild) can be granted or revoked here, each with a
 * reason, all logged in guild_badge_events. Automatic badges follow their rules. Thresholds are the admin's to change
 * (with a preview); lowering one unlocks levels at once, raising one never removes a level a guild holds.
 *
 * The design's admin mockup draws native <select>s, an "Admin" link in the top bar and "SVG preferred" for emblems:
 * the rules forbid all three (CLAUDE.md, and the owner's brief: PNG or WebP only), so none of them exist here.
 */
const REASON_MAX = 500;
const reasonOf = (raw) => {
  const r = String(raw ?? '').trim();
  if (!r) throw new HttpError(400, 'A reason is required: it is saved to the log.', 'reason_required');
  if (r.length > REASON_MAX) throw new HttpError(400, `A reason is up to ${REASON_MAX} characters.`, 'invalid');
  return r;
};
const guildIdOf = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};
const text = (raw, { label, min = 1, max }) => {
  const v = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (v.length < min || v.length > max) throw new HttpError(400, `${label}: ${min}–${max} characters.`, 'invalid');
  if (/[\p{Cc}\p{Cf}]/u.test(v)) throw new HttpError(400, `${label} has invisible or control characters in it.`, 'invalid');
  if (isProfaneText(v)) throw new HttpError(400, `${label} has a word in it that isn’t allowed.`, 'invalid');
  return v;
};
const dateOf = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const d = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new HttpError(400, 'A date is YYYY-MM-DD.', 'invalid');
  return d;
};
export function checkThresholds(raw) {
  if (!Array.isArray(raw) || raw.length !== 5 || !raw.every((x) => Number.isSafeInteger(x) && x >= 1 && x <= 1e12)) {
    throw new HttpError(400, 'Five whole numbers, one per level, each at least 1.', 'invalid');
  }
  for (let i = 1; i < 5; i++) if (raw[i] <= raw[i - 1]) throw new HttpError(400, `Level ${LEVELS[i].numeral} must need more than level ${LEVELS[i - 1].numeral}.`, 'invalid');
  return raw;
}

/** Every guild's current value for a levelled badge (members, or a statistic's total), for the preview. */
async function currentValues(db, def) {
  if (def.rule?.type === 'members') {
    return (await db.query("SELECT guild_id, members AS v FROM guild_populations WHERE period = 'overall' AND period_start = $1 LIMIT 100000", [OVERALL_START])).map((r) => Number(r.v));
  }
  const id = (await statIdsByName(db)).get(String(def.rule?.statistic ?? '').toLowerCase());
  if (id === undefined) return [];
  return (await db.query("SELECT total AS v FROM guild_totals WHERE period = 'overall' AND period_start = $1 AND statistic_id = $2 LIMIT 100000", [OVERALL_START, id])).map((r) => Number(r.v));
}

async function guildDetail(db, guildId) {
  const g = await db.one('SELECT id, slug, name, faction FROM guilds WHERE id = $1', [guildId]);
  const awards = await guildAwards(db, guildId, { states: ['held', 'lost', 'revoked'] });
  const mark = await db.one('SELECT mark_sha, mark_set_at, pending_at FROM guild_partner_marks WHERE guild_id = $1', [guildId]);
  return {
    id: guildId, slug: g?.slug ?? null, name: g?.name ?? null, faction: g?.faction ?? null,
    mark: mark?.mark_sha ? { url: markUrl(guildId, mark.mark_sha), setAt: mark.mark_set_at } : null,
    pendingMarkAt: mark?.pending_at ?? null,
    awards: awards.map((a) => ({
      ...publicGuildBadge(a, { level: a.level }), state: a.state, source: a.source, reason: a.reason, firstAt: a.first_at, levelAt: a.level_at,
      lostAt: a.lost_at, detail: a.detail,
    })),
  };
}

export function createAdminGuildBadgeRouter({ db, writes }) {
  const r = express.Router();
  // Re-evaluates every guild in the background after a threshold change (lowering unlocks at once). One at a time.
  let sweeping = null;
  const sweepSoon = () => {
    if (sweeping) return;
    sweeping = allGuildIds(db).then((ids) => evaluateGuilds(db, ids)).catch((err) => console.error(`[guild-badges] sweep failed: ${err.code ?? err.name}`)).finally(() => { sweeping = null; });
  };

  r.get('/guild-badges', route(async (req, res) => {
    const defs = await loadGuildDefinitions(db);
    const counts = await guildHolderCounts(db);
    const early = await earlyGuildWindow(db);
    const log = await db.query(
      `SELECT e.id, e.at, e.type, e.guild_id, e.badge_id, e.level, e.actor, e.reason, e.detail, g.name AS guild_name, g.slug AS guild_slug
         FROM guild_badge_events e LEFT JOIN guilds g ON g.id = e.guild_id
        WHERE e.actor IN ('admin', 'backfill') ORDER BY e.at DESC LIMIT 100`,
    );
    const backfill = await db.one("SELECT at, detail FROM guild_badge_events WHERE type = 'backfill' ORDER BY at DESC LIMIT 1");
    const marks = await db.query(
      'SELECT m.guild_id, m.mark_sha, m.mark_set_at, m.pending_at, g.name, g.slug FROM guild_partner_marks m LEFT JOIN guilds g ON g.id = m.guild_id ORDER BY m.guild_id LIMIT 200',
    );
    const { statistics } = await (await import('../stats/catalog.js')).loadCatalog(db);
    res.json({
      families: FAMILIES,
      template: DEEDS_TEMPLATE,
      early: early.set ? { start: early.start, end: early.end, closed: early.closed, upcoming: early.upcoming } : null,
      definitions: defs.map((d) => ({
        ...publicGuildBadge(d, { level: d.levelled ? 5 : null }), thresholds: d.thresholds, rule: d.rule, createdBy: d.created_by,
        heldBy: counts.total.get(d.id) ?? 0, byLevel: d.levelled ? [1, 2, 3, 4, 5].map((l) => counts.byLevel.get(`${d.id}:${l}`) ?? 0) : null,
        grantable: d.award === 'manual',
      })),
      statisticNames: [...statistics.values()].filter((s) => s.name).map((s) => s.name).sort((a, b) => a.localeCompare(b)).slice(0, 2000),
      backfill: backfill ? { at: backfill.at, guilds: backfill.detail.guilds ?? null, held: backfill.detail.held ?? [] } : null,
      marks: marks.map((m) => ({ guildId: Number(m.guild_id), name: m.name, slug: m.slug, url: markUrl(m.guild_id, m.mark_sha), setAt: m.mark_set_at, pendingAt: m.pending_at })),
      log: log.map((e) => ({
        id: e.id, at: e.at, type: e.type, badgeId: e.badge_id, level: e.level, actor: e.actor, reason: e.reason, detail: e.detail,
        guild: e.guild_id ? { id: Number(e.guild_id), name: e.guild_name, slug: e.guild_slug } : null,
      })),
    });
  }));

  r.get('/guild-badges/guilds', route(async (req, res) => {
    const q = String(req.query.q ?? '').normalize('NFC').trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return res.json({ guilds: [] });
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await db.query('SELECT id, slug, name, faction FROM guilds WHERE lower(name) LIKE $1 ORDER BY name LIMIT 20', [like]);
    res.json({ guilds: rows.map((g) => ({ id: Number(g.id), slug: g.slug, name: g.name, faction: g.faction })) });
  }));

  r.get('/guild-badges/guilds/:id', route(async (req, res) => res.json({ guild: await guildDetail(db, guildIdOf(req.params.id)) })));

  r.post('/guild-badges/guilds/:id/grant', writes, route(async (req, res) => {
    const guildId = guildIdOf(req.params.id);
    const reason = reasonOf(req.body?.reason);
    const def = await guildDefinitionById(db, String(req.body?.badgeId ?? ''));
    if (!def) throw new HttpError(404, 'No such guild badge.');
    if (def.award !== 'manual') throw new HttpError(409, `${def.name} is automatic: it follows its rule and can’t be granted by hand.`, 'automatic');
    if (!(await db.one('SELECT id FROM guilds WHERE id = $1', [guildId]))) throw new HttpError(404, 'Everstats doesn’t know that guild.');
    const detail = {};
    if (def.id === 'featured-guild') {
      if (req.body?.label) detail.label = text(req.body.label, { label: 'Event label', max: 40 });
      const until = dateOf(req.body?.until);
      if (until) detail.until = until;
    }
    if (def.template === 'partner-guild' && !(await db.one('SELECT 1 AS x FROM guild_partner_marks WHERE guild_id = $1 AND mark_sha IS NOT NULL', [guildId]))) {
      throw new HttpError(409, 'Upload and save this guild’s emblem (with their written permission) before granting Partner Guild.', 'needs_mark');
    }
    await db.tx(async (q) => {
      const cur = await q.one('SELECT state FROM guild_badge_awards WHERE guild_id = $1 AND badge_id = $2 FOR UPDATE', [guildId, def.id]);
      if (cur?.state === 'held') throw new HttpError(409, 'That guild already has this badge.', 'already');
      if (cur) {
        await q.query(
          `UPDATE guild_badge_awards SET state = 'held', source = 'admin', reason = $3, detail = $4::jsonb, held_since = now(), level_at = now(),
                  lost_at = NULL, ribbon_at = now() WHERE guild_id = $1 AND badge_id = $2`,
          [guildId, def.id, reason, JSON.stringify(detail)],
        );
      } else {
        await q.query(
          `INSERT INTO guild_badge_awards (guild_id, badge_id, source, reason, detail, ribbon_at) VALUES ($1, $2, 'admin', $3, $4::jsonb, now())`,
          [guildId, def.id, reason, JSON.stringify(detail)],
        );
      }
      await logGuildBadgeEvent(q, { type: 'granted', guildId, badgeId: def.id, actor: 'admin', notify: true, reason, detail });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_badge.granted', $1::jsonb)", [JSON.stringify({ guild: guildId, badge: def.id })]);
    });
    res.json({ guild: await guildDetail(db, guildId) });
  }));

  r.post('/guild-badges/guilds/:id/revoke', writes, route(async (req, res) => {
    const guildId = guildIdOf(req.params.id);
    const reason = reasonOf(req.body?.reason);
    const def = await guildDefinitionById(db, String(req.body?.badgeId ?? ''));
    if (!def) throw new HttpError(404, 'No such guild badge.');
    if (def.award !== 'manual') throw new HttpError(409, `${def.name} is automatic: it follows its rule and can’t be revoked by hand.`, 'automatic');
    await db.tx(async (q) => {
      const rows = await q.query("UPDATE guild_badge_awards SET state = 'revoked', lost_at = now(), pinned = false WHERE guild_id = $1 AND badge_id = $2 AND state = 'held' RETURNING 1", [guildId, def.id]);
      if (!rows.length) throw new HttpError(409, 'That guild doesn’t hold this badge.', 'not_held');
      await logGuildBadgeEvent(q, { type: 'revoked', guildId, badgeId: def.id, actor: 'admin', reason });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_badge.revoked', $1::jsonb)", [JSON.stringify({ guild: guildId, badge: def.id })]);
    });
    res.json({ guild: await guildDetail(db, guildId) });
  }));

  // ---- Thresholds: the preview counts guilds by their CURRENT values; a guild above a level now keeps it either way.
  r.post('/guild-badges/:id/thresholds/preview', writes, route(async (req, res) => {
    const def = await guildDefinitionById(db, String(req.params.id));
    if (!def?.levelled) throw new HttpError(404, 'Only levelled badges have thresholds.');
    const thresholds = checkThresholds(req.body?.thresholds);
    const values = await currentValues(db, def);
    const counts = await guildHolderCounts(db);
    res.json({
      wouldReach: thresholds.map((t) => values.filter((v) => v >= t).length),
      holdNow: [1, 2, 3, 4, 5].map((l) => counts.byLevel.get(`${def.id}:${l}`) ?? 0),
      measuredGuilds: values.length,
    });
  }));

  r.put('/guild-badges/:id/thresholds', writes, route(async (req, res) => {
    const def = await guildDefinitionById(db, String(req.params.id));
    if (!def?.levelled) throw new HttpError(404, 'Only levelled badges have thresholds.');
    const thresholds = checkThresholds(req.body?.thresholds);
    const reason = reasonOf(req.body?.reason);
    await db.tx(async (q) => {
      await q.query('UPDATE guild_badge_definitions SET thresholds = $2::bigint[] WHERE id = $1', [def.id, thresholds]);
      await logGuildBadgeEvent(q, { type: 'thresholds', badgeId: def.id, actor: 'admin', reason, detail: { from: def.thresholds, to: thresholds } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_badge.thresholds', $1::jsonb)", [JSON.stringify({ badge: def.id, to: thresholds })]);
    });
    sweepSoon();
    res.json({ ok: true, thresholds });
  }));

  // ---- A new collective-statistic badge from the Deeds template (no code change).
  r.post('/guild-badges/definitions', writes, route(async (req, res) => {
    const id = definitionId(req.body?.id);
    const name = text(req.body?.name, { label: 'Name', max: 40 });
    const statistic = text(req.body?.statistic, { label: 'Statistic', max: 120 });
    const measure = text(req.body?.measure ?? statistic.toLowerCase(), { label: 'Measure', max: 40 });
    const thresholds = checkThresholds(req.body?.thresholds);
    if (!(await statIdsByName(db)).has(statistic.toLowerCase())) throw new HttpError(400, `There’s no statistic called “${statistic}” in the catalog.`, 'invalid');
    const description = `${statistic}, together.`;
    const how = `${statistic}, combined across current tracked members.`.slice(0, 200);
    await db.tx(async (q) => {
      if (await q.one('SELECT 1 AS x FROM guild_badge_definitions WHERE id = $1', [id])) throw new HttpError(409, 'A guild badge with that id already exists.', 'exists');
      await q.query(
        `INSERT INTO guild_badge_definitions (id, family, name, description, how, art, template, levelled, measure, thresholds, award, rule, sort, created_by)
         VALUES ($1, 'deeds', $2, $3, $4, $5, 'deeds-template', true, $6, $7::bigint[], 'automatic', $8::jsonb, 290, 'admin')`,
        [id, name, description, how, DEEDS_TEMPLATE.art, measure, thresholds, JSON.stringify({ type: 'stat-total', statistic })],
      );
      await logGuildBadgeEvent(q, { type: 'created', badgeId: id, actor: 'admin', detail: { template: DEEDS_TEMPLATE.id, statistic } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_badge.created', $1::jsonb)", [JSON.stringify({ badge: id })]);
    });
    sweepSoon();
    res.json({ ok: true, id });
  }));

  // ---- Partner guild emblems: upload (written-permission box) → three-theme preview → save (reason + "checked").
  r.post('/guild-badges/guilds/:id/mark', writes, express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), route(async (req, res) => {
    if (req.query.permission !== 'confirmed') throw new HttpError(400, 'Confirm that the guild has given written permission to use this emblem.', 'permission_required');
    const guildId = guildIdOf(req.params.id);
    if (!(await db.one('SELECT id FROM guilds WHERE id = $1', [guildId]))) throw new HttpError(404, 'Everstats doesn’t know that guild.');
    const png = await processMark(Buffer.isBuffer(req.body) ? req.body : null);
    const sha = sha256(png);
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO guild_partner_marks (guild_id, pending, pending_sha, pending_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (guild_id) DO UPDATE SET pending = EXCLUDED.pending, pending_sha = EXCLUDED.pending_sha, pending_at = now()`,
        [guildId, png, sha],
      );
      await logGuildBadgeEvent(q, { type: 'mark_uploaded', guildId, badgeId: 'partner-guild', actor: 'admin', detail: { bytes: png.length, permissionConfirmed: true } });
    });
    res.json({ preview: `data:image/png;base64,${png.toString('base64')}`, bytes: png.length });
  }));

  r.post('/guild-badges/guilds/:id/mark/save', writes, route(async (req, res) => {
    const guildId = guildIdOf(req.params.id);
    const reason = reasonOf(req.body?.reason);
    if (req.body?.previewChecked !== true) throw new HttpError(400, 'Tick “Checked in all three themes” first.', 'preview_required');
    await db.tx(async (q) => {
      const rows = await q.query(
        `UPDATE guild_partner_marks SET mark = pending, mark_sha = pending_sha, mark_set_at = now(), pending = NULL, pending_sha = NULL, pending_at = NULL
          WHERE guild_id = $1 AND pending IS NOT NULL RETURNING mark_sha`,
        [guildId],
      );
      if (!rows.length) throw new HttpError(409, 'Upload an emblem first.', 'no_upload');
      await logGuildBadgeEvent(q, { type: 'mark_saved', guildId, badgeId: 'partner-guild', actor: 'admin', reason });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_badge.mark_saved', $1::jsonb)", [JSON.stringify({ guild: guildId })]);
    });
    res.json({ guild: await guildDetail(db, guildId) });
  }));

  r.delete('/guild-badges/guilds/:id/mark/pending', writes, route(async (req, res) => {
    await db.query('UPDATE guild_partner_marks SET pending = NULL, pending_sha = NULL, pending_at = NULL WHERE guild_id = $1', [guildIdOf(req.params.id)]);
    res.json({ ok: true });
  }));

  return r;
}
