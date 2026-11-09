import { CATEGORY_RULES, present } from '../discovery/suggest.js';
import { guessValueType } from '../discovery/analyze.js';

/**
 * The production statistics catalog: what every page and leaderboard groups and labels statistics by.
 *
 * Statistics are DATA. Each one comes from Blizzard (a production crawl adds any id it hasn't seen to `statistics`;
 * recordStatistics below). Its category, grading and value type are the owner's decisions on the Discovery page
 * (discovery_decisions), and until there is one, the suggestion (discovery/suggest.js), computed exactly as the
 * Discovery page computes it. Nothing here names a statistic id, a name or a category.
 *
 *   loadCatalog(db) → { statistics: Map(id → Stat), categories: [{ label, farmable, order, statisticIds }] }
 *   Stat { id, name, categoryPath, category, categorySource ('decision' | 'suggestion' | 'blizzard'), farmable,
 *          grading ('overall' | 'category' | 'none'), gradingSource, valueType, named (name + number) }
 *
 * Kept in memory for CACHE_MS per process, so a decision on the Discovery page shows within a minute.
 */
export const CACHE_MS = 60_000;
const MAX_STATISTICS = 20_000;
const DECISION_KINDS = ['category', 'bad', 'grading', 'leaderboard', 'duplicate', 'value_type'];

/** The newest decision per statistic and kind: Map(statId → Map(kind → { value, decision, decidedAt })). */
export async function currentDecisions(db, statisticIds) {
  const rows = statisticIds.length
    ? await db.query(
      `SELECT DISTINCT ON (statistic_id, kind) statistic_id, kind, value, decision, decided_at
         FROM discovery_decisions WHERE statistic_id = ANY($1::bigint[])
        ORDER BY statistic_id, kind, decided_at DESC, id DESC LIMIT $2`,
      [statisticIds, MAX_STATISTICS * DECISION_KINDS.length],
    )
    : [];
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.statistic_id)) out.set(r.statistic_id, new Map());
    out.get(r.statistic_id).set(r.kind, { value: r.value, decision: r.decision, decidedAt: r.decided_at });
  }
  return out;
}

const RULE_ORDER = new Map(CATEGORY_RULES.map((r, i) => [r.label, i]));
const FARMABLE = new Set(CATEGORY_RULES.filter((r) => r.farmable).map((r) => r.label));

/** One statistic's effective classification, from its row (+ the discovery catalog's analysis) and its decisions. */
export function classify(row, discovery, decisions) {
  const base = {
    statisticId: row.id,
    name: row.name,
    endpoint: 'character.achievement-statistics',
    categoryPath: row.category_path ?? [],
    charactersSampled: discovery?.characters_sampled ?? 0,
    charactersPresent: discovery?.characters_present ?? 0,
    charactersNonzero: discovery?.characters_nonzero ?? 0,
    minValue: discovery?.min_value ?? null,
    maxValue: discovery?.max_value ?? null,
    hasText: Boolean(row.has_text),
    namedExample: discovery?.named_example ?? row.named_example ?? null,
    duplicate: discovery?.duplicate ?? null,
  };
  if (discovery) {
    Object.assign(base, { valueType: discovery.value_type, valueTypeBasis: discovery.value_type_basis, valueTypeGuessed: discovery.value_type_guessed });
  } else {
    const g = guessValueType(row.name, { namedExample: base.namedExample });
    Object.assign(base, { valueType: g.type, valueTypeBasis: g.basis, valueTypeGuessed: g.guessed });
  }
  const shown = present(base, decisions);
  const pick = (kind) => {
    const s = shown.suggestions.find((x) => x.kind === kind);
    const d = decisions.get(kind);
    if (d?.decision === 'approved') return { value: d.value, source: 'decision' };
    if (s && s.value !== null && s.decision !== 'rejected') return { value: s.value, source: 'suggestion' };
    return { value: null, source: null };
  };
  const cat = pick('category');
  const category = cat.value ?? base.categoryPath[0]?.name ?? 'Other';
  const grading = pick('grading');
  return {
    id: row.id,
    name: row.name,
    categoryPath: base.categoryPath,
    category,
    categorySource: cat.source ?? 'blizzard',
    farmable: FARMABLE.has(category),
    grading: grading.value ?? 'overall',
    gradingSource: grading.source ?? 'suggestion',
    valueType: shown.valueType,
    named: shown.valueType === 'name-and-number' || Boolean(row.has_text),
  };
}

let cache = null; // { at, value, db }

export function clearCatalogCache() {
  cache = null;
}

export async function loadCatalog(db, { now = Date.now } = {}) {
  if (cache && cache.db === db && now() - cache.at < CACHE_MS) return cache.value;
  const rows = await db.query('SELECT id, name, category_path, has_text, named_example FROM statistics ORDER BY id LIMIT $1', [MAX_STATISTICS]);
  const ids = rows.map((r) => r.id);
  const disc = ids.length ? await db.query('SELECT * FROM discovery_catalog WHERE statistic_id = ANY($1::bigint[]) LIMIT $2', [ids, MAX_STATISTICS]) : [];
  const discById = new Map(disc.map((d) => [d.statistic_id, d]));
  const decisions = await currentDecisions(db, ids);
  const statistics = new Map();
  for (const r of rows) statistics.set(r.id, classify(r, discById.get(r.id) ?? null, decisions.get(r.id) ?? new Map()));

  const byCat = new Map();
  for (const s of statistics.values()) {
    // A statistic whose name aged out of the 30-day window (no character returned it lately) has no values either:
    // it stays in the map (pins and decisions still point at its id) but isn't listed anywhere.
    if (s.name === null) continue;
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }
  const categories = [...byCat.entries()]
    .map(([label, list]) => ({
      label,
      farmable: FARMABLE.has(label),
      graded: list.some((s) => s.grading !== 'none'),
      statisticIds: list.sort((a, b) => a.name.localeCompare(b.name)).map((s) => s.id),
    }))
    .sort((a, b) => (RULE_ORDER.get(a.label) ?? 999) - (RULE_ORDER.get(b.label) ?? 999) || a.label.localeCompare(b.label));
  // The rules' order suits the Discovery page; a player reads achievements first: categories that count toward the
  // overall tier, then the farmable ones (their own tier only), then those where nothing is graded (deaths & mishaps).
  const band = (c) => (!c.graded ? 2 : c.farmable ? 1 : 0);
  categories.sort((a, b) => band(a) - band(b));
  const value = { statistics, categories };
  cache = { at: now(), value, db };
  return value;
}

/** A URL-safe id for a category label ("Deaths & mishaps" → "deaths-mishaps"), for /leaderboards#… anchors. */
export const categoryKey = (label) => String(label).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

/**
 * Adds every statistic in `parsed` (crawler/parse.js statistics) to the catalog, or refreshes its name and category
 * path. A statistic id seen for the first time appears on the Discovery page's combined catalog at once.
 */
export async function recordStatistics(q, parsed) {
  if (!parsed.length) return 0;
  const ids = parsed.map((s) => s.id);
  const known = new Set((await q.query('SELECT id FROM statistics WHERE id = ANY($1::bigint[])', [ids])).map((r) => r.id));
  let added = 0;
  for (const s of parsed) {
    if (known.has(s.id)) continue;
    await q.query(
      `INSERT INTO statistics (id, name, category_path, has_text, named_example) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name.slice(0, 200), JSON.stringify(s.categoryPath), s.text !== null, s.text !== null ? `${s.text.slice(0, 60)}, ${s.value}` : null],
    );
    added += 1;
  }
  // Names and categories can be corrected by a patch: refresh them, at most once per statistic per hour.
  await q.query(
    `UPDATE statistics s SET name = v.name, category_path = v.path::jsonb, last_seen_at = now(),
            has_text = s.has_text OR v.has_text
       FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS name, unnest($3::text[]) AS path, unnest($4::boolean[]) AS has_text) v
      WHERE s.id = v.id AND s.last_seen_at < now() - interval '1 hour'`,
    [ids, parsed.map((s) => s.name.slice(0, 200)), parsed.map((s) => JSON.stringify(s.categoryPath)), parsed.map((s) => s.text !== null)],
  );
  if (added) clearCatalogCache();
  return added;
}
