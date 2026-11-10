import { HttpError } from '../core/errors.js';
import { DEFAULT_SHARES, TIER_LETTERS, sharesProblem } from '../stats/tiers.js';
import { BETA_PERK_TEXT } from '../badges/catalog.js';
import { GAME_VERSIONS, PRIMARY_VERSION, versionById } from '../core/gameVersions.js';
import { environmentDefault } from '../core/environment.js';

/**
 * The admin settings registry. Every setting declares itself here; the admin page renders whatever is declared and
 * the store refuses anything undeclared. A missing row in `settings` means the declared default.
 *
 *   key, section ('grading' | 'tiers' | 'discovery' | 'crawler' | 'beta' | 'cards': which admin panel shows it), label, help, type, default
 *   0.10.3: section 'features' = an on/off switch the Features page owns (server/features/registry.js says what each
 *   one does, its fallback and its dependencies); 'release' = Release tools (the maintenance banner).
 *   type 'integer'  (min, max)
 *        'percent'  a whole percent (min, max), shown with a % sign
 *        'shares'   the five letter shares { S, A, B, C, D }, whole percents adding up to 100
 *        'boolean'
 *        'perks'    a short list of { title, description } (the beta page's perks), at most PERKS_MAX items
 *        'window'   null, or { start, end } as UTC calendar dates 'YYYY-MM-DD', both days included (0.7.0)
 *        'banner'   null (off), or { text, start, end }: a maintenance notice for players; start / end are ISO times or
 *                   null (from now / until turned off) (0.10.3)
 *        'weights'  { categoryKey: percent } pins for the overall tier's category weights (0.8.0); each 0.1–99.9, one
 *                   decimal; whether they fit the live categories is checked by tiers/engine.js weightsProblem
 */
export const PERKS_MAX = 12;
export const SETTINGS = [
  {
    // 0.6.0: tiers (server/tiers/). The default fell from 500 to 50 (owner's decision for tiers). A value saved on the
    // admin page before 0.6.0 stays what it was.
    key: 'grading.minPopulation',
    perVersion: true,
    section: 'tiers',
    label: 'Tier-eligible characters a ruleset needs before it is graded',
    help: 'Tier-eligible: level 10 or higher, fully fetched, not hidden. Until a ruleset has this many, nobody on it gets a tier: their pages say "Tiers open once N characters are tracked on {ruleset}". Leaderboards still show.',
    type: 'integer',
    min: 1,
    max: 10_000_000,
    default: 50,
  },
  {
    key: 'tiers.shares',
    perVersion: true,
    section: 'tiers',
    label: 'Letter shares',
    help: 'What share of a ruleset gets each letter, best first. The same shares apply to every category tier and the overall tier. They must add up to 100.',
    type: 'shares',
    default: { ...DEFAULT_SHARES },
  },
  {
    key: 'tiers.categoryHalf',
    perVersion: true,
    section: 'tiers',
    label: 'Share of a category’s counted statistics a character needs above zero',
    help: 'A character gets a category letter only with a value above zero in at least this share of the category’s counted statistics (rounded up), so one lucky statistic can’t earn an S.',
    type: 'percent',
    min: 1,
    max: 100,
    default: 50,
  },
  {
    key: 'tiers.overallHalf',
    perVersion: true,
    section: 'tiers',
    label: 'Share of the overall categories a character needs a letter in',
    help: 'A character gets an overall letter only with a letter in at least this share (rounded up) of the categories that count toward the overall tier.',
    type: 'percent',
    min: 1,
    max: 100,
    default: 50,
  },
  {
    // 0.8.0: share cards (server/cards/render.js). Each render is a headless Chromium page at card size; this caps how
    // many run at once in the web container (memory: see the admin page's measured times and the deploy notes).
    key: 'cards.maxConcurrent',
    section: 'cards',
    label: 'Share cards rendered at the same time',
    help: 'Each render is one headless Chromium page. More at once answers a burst faster but uses more memory. Requests beyond this wait in a short queue; a full queue is told to try again in a few seconds.',
    type: 'integer',
    min: 1,
    max: 8,
    default: 2,
  },
  {
    // 0.8.0: the overall tier is a weighted average of its categories. Unpinned categories follow the square root of
    // their counted statistics (tiers/engine.js categoryWeights); a pin fixes one category's percent.
    key: 'tiers.weights',
    perVersion: true,
    section: 'tiers',
    label: 'Pinned category weights',
    help: 'Each category counts toward the overall tier in proportion to the square root of how many of its statistics count. Pin a percent to fix a category’s weight; the others share the rest by the same rule.',
    type: 'weights',
    default: {},
  },
  {
    // 0.5.0: guild boards (stats/guildBoards.js). A guild below this shows "Not ranked yet: needs N tracked members".
    key: 'guilds.minMembers',
    section: 'grading',
    label: 'Tracked members a guild needs before it is ranked on the guild boards',
    help: 'Guild boards rank guilds by the total (or average) of their current tracked members. A guild with fewer tracked members than this is listed as "Not ranked yet" instead.',
    type: 'integer',
    min: 1,
    max: 1000,
    default: 5,
  },
  {
    // 0.6.0: "#1 of 1" says nothing, so a board is listed under a guild's "On the guild boards" only from this many.
    key: 'guilds.minBoardGuilds',
    section: 'grading',
    label: 'Ranked guilds a board needs before a guild page lists its placement there',
    help: 'A guild page lists its places on the guild boards under "On the guild boards". A board with fewer ranked guilds than this isn’t listed there (it still has its own page).',
    type: 'integer',
    min: 1,
    max: 1000,
    default: 3,
  },
  {
    key: 'discovery.maxCharacters',
    section: 'discovery',
    label: 'Most characters fetched in one discovery run',
    help: 'The primary character first, then the Battle.net account’s characters, then guild-roster members, until this many. Each character is about 27 requests.',
    type: 'integer',
    min: 1,
    max: 500,
    default: 50,
  },
  {
    key: 'discovery.requestsPerSecond',
    section: 'discovery',
    label: 'Discovery requests per second',
    help: 'Blizzard documents 100 requests a second and 36,000 an hour per API client. 10 a second stays under the hourly cap even for an hour-long run.',
    type: 'integer',
    min: 1,
    max: 100,
    default: 10,
  },
  {
    key: 'crawler.requestsPerSecond',
    section: 'crawler',
    label: 'Blizzard requests per second (everything shares this)',
    help: 'One budget for every request the crawler makes: lookups and sign-ins first, then auto-fetch, the daily refresh, and guild rosters last. Blizzard documents 36,000 an hour per client; 8 a second is 28,800.',
    type: 'integer',
    min: 1,
    max: 50,
    default: 8,
  },
  {
    // 0.10.0: each game version's CEILING on the shared budget. A version's requests (lookups included) start at most
    // at its share of the rate, so no version can take the budget from another; inside a version, lookups still go
    // first. 100 = no ceiling. A version that isn't enabled makes no requests whatever its share says.
    key: 'crawler.versionShares',
    section: 'crawler',
    label: 'Each game version’s most of the request budget',
    help: 'A ceiling, not a reservation: a version never uses more than this share of the requests per second, so it can never starve another. Lookups and sign-ins go first within each version. Versions that aren’t switched on make no requests.',
    type: 'versionShares',
    options: GAME_VERSIONS.map((v) => ({ value: v.id, label: v.name, enabled: v.enabled })),
    default: Object.fromEntries(GAME_VERSIONS.map((v) => [v.id, v.primary ? 100 : 25])),
  },
  {
    // 0.10.0: Blizzard's docs say "API clients are limited to 36,000 requests per hour at a rate of 100 requests per
    // second" with no word on regions (guides/getting-started, read 2026-11-09). 'client' (the default, the safe
    // reading): one budget for every region. 'region': one budget per region at the same rate, if Blizzard confirms
    // the quota is per region. Only US exists before 1.0, so the two behave the same today.
    key: 'crawler.budgetScope',
    section: 'crawler',
    label: 'Request budget: one for all regions, or one per region',
    help: 'Blizzard documents 36,000 requests an hour and 100 a second per API client, without saying whether that is per region. Keep "one for all regions" unless Blizzard confirms a quota per region.',
    type: 'choice',
    options: [{ value: 'client', label: 'One for all regions' }, { value: 'region', label: 'One per region' }],
    default: 'client',
  },
  {
    // 0.8.1: Blizzard's Forever render service drew the wrong race for every character (characters/renders.js). Off:
    // the crest everywhere (pages, share cards, link previews) and the note below. Changing either clears the
    // share-card image cache (admin/routes.js), so no picture made the other way is served.
    key: 'renders.show',
    section: 'renders',
    label: 'Show Blizzard renders',
    help: 'Off: character pages, profiles, share cards and link previews use the crest instead of Blizzard’s character render, and pages show the note below. Use it while Blizzard’s render service draws characters wrong. Cached share cards are cleared when this changes.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'renders.pausedNote',
    section: 'renders',
    label: 'Note shown while renders are off',
    help: 'Plain text, shown next to the crest wherever a render would be.',
    type: 'text',
    min: 10,
    max: 160,
    default: 'Character renders are paused while Blizzard fixes an issue with them',
  },
  {
    key: 'crawler.paused',
    section: 'crawler',
    label: 'Pause the background crawl',
    help: 'Stops the daily refresh, roster expansion and “Fetch all members” guild fetches (they wait and resume). Lookups, sign-ins and their auto-fetch still run, because a person is waiting on them.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'crawler.rosterExpansion',
    section: 'crawler',
    label: 'Seed characters from guild rosters',
    help: 'Guild profiles and rosters are read once a day either way (guild pages need them). On: also start tracking every roster member of level 10 and up.',
    type: 'boolean',
    default: true,
  },
  {
    // 0.9.2: the gradual first collections fetch (collections/backfill.js).
    key: 'collections.backfill',
    section: 'crawler',
    label: 'First collections fetch for tracked characters',
    help: 'On: characters tracked before collections existed get their first collections fetch a batch at a time, behind everyone waiting, up to the daily cap below. Off: they get one only when someone looks them up, signs in or opens their Collections tab.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'collections.backfillPerDay',
    section: 'crawler',
    label: 'First collections fetches per day',
    help: 'How many characters the first collections fetch queues each UTC day. Each is about 13 requests to Blizzard, through the shared request budget.',
    type: 'integer',
    min: 50,
    max: 20000,
    default: 1000,
  },
  {
    // 0.9.1: "Your guilds" on the home page (guilds/follow.js).
    key: 'dashboard.maxPinnedGuilds',
    section: 'crawler',
    label: 'Guilds a player can pin to their dashboard',
    help: 'How many guilds a player can follow with “Pin to dashboard” on a guild page. Their own characters’ guilds don’t count toward it. Lowering it unpins nothing; it only stops new pins.',
    type: 'integer',
    min: 1,
    max: 50,
    default: 10,
  },
  {
    // 0.9.0: "Fetch all members" on guild pages (guilds/fetchAll.js).
    key: 'guilds.fetchConcurrent',
    section: 'crawler',
    label: 'Guild fetches that run at once, site-wide',
    help: 'How many “Fetch all members” guild fetches the crawler works on at the same time. The rest wait their turn and their pages say how many guilds are ahead. Either way a guild fetch never uses more than half the request budget.',
    type: 'integer',
    min: 1,
    max: 10,
    default: 2,
  },
  {
    key: 'guilds.fetchCooldownHours',
    section: 'crawler',
    label: 'Hours before a guild can be fetched whole again',
    help: 'After a “Fetch all members” finishes, the button stays unavailable for that guild this long and says when it opens again. Members are still refreshed daily either way.',
    type: 'integer',
    min: 1,
    max: 168,
    default: 6,
  },
  {
    // Blizzard's 30-day rule (retention/policy.js). Above 30 only with a written-permission note, which is logged.
    key: 'retention.window',
    section: 'retention',
    // 0.9.2: relabelled. This is Blizzard's MAXIMUM age; the database deletes one day earlier (retention/policy.js).
    label: 'Blizzard’s maximum data age (days): Everstats deletes 1 day sooner',
    help: 'Blizzard’s API terms allow at most 30 days. Everstats deletes Blizzard data one day before this limit (29 days at 30), checking every hour. Raise it only if Blizzard has given written permission, and record that permission here.',
    type: 'retention',
    default: { days: 30, note: null },
  },
  {
    key: 'beta.perks',
    section: 'beta',
    label: 'What beta members get',
    help: 'Shown on the /beta page, while the beta is open and after it has closed.',
    type: 'perks',
    default: [
      { title: 'Beta Tester badge', description: BETA_PERK_TEXT },
    ],
  },
  {
    // 0.7.0: the Early Supporter badge (badges/rules.js). Unset = the badge isn't awardable, isn't listed as earnable
    // and shows nowhere. After the end date it shows as "No longer available" to accounts that didn't get it.
    key: 'badges.earlySupporter',
    section: 'badges',
    label: 'Early Supporter window',
    help: 'Accounts created between these dates (UTC, both days included) get the Early Supporter badge. Leave it unset and the badge shows nowhere.',
    type: 'window',
    default: null,
  },
  {
    // 0.7.1: the Early Guild badge (guildBadges/rules.js). Unset = not awardable and listed nowhere. Founding Guild uses
    // the beta window instead and has no setting.
    key: 'guildBadges.earlyWindow',
    section: 'guildBadges',
    label: 'Early Guild window',
    help: 'Guilds Everstats first tracks between these dates (UTC, both days included) unlock Early Guild. After it closes, the badge shows “No longer available” to guilds that didn’t get it. Leave it unset and the badge shows nowhere.',
    type: 'window',
    default: null,
  },
  {
    // 0.8.2: the moderator role (moderation/permissions.js). Off: nobody can be given the role, and an account that has
    // it is an ordinary player everywhere (no Reports queue, no actions). Owner's decision: off until they turn it on.
    key: 'moderation.moderators',
    section: 'moderation',
    label: 'Moderators',
    help: 'On: you can give the moderator role to a player account that has 2FA or a passkey, and those accounts can use the Reports queue and the actions a moderator is allowed. Off: nobody can be given the role, and accounts that have it can’t use it.',
    type: 'boolean',
    default: false,
  },
  // 0.10.3: feature switches (server/features/registry.js). Each defaults to what the site does today, so adding the
  // switch changes nothing until the admin turns one off.
  {
    key: 'features.shareCards',
    section: 'features',
    label: 'Share cards and link previews',
    help: 'On: the card maker, share-card images and picture link previews. Off: no Share buttons, card pages say sharing is off for now, and links preview as plain Everstats links.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.collections',
    section: 'features',
    label: 'Collections tab and refreshes',
    help: 'On: the Collections tab and its screens, and collections fetches. Off: the tab says Collections are switched off for now, and no collections are fetched (the first-collections backfill pauses with it).',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.goldOptIn',
    section: 'features',
    label: 'Gold opt-in',
    help: 'On: gold is read at a Battle.net sign-in for the owner, and owners can show it publicly. Off: no gold is read, gold boards and the owner’s gold say gold is switched off for now; nothing stored is deleted.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.guildFetch',
    section: 'features',
    label: 'Guild “Fetch all members”',
    help: 'On: anyone can ask for a whole guild to be fetched. Off: the button says it is switched off for now; fetches already running finish.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.discordSignIn',
    section: 'features',
    label: 'Discord sign-in',
    help: 'On: Discord sign-in and linking. Off: the Discord button is shown as switched off; people use Battle.net or a passkey. Nobody is signed out.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.feedback',
    section: 'features',
    label: 'Feedback form',
    help: 'On: the public feedback form. Off: /feedback says feedback is closed for now. Ban appeals and replies to existing threads still work.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.reports',
    section: 'features',
    label: 'Player reports',
    help: 'On: “Report” on profiles, guild descriptions and guild links. Off: the Report buttons are hidden and new reports are refused; the queue stays.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'features.devGate',
    section: 'features',
    label: 'Dev tester gate',
    help: 'Dev site only. On: every page needs a sign-in, and only accounts holding Dev Tester on production (and the dev admin) get in. Off: Cloudflare Access alone decides who reaches the dev site.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'maintenance.banner',
    section: 'release',
    label: 'Maintenance banner',
    help: 'A short notice shown at the top of every page for players, between the start and end you give. Plain text on one line. Off by default.',
    type: 'banner',
    max: 200,
    default: null,
  },
];

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));

// A text setting (0.8.1): one line of plain text. Built without backslash escapes in the source on purpose.
const BS = String.fromCharCode(92);
const TEXT_REFUSED = new RegExp(`[${BS}p{Cc}${BS}p{Cf}<>]`, "u");

function check(def, value) {
  if (def.type === 'integer') {
    if (!Number.isInteger(value)) throw new HttpError(400, `${def.label} must be a whole number`, 'invalid');
    if (value < def.min || value > def.max) throw new HttpError(400, `${def.label} must be between ${def.min} and ${def.max}`, 'invalid');
    return value;
  }
  if (def.type === 'percent') {
    if (!Number.isInteger(value)) throw new HttpError(400, `${def.label} must be a whole percent`, 'invalid');
    if (value < def.min || value > def.max) throw new HttpError(400, `${def.label} must be between ${def.min}% and ${def.max}%`, 'invalid');
    return value;
  }
  if (def.type === 'shares') {
    const problem = sharesProblem(value);
    if (problem) throw new HttpError(400, problem, 'invalid');
    return Object.fromEntries(TIER_LETTERS.map((l) => [l, value[l]]));
  }
  if (def.type === 'text') {
    const raw = String(value ?? '').normalize('NFC');
    if (TEXT_REFUSED.test(raw)) throw new HttpError(400, `${def.label} is plain text on one line: no line breaks, control characters or angle brackets`, 'invalid');
    const v = raw.split(' ').filter(Boolean).join(' ');
    if (v.length < def.min || v.length > def.max) throw new HttpError(400, `${def.label}: ${def.min}–${def.max} characters`, 'invalid');
    return v;
  }
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') throw new HttpError(400, `${def.label} must be on or off`, 'invalid');
    return value;
  }
  if (def.type === 'choice') {
    if (!def.options.some((o) => o.value === value)) throw new HttpError(400, `${def.label}: pick one of the choices`, 'invalid');
    return value;
  }
  if (def.type === 'versionShares') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${def.label}: a percent per game version`, 'invalid');
    const out = {};
    for (const v of GAME_VERSIONS) {
      const n = value[v.id] ?? def.default[v.id];
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new HttpError(400, `${def.label}: ${v.name} must be a whole percent from 0 to 100`, 'invalid');
      out[v.id] = n;
    }
    if (out[PRIMARY_VERSION.id] < 1) throw new HttpError(400, `${def.label}: ${PRIMARY_VERSION.name} needs at least 1%`, 'invalid');
    for (const k of Object.keys(value)) if (!versionById(k)) throw new HttpError(400, `${def.label}: unknown game version`, 'invalid');
    return out;
  }
  if (def.type === 'perks') {
    if (!Array.isArray(value) || value.length > PERKS_MAX) throw new HttpError(400, `Up to ${PERKS_MAX} perks`, 'invalid');
    return value.map((p) => {
      const title = typeof p?.title === 'string' ? p.title.trim() : '';
      const description = typeof p?.description === 'string' ? p.description.trim() : '';
      if (!title || title.length > 60) throw new HttpError(400, 'Each perk needs a title of up to 60 characters', 'invalid');
      if (description.length > 300) throw new HttpError(400, 'A perk description is up to 300 characters', 'invalid');
      return { title, description };
    });
  }
  if (def.type === 'window') {
    if (value === null) return null;
    const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
      && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (!ok(value?.start) || !ok(value?.end)) throw new HttpError(400, 'Give a start and an end date (YYYY-MM-DD), or clear the window.', 'invalid');
    if (value.end < value.start) throw new HttpError(400, 'The window ends before it starts.', 'invalid');
    return { start: value.start, end: value.end };
  }
  if (def.type === 'banner') {
    if (value === null) return null;
    const raw = String(value?.text ?? '').normalize('NFC');
    if (TEXT_REFUSED.test(raw)) throw new HttpError(400, 'The banner is plain text on one line: no line breaks, control characters or angle brackets', 'invalid');
    const text = raw.split(' ').filter(Boolean).join(' ');
    if (text.length < 5 || text.length > def.max) throw new HttpError(400, `The banner text is 5–${def.max} characters`, 'invalid');
    const when = (v, name) => {
      if (v === null || v === undefined || v === '') return null;
      const t = Date.parse(v);
      if (typeof v !== 'string' || Number.isNaN(t)) throw new HttpError(400, `The banner's ${name} isn't a date and time`, 'invalid');
      return new Date(t).toISOString();
    };
    const start = when(value.start, 'start');
    const end = when(value.end, 'end');
    if (start && end && end <= start) throw new HttpError(400, 'The banner ends before it starts.', 'invalid');
    return { text, start, end };
  }
  if (def.type === 'weights') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Category weights must be a list of pinned percents', 'invalid');
    const entries = Object.entries(value);
    if (entries.length > 30) throw new HttpError(400, 'Too many pinned categories', 'invalid');
    const out = {};
    for (const [k, v] of entries) {
      if (!/^[a-z0-9-]{1,80}$/.test(k)) throw new HttpError(400, 'Unknown category', 'invalid');
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.1 || v > 99.9) throw new HttpError(400, 'A pinned weight is between 0.1% and 99.9%', 'invalid');
      out[k] = Math.round(v * 10) / 10;
    }
    return out;
  }
  if (def.type === 'retention') {
    const days = value?.days;
    const note = typeof value?.note === 'string' ? value.note.trim().slice(0, 1000) : '';
    if (!Number.isInteger(days) || days < 12 || days > 400) throw new HttpError(400, 'The window is a whole number of days, from 12 to 400.', 'invalid');
    if (days > 30 && note.length < 20) {
      throw new HttpError(400, 'Blizzard’s terms allow at most 30 days. Going above that needs Blizzard’s written permission: describe it in the note (who, when, what was granted).', 'needs_permission');
    }
    return { days, note: days > 30 ? note : null };
  }
  throw new Error(`setting ${def.key} has an unknown type`);
}

/**
 * 0.10.0: settings marked `perVersion` (the tier settings) have one value per game version. The primary version's is
 * the row it always had (the bare key), so nothing stored moved; another version's lives at "{key}@{version}" and
 * starts at the declared default, never at the primary version's value.
 */
export const PER_VERSION_KEYS = Object.freeze(['grading.minPopulation', 'tiers.shares', 'tiers.categoryHalf', 'tiers.overallHalf', 'tiers.weights']);
export function storageKey(key, version = null) {
  const def = byKey.get(key);
  if (!def?.perVersion || !version || version === PRIMARY_VERSION.id) return key;
  if (!versionById(version)) throw new HttpError(400, 'Unknown game version', 'invalid');
  return `${key}@${version}`;
}

export async function getSetting(db, key, { version = null } = {}) {
  const def = byKey.get(key);
  if (!def) throw new Error(`unknown setting ${key}`);
  const row = await db.one('SELECT value FROM settings WHERE key = $1', [storageKey(key, version)]);
  return row ? row.value : environmentDefault(def.key, def.default);
}

export async function listSettings(db, { version = null } = {}) {
  const keys = SETTINGS.map((s) => storageKey(s.key, version));
  const rows = await db.query('SELECT key, value, updated_at FROM settings WHERE key = ANY($1) LIMIT 200', [keys]);
  const stored = new Map(rows.map((r) => [r.key.split('@')[0], r]));
  return SETTINGS.map((def) => ({
    perVersion: Boolean(def.perVersion),
    key: def.key,
    section: def.section,
    label: def.label,
    help: def.help,
    type: def.type,
    min: def.min,
    max: def.max,
    default: environmentDefault(def.key, def.default),
    options: def.options,
    value: stored.has(def.key) ? stored.get(def.key).value : environmentDefault(def.key, def.default),
    updatedAt: stored.get(def.key)?.updated_at ?? null,
  }));
}

/** Validates a value for a setting without saving it (the tier preview uses it). → the cleaned value. */
export function checkSetting(key, value) {
  const def = byKey.get(key);
  if (!def) throw new HttpError(404, 'Unknown setting');
  return check(def, value);
}

/** Keys whose change re-grades every ruleset (the worker's tiers job picks the request up). */
export const TIER_SETTING_KEYS = Object.freeze(['grading.minPopulation', 'tiers.shares', 'tiers.categoryHalf', 'tiers.overallHalf', 'tiers.weights']);

/** A value as the log keeps it: perks as a count, a banner as on / off and its times (its text is in the setting). */
const loggable = (def, v) => (def.type === 'perks' && Array.isArray(v) ? `${v.length} perk(s)` : v);

export async function setSetting(db, key, value, { q: outer = null, version = null, reason = null } = {}) {
  const def = byKey.get(key);
  if (!def) throw new HttpError(404, 'Unknown setting');
  const clean = check(def, value);
  const stored = storageKey(key, version);
  const run = outer ? (fn) => fn(outer) : (fn) => db.tx(fn);
  await run(async (q) => {
    // 0.10.3: the value before the change goes in the log too (the Audit log shows before → after), and the reason when
    // the admin gave one (feature switches and visitor-affecting settings ask for it).
    const was = await q.one('SELECT value FROM settings WHERE key = $1', [stored]);
    const before = was ? was.value : environmentDefault(def.key, def.default);
    await q.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [stored, JSON.stringify(clean)],
    );
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('setting.changed', $1)", [JSON.stringify({
      key, value: loggable(def, clean), before: loggable(def, before), ...(why ? { reason: why } : {}), ...(stored !== key ? { version } : {}),
    })]);
    if (TIER_SETTING_KEYS.includes(key)) {
      const { requestTierRecompute } = await import('../tiers/store.js');
      await requestTierRecompute(q, `setting ${key}`);
    }
  });
}
