import { HttpError } from '../core/errors.js';

/**
 * The admin settings registry. Every setting declares itself here; the admin page renders whatever is declared and
 * the store refuses anything undeclared. A missing row in `settings` means the declared default.
 *
 *   key, section ('grading' | 'discovery' | 'crawler' | 'beta': which admin panel shows it), label, help, type, default
 *   type 'integer'  (min, max)
 *        'boolean'
 *        'perks'    a short list of { title, description } (the beta page's perks), at most PERKS_MAX items
 */
export const PERKS_MAX = 12;
export const SETTINGS = [
  {
    key: 'grading.minPopulation',
    section: 'grading',
    label: 'Minimum tracked characters before a ruleset is graded',
    help: 'Until a ruleset has this many tracked characters it shows "Unranked — grading opens at N tracked characters" instead of tiers. Leaderboards still show.',
    type: 'integer',
    min: 1,
    max: 10_000_000,
    default: 500,
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
      { title: 'Beta Tester badge', description: 'Every account created while the beta is open will receive the Beta Tester badge when badges launch.' },
    ],
  },
];

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));

function check(def, value) {
  if (def.type === 'integer') {
    if (!Number.isInteger(value)) throw new HttpError(400, `${def.label} must be a whole number`, 'invalid');
    if (value < def.min || value > def.max) throw new HttpError(400, `${def.label} must be between ${def.min} and ${def.max}`, 'invalid');
    return value;
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

export async function setSetting(db, key, value) {
  const def = byKey.get(key);
  if (!def) throw new HttpError(404, 'Unknown setting');
  const clean = check(def, value);
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(clean)],
    );
    const logged = def.type === 'perks' ? `${clean.length} perk(s)` : clean;
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('setting.changed', $1)", [JSON.stringify({ key, value: logged })]);
  });
}
