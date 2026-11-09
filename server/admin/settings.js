import { HttpError } from '../core/errors.js';
import { DEFAULT_SHARES, TIER_LETTERS, sharesProblem } from '../stats/tiers.js';
import { BETA_PERK_TEXT } from '../badges/catalog.js';

/**
 * The admin settings registry. Every setting declares itself here; the admin page renders whatever is declared and
 * the store refuses anything undeclared. A missing row in `settings` means the declared default.
 *
 *   key, section ('grading' | 'tiers' | 'discovery' | 'crawler' | 'beta': which admin panel shows it), label, help, type, default
 *   type 'integer'  (min, max)
 *        'percent'  a whole percent (min, max), shown with a % sign
 *        'shares'   the five letter shares { S, A, B, C, D }, whole percents adding up to 100
 *        'boolean'
 *        'perks'    a short list of { title, description } (the beta page's perks), at most PERKS_MAX items
 *        'window'   null, or { start, end } as UTC calendar dates 'YYYY-MM-DD', both days included (0.7.0)
 */
export const PERKS_MAX = 12;
export const SETTINGS = [
  {
    // 0.6.0: tiers (server/tiers/). The default fell from 500 to 50 (owner's decision for tiers). A value saved on the
    // admin page before 0.6.0 stays what it was.
    key: 'grading.minPopulation',
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
    section: 'tiers',
    label: 'Letter shares',
    help: 'What share of a ruleset gets each letter, best first. The same shares apply to every category tier and the overall tier. They must add up to 100.',
    type: 'shares',
    default: { ...DEFAULT_SHARES },
  },
  {
    key: 'tiers.categoryHalf',
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
    section: 'tiers',
    label: 'Share of the overall categories a character needs a letter in',
    help: 'A character gets an overall letter only with a letter in at least this share (rounded up) of the categories that count toward the overall tier.',
    type: 'percent',
    min: 1,
    max: 100,
    default: 50,
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
    key: 'crawler.paused',
    section: 'crawler',
    label: 'Pause the background crawl',
    help: 'Stops the daily refresh and roster expansion. Lookups, sign-ins and their auto-fetch still run, because a person is waiting on them.',
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
    // Blizzard's 30-day rule (retention/policy.js). Above 30 only with a written-permission note, which is logged.
    key: 'retention.window',
    section: 'retention',
    label: 'Blizzard data retention window (days)',
    help: 'Blizzard’s API terms require a maximum 30-day lifespan for all data from the API. Raise this only if Blizzard has given written permission, and record that permission here.',
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
];

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));

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
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') throw new HttpError(400, `${def.label} must be on or off`, 'invalid');
    return value;
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

export async function getSetting(db, key) {
  const def = byKey.get(key);
  if (!def) throw new Error(`unknown setting ${key}`);
  const row = await db.one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : def.default;
}

export async function listSettings(db) {
  const rows = await db.query('SELECT key, value, updated_at FROM settings WHERE key = ANY($1) LIMIT 200', [SETTINGS.map((s) => s.key)]);
  const stored = new Map(rows.map((r) => [r.key, r]));
  return SETTINGS.map((def) => ({
    key: def.key,
    section: def.section,
    label: def.label,
    help: def.help,
    type: def.type,
    min: def.min,
    max: def.max,
    default: def.default,
    value: stored.has(def.key) ? stored.get(def.key).value : def.default,
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
export const TIER_SETTING_KEYS = Object.freeze(['grading.minPopulation', 'tiers.shares', 'tiers.categoryHalf', 'tiers.overallHalf']);

export async function setSetting(db, key, value, { q: outer = null } = {}) {
  const def = byKey.get(key);
  if (!def) throw new HttpError(404, 'Unknown setting');
  const clean = check(def, value);
  const run = outer ? (fn) => fn(outer) : (fn) => db.tx(fn);
  await run(async (q) => {
    await q.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(clean)],
    );
    const logged = def.type === 'perks' ? `${clean.length} perk(s)` : clean;
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('setting.changed', $1)", [JSON.stringify({ key, value: logged })]);
    if (TIER_SETTING_KEYS.includes(key)) {
      const { requestTierRecompute } = await import('../tiers/store.js');
      await requestTierRecompute(q, `setting ${key}`);
    }
  });
}
