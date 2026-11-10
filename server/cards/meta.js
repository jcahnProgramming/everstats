import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../core/config.js';
import { parseGuildSlug, parseSlug } from '../stats/slug.js';
import { loadCatalog } from '../stats/catalog.js';
import { ogPath } from './routes.js';
import { LAYOUT_VERSION } from './render.js';
import { pageTitleFor } from '../core/pageTitles.js';
import { displayName } from '../stats/names.js';

/**
 * Link previews (0.8.0). Discord, Reddit and X read Open Graph / Twitter tags from the HTML and never run our
 * JavaScript, so the server writes them into index.html for the pages that have a card:
 *
 *   /c/{slug}            the character card       /c/{slug}/share         the same
 *   /c/{slug}/tier/share the tier card            /g/{slug}, /g/{slug}/share   the guild card
 *   /leaderboards/{ruleset}/{statistic}[/share]   the board card (?c= / ?g= the shared placement; else the board's #1)
 *   /leaderboards/guilds/{ruleset}/{statistic}[/share]?g=
 *
 * The image is the wide card: the saved default, or the README's defaults (cards/store.js previewOptions). A hidden
 * character (or one Everstats doesn't have) gets the plain Everstats preview: generic text and NO image. Every other
 * page gets the plain preview too. Values are HTML-escaped; nothing here is user text except Blizzard's names.
 * The image URL carries ?v= (the day and the saved default's time) so a preview cache refetches when the card changes;
 * it is a cache key, not a tracking parameter.
 */
const SITE = { title: 'Everstats', description: 'WoW Forever character statistics, leaderboards and tiers.' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function version(db, kind, id) {
  const saved = id ? await db.one('SELECT saved_at FROM share_card_defaults WHERE kind = $1 AND subject_id = $2 AND NOT everstats_banned(saved_by)', [kind, id]) : null;
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${day}|${saved?.saved_at?.toISOString?.() ?? ''}|layout ${LAYOUT_VERSION}`).digest('base64url').slice(0, 10);
}

async function characterMeta(db, slug, kind) {
  const p = parseSlug(slug);
  if (!p) return null;
  const row = await db.one(
    `SELECT c.id, c.slug, c.name, c.surname, c.level, c.race, c.class, c.hidden, c.missing_since, c.profile_state, c.stats_fetched_at, r.name AS ruleset, t.letter
       FROM characters c LEFT JOIN rulesets r ON r.id = c.ruleset_id LEFT JOIN character_tiers t ON t.character_id = c.id WHERE c.slug = $1`,
    [p.slug],
  );
  if (!row || row.hidden || row.missing_since || row.profile_state !== 'ok') return null;
  const line = [row.level !== null ? `Level ${row.level}` : null, row.race, row.class].filter(Boolean).join(' ');
  if (kind === 'collections') {
    const has = (await db.one('SELECT collections_fetched_at FROM characters WHERE id = $1', [row.id]))?.collections_fetched_at;
    return { title: `${row.name} ${row.surname}: collections`, description: 'Mounts, pets, toys, titles, achievements, reputations and the transmog tracker on Everstats.', image: has ? `${ogPath(kind, { c: row.slug })}?v=${await version(db, kind, row.id)}` : null };
  }
  const title = kind === 'tier' ? `${row.name} ${row.surname}: ${row.letter ? `tier ${row.letter}` : 'Unranked'}${row.ruleset ? ` on ${row.ruleset}` : ''}` : `${row.name} ${row.surname}`;
  const description = kind === 'tier'
    ? `The overall tier and every category letter on Everstats${row.ruleset ? `, graded against ${row.ruleset}` : ''}.`
    : `${line}${row.ruleset ? ` on ${row.ruleset}` : ''}${row.letter ? `, tier ${row.letter}` : ''}. Statistics, ranks and gear on Everstats.`;
  if (!row.stats_fetched_at) return { title, description, image: null };
  return { title, description, image: `${ogPath(kind, { c: row.slug })}?v=${await version(db, kind, row.id)}` };
}

async function guildMeta(db, slug) {
  const s = parseGuildSlug(slug);
  if (!s) return null;
  const g = await db.one('SELECT g.id, g.slug, g.name, r.name AS ruleset FROM guilds g LEFT JOIN rulesets r ON r.id = g.ruleset_id WHERE g.slug = $1 ORDER BY g.updated_at DESC LIMIT 1', [s]);
  if (!g) return null;
  return {
    title: `<${g.name}>${g.ruleset ? ` on ${g.ruleset}` : ''}`,
    description: 'Roster, totals, guild badges and guild boards on Everstats.',
    image: `${ogPath('guild', { g: g.slug })}?v=${await version(db, 'guild', g.id)}`,
  };
}

async function boardMeta(db, { rulesetId, statisticId, guilds, query }) {
  const rs = await db.one('SELECT name FROM rulesets WHERE id = $1', [rulesetId]);
  const found = (await loadCatalog(db)).statistics.get(statisticId);
  if (!rs || !found?.name) return null;
  // 0.9.2: the name as pages show it (stats/names.js), so the tab and the preview say the same thing.
  const stat = { ...found, name: displayName(found.name) };
  const period = ['week', 'rolling'].includes(query.period) ? query.period : 'overall';
  const p = { rulesetId, statisticId, period, mode: query.mode === 'average' ? 'average' : 'total' };
  if (guilds) {
    const g = parseGuildSlug(String(query.g ?? ''));
    return { title: `${stat.name}: guild board on ${rs.name}`, description: `Every guild on ${rs.name} ranked by ${stat.name}, on Everstats.`, image: g ? `${ogPath('board', { ...p, g })}&v=${await version(db, 'board', null)}` : null };
  }
  const c = query.c !== undefined ? parseSlug(String(query.c)) : null;
  if (c) {
    const row = await db.one('SELECT hidden FROM characters WHERE slug = $1', [c.slug]);
    if (!row || row.hidden) return { title: `${stat.name} on ${rs.name}`, description: SITE.description, image: null };
  }
  const path = ogPath('board', { ...p, c: c?.slug ?? null });
  return { title: `${stat.name} on ${rs.name}`, description: `The ${stat.name} leaderboard on ${rs.name}, on Everstats.`, image: `${path}${path.includes('?') ? '&' : '?'}v=${await version(db, 'board', null)}` };
}

/** The preview for a page path → { title, description, image (path) | null } (SITE when nothing specific). */
export async function linkPreviewFor(db, pathname, query) {
  let m;
  try {
    if ((m = /^[/]c[/]([^/]+)[/]tier[/]share[/]?$/.exec(pathname))) return (await characterMeta(db, decodeURIComponent(m[1]), 'tier')) ?? SITE;
    // 0.9.0: the Collections tab and its screens, and its card maker: the Collections card (wide).
    if ((m = /^[/]c[/]([^/]+)[/]collections(?:[/][a-z-]+)?[/]?$/.exec(pathname))) return (await characterMeta(db, decodeURIComponent(m[1]), 'collections')) ?? SITE;
    if ((m = /^[/]c[/]([^/]+)(?:[/]share)?[/]?$/.exec(pathname))) return (await characterMeta(db, decodeURIComponent(m[1]), 'character')) ?? SITE;
    if ((m = /^[/]g[/]([^/]+)(?:[/]share)?[/]?$/.exec(pathname))) return (await guildMeta(db, decodeURIComponent(m[1]))) ?? SITE;
    if ((m = /^[/]leaderboards[/]guilds[/]([0-9]+)[/]([0-9]+)(?:[/]share)?[/]?$/.exec(pathname))) return (await boardMeta(db, { rulesetId: Number(m[1]), statisticId: Number(m[2]), guilds: true, query })) ?? SITE;
    if ((m = /^[/]leaderboards[/]([0-9]+)[/]([0-9]+)(?:[/]share)?[/]?$/.exec(pathname))) return (await boardMeta(db, { rulesetId: Number(m[1]), statisticId: Number(m[2]), guilds: false, query })) ?? SITE;
    // 0.9.2: a public profile's title is its player's name ("Path (@path)"), as the page's own tab title.
    if ((m = /^[/]u[/]([^/]+)[/]?$/.exec(pathname))) return (await profileMeta(db, decodeURIComponent(m[1]))) ?? SITE;
  } catch {
    return SITE;
  }
  // 0.9.2: every other page: its title from the shared table (core/pageTitles.js), the plain description, no image.
  const title = pageTitleFor(pathname);
  return title ? { ...SITE, title } : SITE;
}

async function profileMeta(db, username) {
  if (!/^[a-z0-9_-]{3,20}$/i.test(username)) return null;
  const a = await db.one('SELECT username, display_name FROM accounts WHERE username = lower($1) AND username_claimed AND NOT everstats_banned(id)', [username]);
  if (!a) return null;
  return { title: `${a.display_name ?? a.username} (@${a.username})`, description: `${a.display_name ?? a.username}'s Everstats profile: characters, pinned statistics and badges.`, image: null };
}

/** The tags for a preview, as HTML (for the head). */
export function previewTags(p, pageUrl) {
  const image = p.image ? `${config.publicOrigin}${p.image}` : null;
  const tags = [
    `<title>${esc(p.title === SITE.title ? SITE.title : `${p.title} · Everstats`)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    '<meta property="og:site_name" content="Everstats" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
  ];
  if (image) {
    tags.push(
      `<meta property="og:image" content="${esc(image)}" />`,
      '<meta property="og:image:type" content="image/png" />',
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      `<meta property="og:image:alt" content="${esc(`Everstats card: ${p.title}`)}" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:image" content="${esc(image)}" />`,
    );
  } else {
    tags.push('<meta name="twitter:card" content="summary" />');
  }
  tags.push(`<meta name="twitter:title" content="${esc(p.title)}" />`, `<meta name="twitter:description" content="${esc(p.description)}" />`);
  return tags.join('\n    ');
}

/** index.html with this page's preview tags in place of the static title and description. */
export function withPreview(html, p, pageUrl) {
  return html
    .replace(/<title>[^<]*<[/]title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', `  ${previewTags(p, pageUrl)}\n  </head>`);
}

/** Express handler for the SPA fallback: the built index.html, with this page's preview. */
export function spaWithPreviews(db) {
  let html = null;
  return async (req, res, next) => {
    try {
      html ??= await readFile(join(config.clientDist, 'index.html'), 'utf8');
      const p = await linkPreviewFor(db, req.path, req.query);
      // The page's own address, with only the parameters that pick a card's subject (never anything else from the URL).
      const keep = new URLSearchParams();
      for (const k of ['c', 'g', 'period', 'mode']) if (typeof req.query[k] === 'string' && req.query[k].length <= 80) keep.set(k, req.query[k]);
      const pageUrl = `${config.publicOrigin}${req.path}${keep.size ? `?${keep}` : ''}`.slice(0, 500);
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(withPreview(html, p, pageUrl));
    } catch (err) {
      next(err);
    }
  };
}
