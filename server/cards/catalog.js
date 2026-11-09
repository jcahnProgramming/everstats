/**
 * Share cards (0.8.0): the registry. Everything there will be more of (card types, formats, layouts, themes, accents,
 * show toggles) is declared here, and the routes, the renderer and the card maker iterate it. Design:
 * design/v3-share-cards (README.md, cards/README.md, components/card-maker.md).
 *
 * A card = a TYPE (character, guild, board, tier) × a FORMAT (square, story, wide) × a LAYOUT (a, b) × a THEME
 * (forever, alliance, horde) × an ACCENT (one of the card theme's own tokens, never a free colour), plus the type's
 * content choices. `cleanOptions` is the only way options get in: anything unknown is dropped, anything out of range
 * falls back to the default, so a URL can never ask the renderer for something the design doesn't have.
 */
export const FORMATS = Object.freeze({
  square: { width: 1080, height: 1080, label: 'Square', hint: 'Discord, Instagram' },
  story: { width: 1080, height: 1920, label: 'Story', hint: 'Phone stories' },
  wide: { width: 1200, height: 630, label: 'Wide', hint: 'X, Reddit, link previews' },
});
export const THEMES = Object.freeze(['forever', 'alliance', 'horde']);
export const THEME_LABELS = Object.freeze({ forever: 'Forever', alliance: 'Alliance', horde: 'Horde' });
/** The accent swatches: the card theme's own palette tokens (--es-accent, --es-c2 … --es-c5). */
export const ACCENTS = Object.freeze(['accent', 'c2', 'c3', 'c4', 'c5']);

export const MAX_STATS = 6;
export const MAX_GUILD_BADGES = 4; // the pinned one plus up to 3 more
export const MAX_GUILD_TOTALS = 4;

/**
 * The card types. `template` maps (format, layout, subject) to a template in kit/v3-share-cards/cards/. `toggles`
 * are the "Show" switches (each with its default). The guild-board templates (`-guild`) are the design's own, used
 * for a guild on a guild board (owner's decision, 0.8.0).
 */
export const CARD_TYPES = Object.freeze({
  character: {
    label: 'Character card',
    layouts: { a: 'Render left', b: 'Render centred' },
    toggles: { render: true, tier: true, badge: true, guild: true, gear: true },
    template: (format, layout) => `character/${format}-${layout}.html`,
  },
  guild: {
    label: 'Guild card',
    layouts: { a: 'Crest left', b: 'Centred banner' },
    toggles: { recruiting: true, tierbar: true },
    template: (format, layout) => `guild/${format}-${layout}.html`,
  },
  board: {
    label: 'Leaderboard card',
    layouts: { a: 'Top 3', b: 'Neighbours' },
    toggles: {},
    template: (format, layout, subject) => `board/${format}-${layout}${subject === 'guild' ? '-guild' : ''}.html`,
  },
  tier: {
    label: 'Tier card',
    layouts: { a: 'Letter left', b: 'Letter centred' },
    toggles: { cats: true, next: true },
    template: (format, layout) => `tier/${format}-${layout}.html`,
  },
  // 0.9.0: design/v4-collections/cards (kit/v4-collections/cards/collections/*.html, verbatim). One layout per format.
  collections: {
    label: 'Collections card',
    root: 'v4-collections/cards',
    layouts: { a: 'Counts and showcase' },
    toggles: { transmog: true, guild: true, showcase: true },
    template: (format) => `collections/${format}.html`,
  },
});
/** Where a type's templates live in the kit (v3 for the 0.8.0 types). */
export const templateRoot = (type) => CARD_TYPES[type]?.root ?? 'v3-share-cards/cards';

/** How many statistics a character card's format and layout show (README "Format rules"). */
export function statsShown(format, layout) {
  if (format === 'story') return 6;
  if (format === 'wide') return 3;
  return layout === 'b' ? 3 : 6;
}

/** The README's defaults (and the link preview's when nothing is saved): wide, layout A, Forever, the theme accent. */
export function defaultOptions(type, { format = 'wide' } = {}) {
  const t = CARD_TYPES[type];
  const base = { format, theme: 'forever', layout: 'a', accent: 'accent', show: { ...t.toggles } };
  if (type === 'character') return { ...base, stats: null, gear: 'worn' }; // stats null = the owner's pins, else the top-ranked
  if (type === 'guild') return { ...base, badges: null, totals: null }; // null = the guild page's own choice
  return base;
}

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const ids = (v, max) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((x) => Number.isSafeInteger(x) && x > 0))].slice(0, max) : null);
const badgeIds = (v, max) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && /^[a-z][a-z0-9-]{1,47}$/.test(x)))].slice(0, max) : null);

/** Options from anywhere (a query string, a saved default, a request body) → a complete, valid set. */
export function cleanOptions(type, raw) {
  const t = CARD_TYPES[type];
  if (!t) throw new Error(`unknown card type ${type}`);
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = defaultOptions(type, { format: pick(r.format, Object.keys(FORMATS), 'wide') });
  const show = {};
  for (const [k, def] of Object.entries(t.toggles)) show[k] = typeof r.show?.[k] === 'boolean' ? r.show[k] : def;
  const out = {
    format: d.format,
    theme: pick(r.theme, THEMES, d.theme),
    layout: pick(r.layout, Object.keys(t.layouts), d.layout),
    accent: pick(r.accent, ACCENTS, d.accent),
    show,
  };
  if (type === 'character') {
    out.stats = ids(r.stats, MAX_STATS);
    if (out.stats && !out.stats.length) out.stats = null;
    out.gear = pick(r.gear, ['worn', 'transmog'], 'worn');
  }
  if (type === 'guild') {
    out.badges = badgeIds(r.badges, MAX_GUILD_BADGES);
    out.totals = ids(r.totals, MAX_GUILD_TOTALS);
  }
  return out;
}

/** Options as a stable string (the cache key and the image URL carry it). */
export function optionsKey(options) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(options));
}

export const encodeOptions = (options) => Buffer.from(optionsKey(options)).toString('base64url');
export function decodeOptions(type, raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return cleanOptions(type, {});
  try {
    return cleanOptions(type, JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    return cleanOptions(type, {});
  }
}

/** Board periods (the same three as the boards themselves; the rolling label comes from the live window). */
export const BOARD_PERIODS = Object.freeze(['overall', 'week', 'rolling']);
