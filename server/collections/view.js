import { rankOn } from '../stats/boards.js';
import { catalogMap, catalogTotals } from './catalog.js';
import { legacyAccountWide, legacyOf, legacyPointsOf } from './legacy.js';
import { COUNTS, KINDS, SLOT_GROUPS, familyOf, kindById, slotGroup, slotLabels } from './registry.js';
import { achievementCatalog, collectionsOf, sharedKindsOf, sharingEvidence } from './store.js';
import { scopeSql } from '../core/config.js';
/**
 * 0.10.0: catalogs are per game version and region (a static namespace is one version's build in one region). In this
 * build only the PRIMARY scope's catalogs are built and read (the catalogs job and every collections page are the primary
 * version's); every statement names that scope, so another version's rows can never be read here. Building catalogs
 * per version arrives with the version itself (0.11.0).
 */
const CATALOG_SCOPE = scopeSql();
const CATALOG_SCOPE_S = scopeSql('s');


/**
 * What the Collections tab and its screens are sent (0.9.0). Only what Blizzard returned, merged with Blizzard's static
 * catalogs where they exist (so "missing" is real: listed by Blizzard, not on this character). Each section carries its
 * own state and dates: 'ok' | 'empty' (Blizzard returned none) | 'not_returned' (with the status and the last good copy's
 * date, when there is one) | 'never' (not fetched yet).
 *
 * Account-wide ("Shared across this account") is said only when it is known:
 *   detected  every fetched character of this character's owner has the identical collection (collection_sharing)
 *   stated    Blizzard says so (achievements' is_account_wide; Legacy Points when every granting achievement does)
 */
const sectionState = (row) => (row ? { state: row.state, status: row.status, fetchedAt: row.fetchedAt, checkedAt: row.checkedAt } : { state: 'never', status: null, fetchedAt: null, checkedAt: null });

/** The account marker for one count on one character, or null. */
function sharedFor(count, { sharedKinds, achievements, legacyWide }) {
  if (count.shared === 'detected') return sharedKinds.has(count.kind) ? { how: 'detected' } : null;
  if (count.key === 'legacy') return legacyWide === true ? { how: 'stated' } : null;
  if (count.key === 'achievements' && achievements) {
    const wide = achievements.filter((a) => a.completedAt && a.accountWide === true).length;
    return wide ? { how: 'stated', partial: true, wide } : null;
  }
  return null;
}

/** The Collections tab: counts (statistics), one summary per section, Legacy, and freshness. */
export async function collectionsOverview(db, ch) {
  const rows = await collectionsOf(db, ch.id);
  const totals = await catalogTotals(db);
  const sharedKinds = await sharedKindsOf(db, ch.owner_account_id);
  const achCat = rows.get('achievements')?.data ? await achievementCatalog(db) : new Map();
  const earned = (rows.get('achievements')?.data?.items ?? []).map((a) => ({ ...a, accountWide: achCat.get(a.id)?.accountWide ?? null }));
  const legacyWide = achCat.size ? legacyAccountWide(achCat) : null;
  const ranked = ch.ruleset_id !== null && !ch.hidden;
  const values = new Map((await db.query('SELECT statistic_id, value FROM character_statistics WHERE character_id = $1 AND statistic_id = ANY($2::bigint[])', [ch.id, COUNTS.map((c) => c.id)])).map((r) => [Number(r.statistic_id), r.value]));
  const registered = new Set((await db.query('SELECT id FROM statistics WHERE id = ANY($1::bigint[]) AND name IS NOT NULL', [COUNTS.map((c) => c.id)])).map((r) => Number(r.id)));
  const counts = [];
  for (const c of COUNTS) {
    const row = rows.get(c.kind);
    // 0.9.1: hunter pets only for hunters; a lazy count (boss kills) only once its board exists (someone has one).
    if (c.population === 'hunters' && ch.class !== 'Hunter') continue;
    if (c.lazy && !registered.has(c.id)) continue;
    // A collection Blizzard has no catalog for and nobody has (heirlooms on Forever) isn't a count at all.
    if (c.catalog && totals[c.catalog] === 0 && !row?.data) continue;
    if (c.kind === 'heirlooms' && !(totals.heirloom > 0) && !row?.data) continue;
    const known = Boolean(row?.data) && (c.key !== 'legacy' || achCat.size > 0);
    const value = known ? values.get(c.id) ?? 0 : null;
    const rk = ranked && known && value > 0 ? await rankOn(db, { characterId: ch.id, statisticId: c.id, rulesetId: ch.ruleset_id }) : null;
    counts.push({
      key: c.key, id: c.id, name: c.name, short: c.short, kind: c.kind, value, total: c.catalog ? totals[c.catalog] ?? null : null,
      rank: rk?.rank ?? null, withAny: rk?.withAny ?? null, fetchedAt: row?.fetchedAt ?? null, board: registered.has(c.id),
      shared: sharedFor(c, { sharedKinds, achievements: earned, legacyWide }),
    });
  }
  const sections = KINDS.filter((k) => k.id !== 'heirlooms' || totals.heirloom > 0 || rows.get('heirlooms')?.data)
    .filter((k) => k.id !== 'hunter-pets' || ch.class === 'Hunter')
    .map((k) => ({ id: k.id, label: k.label, ...sectionState(rows.get(k.id)), summary: summarise(k.id, rows.get(k.id)?.data, totals), shared: kindById.get(k.id).detect ? sharedKinds.has(k.id) : false }));
  const legacy = rows.get('achievements')?.data && achCat.size ? legacyOf(earned, achCat) : null;
  // 0.9.1: this character's boards per achievement category, transmog slot, instance and PvP field (values above zero).
  const fam = await db.query(
    `SELECT s.id, s.name, s.derived, cs.value FROM character_statistics cs JOIN statistics s ON s.id = cs.statistic_id
      WHERE cs.character_id = $1 AND s.derived LIKE '%:%' AND s.name IS NOT NULL ORDER BY s.name LIMIT 300`,
    [ch.id],
  );
  const familyBoards = [];
  for (const f of fam) {
    const rk = ranked ? await rankOn(db, { characterId: ch.id, statisticId: Number(f.id), rulesetId: ch.ruleset_id }) : null;
    familyBoards.push({ id: Number(f.id), name: f.name, family: String(f.derived).split(':')[0], value: f.value, rank: rk?.rank ?? null, withAny: rk?.withAny ?? null });
  }
  return {
    fetchedAt: ch.collections_fetched_at, catalogs: totals, counts, sections, ranked, familyBoards,
    legacy: legacy ? { points: legacy.points, achievements: legacy.earning.length, accountWide: legacyWide } : null,
  };
}

/** One line per section, from its data. */
function summarise(kind, d, totals) {
  if (!d) return null;
  const n = (x) => x.length;
  switch (kind) {
    case 'mounts': return { have: new Set(d.items.map((x) => x.id)).size, total: totals.mount ?? null };
    case 'pets': return { have: new Set(d.items.map((x) => x.speciesId)).size, owned: n(d.items), total: totals.pet ?? null, maxLevel: d.items.reduce((m, p) => Math.max(m, p.level ?? 0), 0) };
    case 'toys': return { have: n(d.items), total: totals.toy ?? null };
    case 'heirlooms': return { have: n(d.items), total: totals.heirloom ?? null };
    case 'hunter-pets': return { have: n(d.items) };
    case 'titles': return { have: n(d.items), total: totals.title ?? null, active: d.active?.name ?? null };
    case 'transmog': return { have: new Set(d.slots.flatMap((s) => s.ids)).size, total: totals.appearance ?? null };
    case 'achievements': {
      const done = d.items.filter((a) => a.completedAt);
      return { have: done.length, inProgress: d.items.length - done.length, total: totals.achievement ?? null, latest: done.map((a) => a.completedAt).sort().at(-1) ?? null };
    }
    case 'reputations': return { exalted: d.items.filter((r) => r.standing === 'Exalted').length, factions: n(d.items) };
    case 'professions': return { primary: n(d.primaries), secondary: n(d.secondaries), maxed: [...d.primaries, ...d.secondaries].filter((p) => p.tiers.some((t) => t.max && t.skill >= t.max)).length };
    case 'dungeons': case 'raids': {
      const bosses = d.items.flatMap((i) => i.modes.flatMap((m) => m.bosses)).filter((b) => (b.kills ?? 0) > 0).length;
      return { instances: n(d.items), bosses };
    }
    case 'quests': return { inProgress: n(d.items) };
    case 'quests-completed': return { completed: n(d.items) };
    case 'pvp': return { fields: d.fields };
    default: return null;
  }
}

const iconOf = (c) => c?.icon ?? null;

/** Collected list + the catalog's missing entries, for a simple id/name collection. */
function grid(have, catalog, { keyOf = (x) => x.id } = {}) {
  const seen = new Set(have.map(keyOf));
  const collected = have.map((x) => ({ ...x, collected: true, icon: iconOf(catalog?.get(keyOf(x))), name: x.name ?? catalog?.get(keyOf(x))?.name ?? null }));
  const missing = catalog ? [...catalog.values()].filter((c) => !seen.has(c.id)).map((c) => ({ id: c.id, name: c.name, collected: false, icon: iconOf(c) })) : null;
  return { collected, missing, total: catalog ? catalog.size : null };
}

const PAGE = 50;

/** One section in full. `query` for quests (q, cursor) and transmog (slot). */
export async function collectionSection(db, ch, kind, query = {}) {
  const rows = await collectionsOf(db, ch.id);
  const row = rows.get(kind);
  const base = { id: kind, label: kindById.get(kind)?.label ?? kind, ...sectionState(row) };
  const totals = await catalogTotals(db);
  const cat = async (k) => (totals[k] > 0 ? catalogMap(db, k) : null);
  const d = row?.data;
  switch (kind) {
    case 'mounts': return { ...base, ...(d ? grid(d.items, await cat('mount')) : {}) };
    case 'toys': return { ...base, ...(d ? grid(d.items, await cat('toy')) : {}) };
    case 'heirlooms': return { ...base, ...(d ? grid(d.items, await cat('heirloom')) : {}) };
    case 'pets': {
      if (!d) return base;
      const c = await cat('pet');
      const bySpecies = new Map();
      for (const p of d.items) if (!bySpecies.has(p.speciesId) || (p.level ?? 0) > (bySpecies.get(p.speciesId).level ?? 0)) bySpecies.set(p.speciesId, p);
      const g = grid([...bySpecies.values()].map((p) => ({ ...p, id: p.speciesId })), c);
      return { ...base, ...g, owned: d.items.length, collected: g.collected.map((p) => ({ ...p, type: c?.get(p.id)?.type ?? null })) };
    }
    case 'hunter-pets': return { ...base, items: d?.items ?? [] };
    case 'titles': {
      if (!d) return base;
      const c = await cat('title');
      const g = grid(d.items, c);
      return { ...base, ...g, active: d.active };
    }
    case 'achievements': return { ...base, ...(d ? await achievementsView(db, d) : {}) };
    case 'reputations': return { ...base, ...(d ? await reputationsView(db, d) : {}) };
    case 'professions': return { ...base, ...(d ?? {}) };
    case 'dungeons': case 'raids': return { ...base, items: d?.items ?? [] };
    case 'pvp': return { ...base, fields: d?.fields ?? null };
    case 'quests': case 'quests-completed': return questsView(rows, query);
    case 'transmog': return { ...base, ...(d ? await transmogView(db, ch, d, query) : {}) };
    case 'legacy': return legacyView(db, rows);
    default: return null;
  }
}

async function achievementsView(db, d) {
  const cat = await achievementCatalog(db);
  const cats = (await catalogMap(db, 'achievement-category')) ?? new Map();
  // Criteria targets and wording come from the catalog; progress from the character.
  const crit = (have, def) => {
    const kids = def?.children ?? [];
    if (!kids.length) return [];
    const mine = new Map((have?.children ?? []).map((c) => [c.id, c]));
    return kids.slice(0, 20).map((k) => ({ description: k.description, target: k.amount, amount: mine.get(k.id)?.amount ?? null, done: mine.get(k.id)?.done ?? false }));
  };
  const items = d.items.map((a) => {
    const c = cat.get(a.id);
    return {
      id: a.id, name: c?.name ?? a.name, description: c?.description ?? null, category: c?.category ?? null, categoryId: c?.categoryId ?? null,
      completedAt: a.completedAt, accountWide: c?.accountWide ?? null, icon: c?.icon ?? null, reward: c?.reward ?? null,
      legacyPoints: legacyPointsOf(c?.reward), criteria: a.completedAt ? [] : crit(a.criteria, c?.criteria),
      target: c?.criteria?.amount ?? null, amount: a.criteria?.amount ?? null,
    };
  });
  const earnedIds = new Set(items.filter((a) => a.completedAt).map((a) => a.id));
  const byCat = new Map();
  for (const c of cat.values()) {
    const key = c.categoryId ?? 0;
    if (!byCat.has(key)) byCat.set(key, { id: c.categoryId ?? null, name: c.category ?? cats.get(c.categoryId)?.name ?? null, have: 0, total: 0 });
    const b = byCat.get(key);
    b.total += 1;
    if (earnedIds.has(c.id)) b.have += 1;
  }
  return {
    totalPoints: d.totalPoints, catalog: cat.size || null,
    categories: [...byCat.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    inProgress: items.filter((a) => !a.completedAt),
    earned: items.filter((a) => a.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    notEarned: cat.size ? [...cat.values()].filter((c) => !d.items.some((a) => a.id === c.id && a.completedAt)).filter((c) => !d.items.some((a) => a.id === c.id))
      .map((c) => ({ id: c.id, name: c.name, description: c.description, categoryId: c.categoryId, icon: c.icon ?? null, accountWide: c.accountWide, legacyPoints: legacyPointsOf(c.reward) })) : null,
  };
}

async function reputationsView(db, d) {
  const factions = await catalogMap(db, 'faction');
  const parent = new Map();
  for (const f of factions.values()) for (const kid of f.children ?? []) parent.set(kid, f);
  const groups = new Map();
  for (const r of d.items) {
    const p = parent.get(r.id);
    const key = p?.id ?? 0;
    if (!groups.has(key)) groups.set(key, { name: p?.name ?? null, items: [] });
    groups.get(key).items.push(r);
  }
  return {
    exalted: d.items.filter((r) => r.standing === 'Exalted').length,
    groups: [...groups.values()].sort((a, b) => (a.name === null) - (b.name === null) || (a.name ?? '').localeCompare(b.name ?? '')),
  };
}

/** Quests: in progress, and the completed list searched and paged on the server (it can hold 1,000+). */
function questsView(rows, { q = '', cursor = 0 } = {}) {
  const inp = rows.get('quests');
  const done = rows.get('quests-completed');
  const needle = String(q ?? '').trim().toLowerCase().slice(0, 80);
  const all = done?.data?.items ?? [];
  const matched = needle ? all.filter((x) => (x.name ?? '').toLowerCase().includes(needle) || String(x.id) === needle) : all;
  const start = Math.max(0, Math.min(Number.parseInt(cursor, 10) || 0, matched.length));
  return {
    id: 'quests', label: 'Quests',
    inProgress: { ...sectionState(inp), items: inp?.data?.items ?? [] },
    completed: { ...sectionState(done), total: all.length, matched: matched.length, q: needle, items: matched.slice(start, start + PAGE), next: start + PAGE < matched.length ? String(start + PAGE) : null, start },
  };
}

async function legacyView(db, rows) {
  const a = rows.get('achievements');
  const cat = await achievementCatalog(db);
  if (!a?.data || !cat.size) return { id: 'legacy', label: 'Legacy Points', ...sectionState(a), catalog: cat.size > 0, points: null, earning: [] };
  const l = legacyOf(a.data.items, cat);
  const available = [...cat.values()].filter((c) => legacyPointsOf(c.reward) !== null);
  return {
    id: 'legacy', label: 'Legacy Points', ...sectionState(a), catalog: true, points: l.points, earning: l.earning,
    available: { achievements: available.length, points: available.reduce((n, c) => n + legacyPointsOf(c.reward), 0) },
    accountWide: legacyAccountWide(cat),
  };
}

const QUALITY_ORDER = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom'];

/**
 * The transmog tracker: per-slot and overall completion, one slot's tiles (collected + missing with the catalog), each
 * appearance's armour type, quality (from Blizzard's item search, when known) and the items that grant it, the named
 * sets, and the transmog currently worn (equipment's `transmog`, 0.8.0).
 */
async function transmogView(db, ch, d, { slot = null } = {}) {
  const collected = new Map();
  for (const s of d.slots) for (const id of s.ids) if (!collected.has(id)) collected.set(id, s.type);
  const totals = await catalogTotals(db);
  // 0.9.2: the COMPLETE appearance catalog (a build that finished) gives totals and missing tiles; until then the
  // tracker is collected-only. Names, items and icons come from whatever catalog rows exist already, complete or not.
  const complete = totals.appearance > 0;
  const cat = complete ? await catalogMap(db, 'appearance', { limit: 60_000 }) : null;
  const known = cat ?? await catalogMap(db, 'appearance', { ids: [...collected.keys()], limit: 20_000 });
  const look = (id) => known.get(id) ?? null;
  const slotOf = (id) => look(id)?.slot ?? collected.get(id) ?? null;
  const slotNames = new Map(d.slots.map((s) => [s.type, s.name]));
  if (cat) for (const a of cat.values()) if (a.slot && a.slotName && !slotNames.has(a.slot)) slotNames.set(a.slot, a.slotName);
  const labels = slotLabels([...slotNames.entries()].map(([type, name]) => ({ type, name })));
  // Per slot: have / total. Armour or weapon by what Blizzard's catalog says the slot's appearances are (item class),
  // else by Blizzard's slot type.
  const per = new Map();
  const bump = (s, key) => {
    if (!s) return;
    if (!per.has(s)) per.set(s, { type: s, name: labels.get(s) ?? slotNames.get(s) ?? s, have: 0, total: 0, classes: new Map() });
    per.get(s)[key] += 1;
  };
  for (const id of collected.keys()) bump(slotOf(id), 'have');
  for (const a of known.values()) if (a.slot && a.itemClass && per.has(a.slot)) per.get(a.slot).classes.set(a.itemClass, (per.get(a.slot).classes.get(a.itemClass) ?? 0) + 1);
  if (cat) {
    for (const a of cat.values()) {
      bump(a.slot, 'total');
      if (a.slot && a.itemClass) per.get(a.slot).classes.set(a.itemClass, (per.get(a.slot).classes.get(a.itemClass) ?? 0) + 1);
    }
  }
  const order = [...SLOT_GROUPS.Armor, ...SLOT_GROUPS.Weapon];
  const slots = [...per.values()].map((s) => ({
    type: s.type, name: s.name, have: s.have, total: cat ? s.total : null,
    group: [...s.classes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? slotGroup(s.type),
  })).sort((a, b) => (order.indexOf(a.type) + 1 || 999) - (order.indexOf(b.type) + 1 || 999));
  const current = slots.find((s) => s.type === slot) ?? slots.find((s) => s.have > 0) ?? slots[0] ?? null;
  let tiles = [];
  if (current) {
    const ids = new Set([...collected.keys()].filter((id) => slotOf(id) === current.type));
    if (cat) for (const a of cat.values()) if (a.slot === current.type) ids.add(a.id);
    const items = await qualities(db, [...ids].flatMap((id) => (look(id)?.items ?? []).map((i) => i.id)));
    tiles = [...ids].map((id) => {
      const a = look(id);
      const q = (a?.items ?? []).map((i) => items.get(i.id)).filter(Boolean).sort((x, y) => QUALITY_ORDER.indexOf(y) - QUALITY_ORDER.indexOf(x))[0] ?? null;
      return {
        id, collected: collected.has(id), name: a?.name ?? null, icon: a?.icon ?? null, armour: a?.subclass ?? null, itemClass: a?.itemClass ?? null, quality: q,
        items: (a?.items ?? []).map((i) => ({ id: i.id, name: i.name, quality: items.get(i.id) ?? null })),
        // Blizzard returned nothing for it (yet): the page keeps the id and says so.
        unresolved: !a || (a.unavailable !== undefined && !a.items),
      };
    }).sort((x, y) => (y.collected - x.collected) || (x.name ?? '').localeCompare(y.name ?? '') || x.id - y.id);
  }
  const sets = totals['appearance-set'] > 0 ? [...(await catalogMap(db, 'appearance-set')).values()].map((s) => ({
    id: s.id, name: s.name, total: (s.appearances ?? []).length, have: (s.appearances ?? []).filter((x) => collected.has(x)).length,
  })) : [];
  const worn = await db.one('SELECT equipment FROM characters WHERE id = $1', [ch.id]);
  const resolved = [...collected.keys()].filter((id) => look(id)?.items?.length).length;
  return {
    catalog: Boolean(cat), have: collected.size, total: cat ? cat.size : null, slots, slot: current?.type ?? null, tiles, sets,
    resolved,
    catalogState: (await db.one(`SELECT state FROM collection_catalog_state WHERE ${CATALOG_SCOPE} AND kind = 'appearance'`))?.state ?? null,
    qualityKnown: totals.item > 0,
    worn: (Array.isArray(worn?.equipment) ? worn.equipment : []).map((e) => ({ slot: e.slot, slotName: e.slotName, item: e.name, transmog: e.transmog === undefined ? undefined : e.transmog ? e.transmog.name : null })),
  };
}

/** Item id → quality, from the item-search catalog. */
async function qualities(db, ids) {
  if (!ids.length) return new Map();
  const rows = await db.query(`SELECT id, data->>'quality' AS q FROM collection_catalog WHERE ${CATALOG_SCOPE} AND kind = 'item' AND id = ANY($1::bigint[]) LIMIT 20000`, [ids]);
  return new Map(rows.filter((r) => r.q).map((r) => [Number(r.id), r.q]));
}

/** For a collection board's header: how account-wide it is known to be, in words-ready numbers. */
export async function boardSharing(db, statisticId) {
  // 0.9.1: a fixed count, or a family board (per achievement category, transmog slot, instance, PvP field).
  const key = (await db.one('SELECT derived FROM statistics WHERE id = $1', [Number(statisticId)]))?.derived ?? null;
  const fam = key ? familyOf(key) : null;
  const c = COUNTS.find((x) => x.id === Number(statisticId)) ?? (fam ? { key, kind: fam.kind, shared: fam.shared, family: fam.family } : null);
  if (!c) return null;
  const extra = { population: c.population ?? null, family: c.family ?? null };
  if (c.shared === 'detected') {
    const ev = (await sharingEvidence(db))[c.kind] ?? { accounts: 0, shared: 0 };
    return { key: c.key, how: 'detected', accounts: ev.accounts, shared: ev.shared, ...extra };
  }
  if (c.family === 'achcat') {
    const cat = [...(await achievementCatalog(db)).values()].filter((a) => `achcat:${a.categoryId}` === key);
    return { key, how: 'stated', partial: true, wide: cat.filter((a) => a.accountWide === true).length, total: cat.length, ...extra };
  }
  if (c.key === 'legacy') {
    const cat = await achievementCatalog(db);
    return { key: c.key, how: 'stated', accountWide: cat.size ? legacyAccountWide(cat) : null };
  }
  if (c.key === 'achievements') {
    const cat = await achievementCatalog(db);
    const wide = [...cat.values()].filter((a) => a.accountWide === true).length;
    return { key: c.key, how: 'stated', partial: true, wide, total: cat.size };
  }
  return { key: c.key, how: null, ...extra };
}
