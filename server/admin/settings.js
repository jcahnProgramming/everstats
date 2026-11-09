import { HttpError } from '../core/errors.js';

/**
 * The admin settings registry. Every setting declares itself here; the admin page renders whatever is declared and
 * the store refuses anything undeclared. A missing row in `settings` means the declared default.
 *
 *   key, section ('grading' | 'discovery': which admin panel shows it), label, help, type ('integer'), min, max, default
 */
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
];

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));

function check(def, value) {
  if (def.type === 'integer') {
    if (!Number.isInteger(value)) throw new HttpError(400, `${def.label} must be a whole number`, 'invalid');
    if (value < def.min || value > def.max) throw new HttpError(400, `${def.label} must be between ${def.min} and ${def.max}`, 'invalid');
  }
  return value;
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
  check(def, value);
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('setting.changed', $1)", [JSON.stringify({ key, value })]);
  });
}
