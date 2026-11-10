import { HttpError } from '../core/errors.js';
import { getSetting, setSetting } from '../admin/settings.js';
import { betaState, setBetaOpen } from '../beta.js';
import { ENVIRONMENT } from '../core/environment.js';
import { GAME_VERSIONS, PRIMARY_VERSION, isVersionEnabled } from '../core/gameVersions.js';

/**
 * The feature registry (0.10.3, design/v5-admin "Features"): every on/off switch the admin has, in ONE place. The
 * Features page, settings search, the dashboard's "Features off" card and Release tools all iterate this list; no page
 * names a feature by hand.
 *
 *   id            stable id (URLs, the audit log)
 *   name, does    what the admin reads
 *   whenOff       what VISITORS see while it is off: the fallback. Every fallback is built and tested
 *                 (server/test/features.test.js turns each one off on its own and loads the pages it touches).
 *   needs         ids of features this one depends on: while one of them is off, this one does nothing either
 *   playerVisible whether players can see the difference (else "Admin and background only")
 *   settings      the feature's own settings (shown on its card, edited there)
 *   store         where its state lives:
 *                   { setting: key }                 a boolean admin setting (on = true)
 *                   { setting: key, inverted: true } a boolean setting that means OFF when true (crawler.paused)
 *                   { beta: true }                   the beta window (open = on): beta.js, never a setting
 *                   { version: id }                  a game version: READ-ONLY here (see below)
 *   env           only on this environment (the dev tester gate exists on the dev site only)
 *   afterChange   (optional) async (db, { key }) run after the switch changed: side effects the old panel had
 *
 * The Features page groups the cards by FEATURE_GROUPS (below), in this order.
 *
 * The switches carry over the value each one has when 0.10.3 is deployed: they read the same settings the old admin
 * panels wrote (renders.show, crawler.paused, crawler.rosterExpansion, collections.backfill, moderation.moderators) and
 * the beta window. Nothing is reset or hardcoded. The new switches default to on (what the site did before them), the
 * dev tester gate to off.
 *
 * Game versions: which versions run is decided in code (core/gameVersions.js, narrowed by GAME_VERSIONS= in .env) until
 * 0.11.0 builds their pages. Their cards show that state and can't be switched here yet: the primary version can never
 * be turned off (every page needs it), and the others turn on with 0.11.0.
 */
export const FEATURES = Object.freeze([
  {
    id: 'renders', name: 'Character renders', store: { setting: 'renders.show' }, playerVisible: true, settings: ['renders.pausedNote'],
    // As the old Settings route did (admin/routes.js): no share card made the other way is served after a change.
    afterChange: clearCardImages,
    does: 'Shows Blizzard’s character render on character pages, profiles, share cards and link previews.',
    whenOff: 'The Everstats crest instead of the render everywhere, with the note below. Cached share cards are cleared when this changes.',
  },
  {
    id: 'share-cards', name: 'Share cards and link previews', store: { setting: 'features.shareCards' }, playerVisible: true, settings: ['cards.maxConcurrent'],
    does: 'The card maker, share-card images and picture link previews for characters, tiers, guilds, boards and collections.',
    whenOff: 'No Share buttons; card pages and card images say sharing is switched off for now; links preview as a plain Everstats link.',
  },
  {
    id: 'beta', name: 'Beta', store: { beta: true }, playerVisible: true, settings: ['beta.perks'],
    does: 'While open: the header badge, the banner, and every new account becomes a beta member (Beta Tester badge), for good.',
    whenOff: 'Closed: no badge or banner, /beta thanks everyone and still lists the perks. Existing members keep it; reopening never makes accounts created while closed into members.',
  },
  {
    id: 'collections', name: 'Collections tab and refreshes', store: { setting: 'features.collections' }, playerVisible: true,
    does: 'The Collections tab and its screens, and every collections fetch (weekly, at sign-in, on the tab).',
    whenOff: 'The Collections tab says Collections are switched off for now; no collections are fetched. Boards built from collections keep what they have until it ages out.',
  },
  {
    id: 'collections-backfill', name: 'Collections backfill', store: { setting: 'collections.backfill' }, playerVisible: false, needs: ['collections', 'crawl'],
    settings: ['collections.backfillPerDay'],
    does: 'Gives characters tracked before collections existed their first collections fetch, a daily batch at a time.',
    whenOff: 'They get one only when someone looks them up, signs in or opens their Collections tab.',
  },
  {
    id: 'gold', name: 'Gold opt-in', store: { setting: 'features.goldOptIn' }, playerVisible: true,
    does: 'Reads gold with the owner’s token at a Battle.net sign-in; the owner sees it and can show it publicly on the gold boards.',
    whenOff: 'No gold is read; the owner’s gold and the gold boards say gold is switched off for now. Nothing stored is deleted (it ages out as usual).',
  },
  {
    id: 'guild-fetch', name: 'Guild “Fetch all members”', store: { setting: 'features.guildFetch' }, playerVisible: true, needs: ['crawl'],
    settings: ['guilds.fetchConcurrent', 'guilds.fetchCooldownHours'],
    does: 'Lets anyone ask for every member of a guild to be fetched.',
    whenOff: 'The guild page’s button says it is switched off for now and new fetches are refused. Fetches already running finish.',
  },
  {
    id: 'roster-seed', name: 'Seed from guild rosters', store: { setting: 'crawler.rosterExpansion' }, playerVisible: false, needs: ['crawl'],
    does: 'Starts tracking every level 10+ member of a guild roster the crawler reads.',
    whenOff: 'Rosters are still read daily (guild pages need them); their members are tracked only when looked up.',
  },
  {
    id: 'crawl', name: 'Background crawl', store: { setting: 'crawler.paused', inverted: true }, playerVisible: false,
    settings: ['crawler.requestsPerSecond'],
    does: 'The daily refresh, roster expansion, guild fetches and the collections backfill.',
    whenOff: 'Paused: they wait and resume. Lookups, sign-ins and their auto-fetch still run, because a person is waiting on them.',
  },
  {
    id: 'discord', name: 'Discord sign-in', store: { setting: 'features.discordSignIn' }, playerVisible: true,
    does: 'Signing in and linking with Discord.',
    whenOff: 'The Discord button shows “Switched off for now”; people sign in with Battle.net or a passkey. Nobody is signed out and no link is removed.',
  },
  {
    id: 'feedback', name: 'Feedback form', store: { setting: 'features.feedback' }, playerVisible: true,
    does: 'The public feedback form (/feedback and the footer link).',
    whenOff: '/feedback says feedback is closed for now. Ban appeals and replies in existing threads still work.',
  },
  {
    id: 'reports', name: 'Player reports', store: { setting: 'features.reports' }, playerVisible: true,
    does: '“Report” on profiles, guild descriptions and guild links.',
    whenOff: 'The Report buttons are hidden and new reports are refused. The queue and its decisions stay.',
  },
  {
    id: 'moderators', name: 'Moderator role', store: { setting: 'moderation.moderators' }, playerVisible: false,
    does: 'Lets you give player accounts the moderator role: Inbox › Reports, the parts of an account they may act on, and their own audit entries.',
    whenOff: 'Nobody can be given the role, and accounts that have it are ordinary players everywhere.',
  },
  ...GAME_VERSIONS.map((v) => ({
    id: `version-${v.id}`, name: v.name, store: { version: v.id }, playerVisible: true,
    does: v.primary ? 'The primary game version: every page, board and tier.' : `${v.name} characters, guilds, boards and tiers.`,
    whenOff: v.primary ? 'Can’t be turned off: it is the only version with pages.' : 'Not crawled, read at sign-in or shown. Its pages come in 0.11.0.',
  })),
  {
    id: 'dev-gate', name: 'Dev tester gate', store: { setting: 'features.devGate' }, playerVisible: true, env: 'dev',
    does: 'Every page of the dev site needs a sign-in, and only accounts holding Dev Tester on production (and this site’s admin) get in.',
    whenOff: 'Cloudflare Access alone decides who reaches the dev site.',
  },
]);

/** The Features page's sections (design/v5-admin pages/features), in order. A feature in none lands in the last. */
export const FEATURE_GROUPS = Object.freeze([
  { id: 'visitors', label: 'Visitor-facing', features: ['renders', 'share-cards', 'collections', 'gold'] },
  { id: 'community', label: 'Accounts and community', features: ['beta', 'discord', 'feedback', 'reports', 'moderators'] },
  { id: 'data', label: 'Data and crawling', features: ['crawl', 'roster-seed', 'collections-backfill', 'guild-fetch'] },
  { id: 'versions', label: 'Game versions', features: GAME_VERSIONS.map((v) => `version-${v.id}`) },
  { id: 'dev', label: 'Dev site', features: ['dev-gate'] },
]);
const groupOf = (id) => FEATURE_GROUPS.find((g) => g.features.includes(id)) ?? FEATURE_GROUPS[FEATURE_GROUPS.length - 1];

/** Renders on/off: empty the share-card image cache (and the card data memo), logged with how many went. */
async function clearCardImages(db, { key }) {
  const { clearCardMemo } = await import('../cards/routes.js');
  const gone = await db.query('DELETE FROM share_card_images RETURNING 1');
  clearCardMemo();
  await db.query("INSERT INTO admin_events (type, detail) VALUES ('cards.cache_cleared', $1::jsonb)", [JSON.stringify({ reason: key, images: gone.length })]);
}

const byId = new Map(FEATURES.map((f) => [f.id, f]));
export const featureById = (id) => byId.get(id) ?? null;
export const featuresHere = (env = ENVIRONMENT) => FEATURES.filter((f) => !f.env || f.env === env.id);
/** Features that need this one (its dependents): listed when it is turned off. */
export const dependentsOf = (id) => FEATURES.filter((f) => (f.needs ?? []).includes(id));

// A few seconds of memory per process, so a public request checking a switch costs no query most of the time. Setting
// a switch clears it in the process that set it; the other process (worker / web) follows within CACHE_MS.
const CACHE_MS = 5000;
const cache = new Map();
export function clearFeatureCache() {
  cache.clear();
}

async function stored(db, f) {
  if (f.store.setting) {
    const v = await getSetting(db, f.store.setting);
    return f.store.inverted ? !v : Boolean(v);
  }
  if (f.store.beta) return Boolean((await betaState(db)).open);
  if (f.store.version) return isVersionEnabled(f.store.version);
  return true;
}

/** Is this feature's own switch on? (Not its dependencies: see featureOn.) */
export async function switchOn(db, id) {
  const f = featureById(id);
  if (!f) throw new Error(`unknown feature ${id}`);
  if (f.env && f.env !== ENVIRONMENT.id) return false;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on;
  const on = await stored(db, f);
  cache.set(id, { on, at: Date.now() });
  return on;
}

/** Is this feature working: its switch on AND everything it needs on. The question every fallback asks. */
export async function featureOn(db, id, seen = new Set()) {
  if (seen.has(id)) return true;
  seen.add(id);
  if (!(await switchOn(db, id))) return false;
  for (const need of featureById(id).needs ?? []) if (!(await featureOn(db, need, seen))) return false;
  return true;
}

/** Every feature's public on/off, for the client (the session answer carries the player-visible ones). */
export async function publicFeatures(db) {
  const out = {};
  for (const f of featuresHere()) if (f.playerVisible && !f.store.version) out[f.id] = await featureOn(db, f.id);
  return out;
}

/** Refuses with a plain 503 when a feature is off: for routes whose whole job is the feature. */
export function requireFeature(db, id, message) {
  return async (req, res, next) => {
    try {
      if (await featureOn(db, id)) return next();
      return next(new HttpError(503, message ?? `${featureById(id).name} is switched off for now.`, 'feature_off'));
    } catch (err) {
      return next(err);
    }
  };
}

const settingKeys = (f) => [f.store.setting, ...(f.settings ?? [])].filter(Boolean);

/** The Features page: each feature with its state, what it needs and what needs it, and its last change. */
export async function listFeatures(db) {
  const keys = FEATURES.flatMap(settingKeys);
  const changes = await db.query(
    `SELECT DISTINCT ON (key) detail->>'key' AS key, created_at, detail->>'reason' AS reason
       FROM admin_events, LATERAL (SELECT detail->>'key' AS key) k
      WHERE type = 'setting.changed' AND detail->>'key' = ANY($1::text[])
      ORDER BY key, created_at DESC LIMIT 100`,
    [keys],
  );
  const beta = await db.one("SELECT created_at, detail->>'reason' AS reason FROM admin_events WHERE type = 'beta.changed' ORDER BY created_at DESC LIMIT 1");
  clearFeatureCache();
  const out = [];
  for (const f of featuresHere()) {
    const on = await switchOn(db, f.id);
    const change = f.store.beta ? beta : f.store.setting ? changes.find((c) => c.key === f.store.setting) : null;
    const blockedBy = [];
    for (const need of f.needs ?? []) if (!(await featureOn(db, need))) blockedBy.push(need);
    out.push({
      id: f.id, name: f.name, does: f.does, whenOff: f.whenOff, playerVisible: f.playerVisible,
      group: groupOf(f.id).id, groupLabel: groupOf(f.id).label, groupOrder: FEATURE_GROUPS.indexOf(groupOf(f.id)),
      needs: f.needs ?? [], usedBy: dependentsOf(f.id).map((d) => d.id), settings: f.settings ?? [],
      on, working: on && blockedBy.length === 0, blockedBy,
      locked: f.store.version ? (f.store.version === PRIMARY_VERSION.id ? 'primary' : 'code') : null,
      settingKey: f.store.setting ?? null,
      changedAt: change?.created_at ?? null, changedReason: change?.reason ?? null,
      // the beta card keeps the window's dates (opened, closed)
      ...(f.store.beta ? { beta: await betaState(db) } : {}),
    });
  }
  return out;
}

/**
 * Switches a feature on or off. A reason is required (it goes in the audit log). Turning one off while features that
 * need it are on needs `confirmDependents: true`: the page shows the list and its fallbacks first.
 */
export async function setFeature(db, id, on, { reason, confirmDependents = false } = {}) {
  const f = featureById(id);
  if (!f || (f.env && f.env !== ENVIRONMENT.id)) throw new HttpError(404, 'Unknown feature');
  if (typeof on !== 'boolean') throw new HttpError(400, 'On or off?', 'invalid');
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 3) throw new HttpError(400, 'Say why: the reason goes in the audit log.', 'reason_required');
  if (f.store.version) {
    throw new HttpError(409, f.store.version === PRIMARY_VERSION.id
      ? `${f.name} is the primary version and can’t be turned off.`
      : `${f.name} is switched on in code with 0.11.0; it can’t be switched here yet.`, 'locked');
  }
  if (!on && !confirmDependents) {
    const affected = [];
    for (const d of dependentsOf(id)) if (await switchOn(db, d.id)) affected.push(d.id);
    if (affected.length) throw Object.assign(new HttpError(409, 'Other features need this one.', 'has_dependents'), { affected });
  }
  if (f.store.beta) {
    await setBetaOpen(db, on, { reason: why });
  } else {
    await setSetting(db, f.store.setting, f.store.inverted ? !on : on, { reason: why });
  }
  if (f.afterChange) await f.afterChange(db, { key: f.store.setting ?? f.id });
  // Logged once, by the store it changed (setting.changed with before, value and reason; beta.changed for the beta). The
  // audit log names the feature from this registry (audit/log.js), so a switch is never logged twice.
  clearFeatureCache();
  return listFeatures(db);
}
