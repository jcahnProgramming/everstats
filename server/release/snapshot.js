import { HttpError } from '../core/errors.js';
import { APP_VERSION } from '../core/version.js';
import { PRIMARY_VERSION, REGIONS, regionById, versionById } from '../core/gameVersions.js';

/**
 * Release tools snapshots (0.10.3): the checks of scripts/forever-fingerprint.sql, for ONE game version and region,
 * stored so a later snapshot can be compared with it from the admin page instead of a terminal.
 *
 *   release_snapshots      the label row (ours): label, game version, region, app version, time, the checklist run
 *   release_snapshot_data  the fingerprint (Blizzard-derived: counts, hashes, the top boards, the sample character);
 *                          swept after the retention window like every Blizzard table. The label row stays and the page
 *                          says the data aged out.
 *
 * What is checked (every query scoped to the version's characters / realm categories, every result bounded):
 *   characters   how many are tracked, fetched and hidden; a hash of the SET of their ids
 *   rulesets     the realm categories and their names
 *   values       every statistic value of those characters (count + hash)
 *   boards       per ruleset, the ten most-populated boards: statistic, population, top value
 *   gains        weekly / rolling gains per period (count + hash)
 *   tiers        the letter distribution per ruleset; hashes of every character's letter + score, of letters alone, and
 *                of every category tier
 *   plans        what each ruleset was last graded with (hash of the counted statistics and categories), its population
 *   guildTotals  every guild total of the version's guilds (count + hash)
 *   sample       the primary version's sample character (path-vexley): level, ruleset, guild, letter, score, values hash
 *   against      for each earlier snapshot of the same scope that still has data (newest 3), the same checks over only
 *                the characters that were tracked when IT was taken. That is how a compare can say "the only change is
 *                new characters": if that set's ids hash equals the earlier snapshot's, the existing characters are
 *                exactly the earlier ones, and their values and letters can be compared row-for-row by hash.
 *
 * Hashes are order-independent (a sum of per-row md5 prefixes, then md5 of count:sum), so nothing has to be sorted or
 * held in memory: the database reads each table once. A hash that differs says SOMETHING in that set changed; it can't
 * say which rows, and the compare says so.
 */
export const SAMPLE_SLUG = 'path-vexley';
// The sample character lives on the primary version in the primary region (the first enabled one in the registry).
export const PRIMARY_REGION = REGIONS.find((g) => g.enabled)?.id ?? REGIONS[0].id;
const AGAINST_MAX = 3;
const BOARDS_PER_RULESET = 10;

/** SQL for an order-independent hash of the rows' `expr` text: { n, hash }. */
const HASH = (expr) => `count(*)::int AS n, md5(count(*)::text || ':' || coalesce(sum(('x' || substr(md5(${expr}), 1, 15))::bit(60)::bigint), 0)::text) AS hash`;
const pair = (row) => ({ n: Number(row?.n ?? 0), hash: row?.hash ?? null });

export function checkScope(version, region) {
  if (!versionById(version)) throw new HttpError(400, 'Unknown game version', 'invalid');
  if (!regionById(region)) throw new HttpError(400, 'Unknown region', 'invalid');
  return { version, region };
}

export function checkLabel(label) {
  const text = typeof label === 'string' ? label.split(/\s+/).filter(Boolean).join(' ') : '';
  if (text.length < 1 || text.length > 80) throw new HttpError(400, 'Give the snapshot a label (1–80 characters), e.g. “before 0.11.0”.', 'label_required');
  if (/[<>]/.test(text)) throw new HttpError(400, 'A label is plain text.', 'invalid');
  return text;
}

/** The checks over the scope's characters, optionally only those tracked by `trackedBy` (an earlier snapshot's time). */
async function scopedChecks(q, { version, region, trackedBy = null }) {
  const cond = 'c.game_version = $1 AND c.region = $2' + (trackedBy ? ' AND c.tracked_since <= $3' : '');
  const p = trackedBy ? [version, region, trackedBy] : [version, region];
  const ids = pair(await q.one(`SELECT ${HASH("c.id::text")} FROM characters c WHERE ${cond}`, p));
  const values = pair(await q.one(
    `SELECT ${HASH("cs.character_id || ':' || cs.statistic_id || '=' || cs.value || '@' || cs.ruleset_id")}
       FROM character_statistics cs JOIN characters c ON c.id = cs.character_id WHERE ${cond}`, p,
  ));
  const letters = pair(await q.one(
    `SELECT ${HASH("t.character_id || ':' || coalesce(t.letter, '-')")} FROM character_tiers t JOIN characters c ON c.id = t.character_id WHERE ${cond}`, p,
  ));
  return { ids, values, letters };
}

/** Takes the fingerprint now (read-only). → the data object stored in release_snapshot_data. */
export async function fingerprint(q, { version, region, against = [] }) {
  const counts = await q.one(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE stats_fetched_at IS NOT NULL)::int AS fetched, count(*) FILTER (WHERE hidden)::int AS hidden
       FROM characters c WHERE c.game_version = $1 AND c.region = $2`,
    [version, region],
  );
  const rulesets = (await q.query('SELECT id, name FROM rulesets WHERE game_version = $1 AND region = $2 ORDER BY id LIMIT 400', [version, region]))
    .map((r) => ({ id: Number(r.id), name: r.name }));
  const rids = rulesets.map((r) => r.id);
  const own = await scopedChecks(q, { version, region });
  const boards = (await q.query(
    `SELECT b.ruleset_id, b.statistic_id, b.n, b.top, s.name FROM (
        SELECT cs.ruleset_id, cs.statistic_id, count(*)::int AS n, max(cs.value) AS top,
               row_number() OVER (PARTITION BY cs.ruleset_id ORDER BY count(*) DESC, cs.statistic_id) AS k
          FROM character_statistics cs
         WHERE cs.ruleset_id = ANY($1::int[]) AND NOT cs.hidden AND cs.value > 0
         GROUP BY cs.ruleset_id, cs.statistic_id) b
       LEFT JOIN statistics s ON s.id = b.statistic_id
      WHERE b.k <= $2 ORDER BY b.ruleset_id, b.k LIMIT 4000`,
    [rids, BOARDS_PER_RULESET],
  )).map((r) => ({ ruleset: Number(r.ruleset_id), statistic: String(r.statistic_id), name: r.name ?? null, n: Number(r.n), top: Number(r.top) }));
  const gains = (await q.query(
    `SELECT g.period, ${HASH("g.period || ':' || g.character_id || ':' || g.statistic_id || '=' || g.gain")}
       FROM stat_gains g JOIN characters c ON c.id = g.character_id
      WHERE c.game_version = $1 AND c.region = $2 GROUP BY g.period ORDER BY g.period LIMIT 20`,
    [version, region],
  )).map((r) => ({ period: r.period, n: Number(r.n), hash: r.hash }));
  const dist = await q.query(
    `SELECT ruleset_id, coalesce(letter, '-') AS letter, count(*)::int AS n FROM character_tiers
      WHERE ruleset_id = ANY($1::int[]) GROUP BY ruleset_id, letter ORDER BY ruleset_id, letter LIMIT 4000`,
    [rids],
  );
  const distribution = {};
  for (const r of dist) (distribution[Number(r.ruleset_id)] ??= {})[r.letter] = Number(r.n);
  const tierHash = pair(await q.one(
    `SELECT ${HASH("character_id || ':' || coalesce(letter, '-') || ':' || coalesce(round(score::numeric, 6)::text, '-')")} FROM character_tiers WHERE ruleset_id = ANY($1::int[])`,
    [rids],
  ));
  const categoryHash = pair(await q.one(
    `SELECT ${HASH("character_id || ':' || category_key || ':' || coalesce(letter, '-') || ':' || coalesce(round(score::numeric, 6)::text, '-')")}
       FROM character_category_tiers WHERE ruleset_id = ANY($1::int[])`,
    [rids],
  ));
  const plans = (await q.query(
    `SELECT ruleset_id, md5(coalesce(plan->'statisticIds', 'null'::jsonb)::text || coalesce(plan->'categories', 'null'::jsonb)::text) AS hash, population, graded
       FROM tier_rulesets WHERE ruleset_id = ANY($1::int[]) ORDER BY ruleset_id LIMIT 400`,
    [rids],
  )).map((r) => ({ ruleset: Number(r.ruleset_id), hash: r.hash, population: Number(r.population), graded: r.graded }));
  const guildTotals = pair(await q.one(
    `SELECT ${HASH("gt.guild_id || ':' || gt.statistic_id || ':' || gt.period || '=' || gt.total")}
       FROM guild_totals gt JOIN guilds g ON g.id = gt.guild_id WHERE g.game_version = $1 AND g.region = $2`,
    [version, region],
  ));
  let sample;
  if (version !== PRIMARY_VERSION.id || region !== PRIMARY_REGION) {
    sample = { slug: null, none: 'There is no sample character on this version.' };
  } else {
    const c = await q.one(
      `SELECT c.id, c.level, c.ruleset_id, c.guild_id, t.letter, round(t.score::numeric, 6)::float8 AS score
         FROM characters c LEFT JOIN character_tiers t ON t.character_id = c.id
        WHERE c.game_version = $1 AND c.region = $2 AND c.slug = $3 LIMIT 1`,
      [version, region, SAMPLE_SLUG],
    );
    sample = c
      ? {
          slug: SAMPLE_SLUG, found: true, id: String(c.id), level: c.level ?? null, ruleset: c.ruleset_id === null ? null : Number(c.ruleset_id),
          guild: c.guild_id === null ? null : String(c.guild_id), letter: c.letter ?? null, score: c.score ?? null,
          values: await sampleValues(q, c.id),
        }
      : { slug: SAMPLE_SLUG, found: false };
  }
  const againstOut = {};
  for (const a of against) {
    againstOut[a.id] = { takenAt: a.takenAt, ...(await scopedChecks(q, { version, region, trackedBy: a.takenAt })) };
  }
  return {
    schema: 1,
    scope: { version, region },
    characters: { total: counts.total, fetched: counts.fetched, hidden: counts.hidden, ids: own.ids },
    rulesets,
    values: own.values,
    boards,
    gains,
    tiers: { distribution, hash: tierHash, letters: own.letters, categories: categoryHash },
    plans,
    guildTotals,
    sample,
    against: againstOut,
  };
}

async function sampleValues(q, id) {
  return pair(await q.one(`SELECT ${HASH("statistic_id || '=' || value")} FROM character_statistics WHERE character_id = $1`, [id]));
}

/** Takes and stores a labelled snapshot. → the list row of the new snapshot. Logs release.snapshot. */
export async function takeSnapshot(db, { label, version, region, runId = null }) {
  const clean = checkLabel(label);
  checkScope(version, region);
  const earlier = (await db.query(
    `SELECT s.id, s.taken_at FROM release_snapshots s JOIN release_snapshot_data d ON d.snapshot_id = s.id
      WHERE s.game_version = $1 AND s.region = $2 ORDER BY s.taken_at DESC, s.id DESC LIMIT $3`,
    [version, region, AGAINST_MAX],
  )).map((r) => ({ id: String(r.id), takenAt: new Date(r.taken_at).toISOString() }));
  // REPEATABLE READ: every check sees the same moment, so a crawl write between two queries can't split a snapshot.
  const data = await db.tx(async (q) => {
    await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return fingerprint(q, { version, region, against: earlier });
  });
  return db.tx(async (q) => {
    const row = await q.one(
      `INSERT INTO release_snapshots (label, game_version, region, app_version, run_id) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, label, game_version, region, app_version, run_id, taken_at`,
      [clean, version, region, APP_VERSION, runId],
    );
    await q.query('INSERT INTO release_snapshot_data (snapshot_id, taken_at, data) VALUES ($1, $2, $3::jsonb)', [row.id, row.taken_at, JSON.stringify(data)]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('release.snapshot', $1::jsonb)", [JSON.stringify({
      snapshot: String(row.id), label: clean, version, region, ...(runId ? { run: String(runId) } : {}),
    })]);
    return listRow({ ...row, has_data: true, characters: data.characters.total, run_kind: null });
  });
}

const listRow = (r) => ({
  id: String(r.id), label: r.label, version: r.game_version, region: r.region, appVersion: r.app_version,
  runId: r.run_id === null || r.run_id === undefined ? null : String(r.run_id), runKind: r.run_kind ?? null,
  takenAt: r.taken_at, hasData: Boolean(r.has_data), characters: r.characters === null || r.characters === undefined ? null : Number(r.characters),
});

/** Snapshots of one scope, newest first, cursor = the last id seen. */
export async function listSnapshots(db, { version, region, before = null, limit = 20 }) {
  const rows = await db.query(
    `SELECT s.id, s.label, s.game_version, s.region, s.app_version, s.run_id, s.taken_at, r.kind AS run_kind,
            (d.snapshot_id IS NOT NULL) AS has_data, (d.data->'characters'->>'total') AS characters
       FROM release_snapshots s LEFT JOIN release_snapshot_data d ON d.snapshot_id = s.id LEFT JOIN release_runs r ON r.id = s.run_id
      WHERE s.game_version = $1 AND s.region = $2 AND ($3::bigint IS NULL OR s.id < $3)
      ORDER BY s.id DESC LIMIT $4`,
    [version, region, before, limit + 1],
  );
  const page = rows.slice(0, limit).map(listRow);
  return { snapshots: page, next: rows.length > limit ? page[page.length - 1].id : null };
}

async function loadSnapshot(db, id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) throw new HttpError(400, 'Which snapshot?', 'invalid');
  const row = await db.one(
    `SELECT s.id, s.label, s.game_version, s.region, s.app_version, s.run_id, s.taken_at, r.kind AS run_kind, d.data, (d.snapshot_id IS NOT NULL) AS has_data
       FROM release_snapshots s LEFT JOIN release_snapshot_data d ON d.snapshot_id = s.id LEFT JOIN release_runs r ON r.id = s.run_id WHERE s.id = $1`,
    [id],
  );
  if (!row) throw new HttpError(404, 'No such snapshot');
  return { ...listRow(row), data: row.data ?? null };
}

export async function getSnapshot(db, id) {
  return loadSnapshot(db, id);
}

// ---------------------------------------------------------------- compare

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const signed = (d) => (d > 0 ? `up by ${fmt(d)}` : `down by ${fmt(-d)}`);
const LINE_MAX = 40;

function capped(lines) {
  if (lines.length <= LINE_MAX) return lines;
  return [...lines.slice(0, LINE_MAX), `…and ${fmt(lines.length - LINE_MAX)} more`];
}

/**
 * Compares two snapshots (the older is "before" whatever order they are given in). → { identical, a, b, sections,
 * summary, onlyNewCharacters }. Each section: { id, label, same, lines: [plain sentences] }.
 */
export function compareData(A, B) {
  const sections = [];
  const add = (id, label, same, lines) => sections.push({ id, label, same, lines: same ? [] : capped(lines) });
  const rsName = new Map([...(A.rulesets ?? []), ...(B.rulesets ?? [])].map((r) => [r.id, r.name]));
  const rn = (id) => rsName.get(Number(id)) ?? `ruleset ${id}`;
  const link = B.against?.[A.id] ?? null; // the "existing characters" checks B took for A, when it could

  // Characters.
  {
    const a = A.data.characters;
    const b = B.data.characters;
    const lines = [];
    for (const [k, word] of [['total', 'Tracked characters'], ['fetched', 'Fetched characters'], ['hidden', 'Hidden characters']]) {
      if (a[k] !== b[k]) lines.push(`${word}: ${fmt(a[k])} → ${fmt(b[k])} (${signed(b[k] - a[k])}).`);
    }
    const same = lines.length === 0 && a.ids?.hash === b.ids?.hash;
    if (lines.length === 0 && !same) lines.push('The same number of characters, but not the same characters (the set of ids differs).');
    add('characters', 'Characters', same, lines);
  }
  // Realm categories.
  {
    const a = new Map(A.data.rulesets.map((r) => [r.id, r.name]));
    const b = new Map(B.data.rulesets.map((r) => [r.id, r.name]));
    const lines = [];
    for (const [id, name] of b) if (!a.has(id)) lines.push(`New: ${name} (${id}).`);
    for (const [id, name] of a) if (!b.has(id)) lines.push(`Gone: ${name} (${id}).`);
    for (const [id, name] of b) if (a.has(id) && a.get(id) !== name) lines.push(`Renamed: ${a.get(id)} → ${name}.`);
    add('rulesets', 'Rulesets', lines.length === 0, lines);
  }
  // Values.
  {
    const a = A.data.values;
    const b = B.data.values;
    const same = a.hash === b.hash && a.n === b.n;
    const lines = [];
    if (!same) {
      lines.push(a.n === b.n ? `${fmt(b.n)} statistic values in both, but the values hash differs: some values changed. A hash can’t say which rows.`
        : `Statistic values: ${fmt(a.n)} → ${fmt(b.n)} (${signed(b.n - a.n)}); the values hash differs.`);
      lines.push(existingLine(link, A.data, 'values', 'statistic values'));
    }
    add('values', 'Statistic values', same, lines);
  }
  // Boards.
  {
    const key = (x) => `${x.ruleset}:${x.statistic}`;
    const a = new Map(A.data.boards.map((x) => [key(x), x]));
    const b = new Map(B.data.boards.map((x) => [key(x), x]));
    const lines = [];
    let grew = 0;
    let other = 0;
    const label = (x) => `${rn(x.ruleset)} · ${x.name ?? `statistic ${x.statistic}`}`;
    for (const [k, x] of b) {
      const was = a.get(k);
      if (!was) {
        lines.push(`${label(x)}: now one of the ten most-populated boards (${fmt(x.n)} ranked, top ${fmt(x.top)}).`);
        other += 1;
      } else if (was.n !== x.n || was.top !== x.top) {
        const parts = [];
        if (was.n !== x.n) parts.push(`population ${fmt(was.n)} → ${fmt(x.n)}`);
        if (was.top !== x.top) parts.push(`top value ${fmt(was.top)} → ${fmt(x.top)}`);
        lines.push(`${label(x)}: ${parts.join(', ')}.`);
        if (x.n > was.n && was.top === x.top) grew += 1;
        else other += 1;
      }
    }
    for (const [k, x] of a) {
      if (!b.has(k)) {
        lines.push(`${label(x)}: no longer one of the ten most-populated boards.`);
        other += 1;
      }
    }
    if (lines.length && grew && !other) lines.unshift(`${fmt(grew)} board(s) only grew: more characters ranked, same top value.`);
    add('boards', 'Boards (ten most-populated per ruleset)', lines.length === 0, lines);
  }
  // Gains.
  {
    const a = new Map(A.data.gains.map((g) => [g.period, g]));
    const b = new Map(B.data.gains.map((g) => [g.period, g]));
    const lines = [];
    for (const p of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(p);
      const y = b.get(p);
      if (!x || !y) lines.push(`${p}: ${x ? `${fmt(x.n)} gains → none` : `none → ${fmt(y.n)} gains`}.`);
      else if (x.hash !== y.hash) lines.push(`${p}: ${x.n === y.n ? `${fmt(y.n)} gains, but some changed` : `${fmt(x.n)} → ${fmt(y.n)} gains`}.`);
    }
    add('gains', 'Weekly and rolling gains', lines.length === 0, lines);
  }
  // Tiers.
  {
    const lines = [];
    const da = A.data.tiers.distribution ?? {};
    const db = B.data.tiers.distribution ?? {};
    for (const rs of new Set([...Object.keys(da), ...Object.keys(db)])) {
      const x = da[rs] ?? {};
      const y = db[rs] ?? {};
      const changes = [];
      for (const l of ['S', 'A', 'B', 'C', 'D', '-']) {
        if ((x[l] ?? 0) !== (y[l] ?? 0)) changes.push(`${l === '-' ? 'Unranked' : l} ${fmt(x[l] ?? 0)} → ${fmt(y[l] ?? 0)}`);
      }
      if (changes.length) lines.push(`${rn(rs)}: ${changes.join(', ')}.`);
    }
    const hashSame = A.data.tiers.hash.hash === B.data.tiers.hash.hash;
    if (!hashSame) {
      if (!lines.length) lines.push('Same letter counts, but some characters’ letters or scores differ (a hash can’t say whose).');
      lines.push(existingLine(link, A.data, 'letters', 'letters'));
    }
    const catSame = A.data.tiers.categories.hash === B.data.tiers.categories.hash;
    if (!catSame) lines.push(`Category tiers: ${fmt(A.data.tiers.categories.n)} → ${fmt(B.data.tiers.categories.n)} rows; the category-tier hash differs.`);
    add('tiers', 'Tiers', lines.length === 0 && hashSame && catSame, lines);
  }
  // Grading plans.
  {
    const a = new Map(A.data.plans.map((p) => [p.ruleset, p]));
    const b = new Map(B.data.plans.map((p) => [p.ruleset, p]));
    const lines = [];
    for (const rs of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(rs);
      const y = b.get(rs);
      if (!x || !y) { lines.push(`${rn(rs)}: ${x ? 'no longer graded' : 'graded for the first time'}.`); continue; }
      if (x.hash !== y.hash) lines.push(`${rn(rs)}: what counts changed (the statistics or categories it was graded with).`);
      if (x.population !== y.population) lines.push(`${rn(rs)}: tier-eligible population ${fmt(x.population)} → ${fmt(y.population)}.`);
      if (x.graded !== y.graded) lines.push(`${rn(rs)}: ${y.graded ? 'now graded' : 'no longer graded (below the minimum)'}.`);
    }
    add('plans', 'What counts toward tiers', lines.length === 0, lines);
  }
  // Guild totals.
  {
    const a = A.data.guildTotals;
    const b = B.data.guildTotals;
    const same = a.hash === b.hash;
    add('guildTotals', 'Guild totals', same, same ? [] : [a.n === b.n ? `${fmt(b.n)} guild totals, but some changed.` : `Guild totals: ${fmt(a.n)} → ${fmt(b.n)}; the totals hash differs.`]);
  }
  // The sample character.
  {
    const a = A.data.sample;
    const b = B.data.sample;
    const lines = [];
    if (!a?.slug && !b?.slug) {
      add('sample', 'Sample character', true, []);
    } else if (!a?.found || !b?.found) {
      if (Boolean(a?.found) !== Boolean(b?.found)) lines.push(a?.found ? `${SAMPLE_SLUG} is no longer tracked.` : `${SAMPLE_SLUG} is tracked now.`);
      add('sample', `Sample character (${SAMPLE_SLUG})`, lines.length === 0, lines);
    } else {
      for (const [k, word] of [['id', 'Id'], ['level', 'Level'], ['ruleset', 'Ruleset'], ['guild', 'Guild'], ['letter', 'Letter'], ['score', 'Score']]) {
        if (a[k] !== b[k]) lines.push(`${word}: ${a[k] ?? '—'} → ${b[k] ?? '—'}.`);
      }
      if (a.values?.hash !== b.values?.hash) lines.push(`Statistic values: ${fmt(a.values?.n)} → ${fmt(b.values?.n)}; some changed.`);
      add('sample', `Sample character (${SAMPLE_SLUG})`, lines.length === 0, lines);
    }
  }

  const identical = sections.every((s) => s.same);
  const charsUp = B.data.characters.total - A.data.characters.total;
  const existing = existingState(link, A.data);
  // "Only new characters": more characters, the earlier set unchanged in ids, values and letters; nothing structural moved.
  const structural = sections.filter((s) => !s.same && ['rulesets', 'plans', 'sample'].includes(s.id) && !(s.id === 'plans' && onlyPopulation(A.data.plans, B.data.plans)));
  const onlyNew = !identical && charsUp > 0 && existing.known && existing.values && existing.letters && structural.length === 0;
  let summary;
  if (identical) summary = 'Identical: every check matches.';
  else if (onlyNew) summary = `The difference is new characters: ${fmt(charsUp)} more tracked. Every character in the earlier snapshot has the same statistic values and the same letter; board populations and letter counts moved because the new characters joined them.`;
  else if (!existing.known) summary = `${sections.filter((s) => !s.same).length} check(s) differ. ${existing.why}`;
  else summary = `${sections.filter((s) => !s.same).length} check(s) differ, and not only because of new characters: ${[!existing.values && 'existing characters’ values changed', !existing.letters && 'existing characters’ letters changed', ...structural.map((s) => s.label.toLowerCase() + ' changed')].filter(Boolean).join('; ')}.`;
  return { identical, onlyNewCharacters: onlyNew, summary, sections };
}

function onlyPopulation(a, b) {
  const x = new Map(a.map((p) => [p.ruleset, p]));
  return b.length === a.length && b.every((p) => x.has(p.ruleset) && x.get(p.ruleset).hash === p.hash && x.get(p.ruleset).graded === p.graded);
}

function existingState(link, A) {
  if (!link) return { known: false, why: 'The later snapshot didn’t record which characters existed at the earlier one (it was taken before it, or the earlier one’s data had aged out), so changed rows can’t be told from new ones.' };
  if (link.ids.hash !== A.characters.ids.hash) return { known: false, why: 'The characters tracked at the earlier snapshot aren’t exactly the same set any more (some left or were re-keyed), so changed rows can’t be told from new ones.' };
  return { known: true, values: link.values.hash === A.values.hash, letters: link.letters.hash === A.tiers.letters.hash };
}

function existingLine(link, A, what, words) {
  const st = existingState(link, A);
  if (!st.known) return st.why;
  const same = what === 'values' ? st.values : st.letters;
  return same
    ? `Every character from the earlier snapshot has the same ${words}: the difference is in characters tracked since.`
    : `Some characters from the earlier snapshot have different ${words} (a hash can’t say which).`;
}

/** Compares two stored snapshots and logs release.compared. */
export async function compareSnapshots(db, aId, bId, { runId = null, log = true } = {}) {
  let a = await loadSnapshot(db, aId);
  let b = await loadSnapshot(db, bId);
  if (a.id === b.id) throw new HttpError(400, 'Pick two different snapshots.', 'invalid');
  for (const s of [a, b]) if (!s.data) throw new HttpError(409, `“${s.label}”: its data aged out (30-day rule), so it can’t be compared.`, 'aged_out');
  if (new Date(a.takenAt) > new Date(b.takenAt)) [a, b] = [b, a];
  const scopeNote = a.version !== b.version || a.region !== b.region ? 'These snapshots are of different game versions or regions: they were never meant to match.' : null;
  const result = compareData({ id: a.id, data: a.data, rulesets: a.data.rulesets }, { id: b.id, data: b.data, rulesets: b.data.rulesets, against: b.data.against });
  const strip = ({ data, ...rest }) => rest;
  if (log) {
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('release.compared', $1::jsonb)", [JSON.stringify({
      identical: result.identical, a: a.id, b: b.id, ...(runId ? { run: String(runId) } : {}),
    })]);
  }
  return { ...result, a: strip(a), b: strip(b), appChanged: a.appVersion !== b.appVersion, scopeNote };
}
