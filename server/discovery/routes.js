import express from 'express';
import { getSetting, listSettings } from '../admin/settings.js';
import { pageLimit } from '../core/db.js';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { getSource } from '../sources/registry.js';
import { characterSlug } from '../stats/slug.js';
import { forgetGrant, grantStatus, startGrant } from './grant.js';
import { VALUE_TYPES } from './analyze.js';
import { SUGGESTION_KINDS, present } from './suggest.js';
import { analyseCombined, analyseStored } from './run.js';
import { clearCatalogCache, currentDecisions } from '../stats/catalog.js';
import { requestTierRecompute } from '../tiers/store.js';
import { guessValueType } from './analyze.js';
import { parseGuildSlug } from '../stats/slug.js';
import { analyseProbe, probeBoardsCsv, probeCsv } from './probe/run.js';
import { GAME_VERSIONS, PRIMARY_VERSION, blizzardContext, isRegionEnabled, publicVersions, versionById } from '../core/gameVersions.js';
import { PRIMARY_SCOPE } from '../core/config.js';
import { SourceError } from '../sources/blizzard.js';
import { openSource } from '../sources/registry.js';
import { grantToken } from './grant.js';
import { parseAccountCharacters, parseProfile } from '../crawler/parse.js';
import { connectedRealmsFromSearch, realmMapFromSearch } from '../realms/playerRealms.js';

const isProbe = (run) => run?.options?.kind === 'probe';
const MAX_EXPORT_BODY = 20_000; // characters of each raw body in a probe's JSON export (the page has every body in full)
/** A guild name as typed ("Post Nerf Clarity") or a slug → Blizzard's slug (post-nerf-clarity), or null. */
const guildSlugOf = (input) => parseGuildSlug(String(input ?? '').trim().toLowerCase().replace(/\s+/g, '-'));
/** 0.10.0: a realm as typed ("Area 52", "Aerie Peak") or its slug → the slug Blizzard uses (area-52), or null. */
const realmSlugOf = (input) => {
  const v = String(input ?? '').normalize('NFC').trim().toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '-');
  return /^[\p{L}\p{N}][\p{L}\p{N}-]{0,59}$/u.test(v) ? v : null;
};
/** A realm version's character name: letters only (Blizzard lower-cases it in the path). */
const realmNameOf = (input) => {
  const v = String(input ?? '').normalize('NFC').trim();
  return /^[\p{L}\p{M}]{2,24}$/u.test(v) ? v : null;
};
/** The version and region a probe asks about: any version in the registry (enabled or not), an enabled region. */
function probeScopeOf(body) {
  const version = String(body?.version ?? PRIMARY_SCOPE.version);
  const region = String(body?.region ?? PRIMARY_SCOPE.region);
  const v = versionById(version);
  if (!v) throw new HttpError(400, 'Pick a game version.', 'invalid');
  if (!isRegionEnabled(region) || !v.regions.includes(region)) throw new HttpError(400, 'Pick a region Everstats covers.', 'invalid');
  return { version, region, v };
}

/**
 * /api/admin/discovery/*: mounted INSIDE the admin router, after its gate, so without an admin session every one of
 * these is the same plain 404 as a path that doesn't exist. Raw payloads leave the server only through here.
 */
const MAX_CATALOG_ROWS = 20_000;
const MAX_REANALYSE_RUNS = 50;
const KINDS = SUGGESTION_KINDS; // decisions on a suggestion
const DECISION_KINDS = [...SUGGESTION_KINDS, 'value_type']; // … plus the admin's own value-type corrections
const DECISIONS = ['approved', 'rejected', 'cleared'];

/** 0.10.3: the game version a list or catalog is limited to (`version` or `v`), or null for every version. */
const versionParam = (x) => {
  if (x === undefined || x === null || x === '') return null;
  const v = String(x);
  if (!versionById(v)) throw new HttpError(400, 'Unknown game version', 'invalid');
  return v;
};
const regionParam = (x) => (typeof x === 'string' && /^[a-z]{2}$/.test(x) ? x : null);

const intParam = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};

const runView = (r, { skeletons = false } = {}) => {
  let summary = r.summary ?? null;
  if (summary && !skeletons) {
    const { skeletons: _omit, ...rest } = summary;
    summary = rest;
  }
  return {
    id: r.id,
    status: r.status,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    heartbeatAt: r.heartbeat_at,
    options: r.options,
    progress: r.progress,
    problem: r.problem,
    stopRequestedAt: r.stop_requested_at ?? null,
    ...(summary !== undefined ? { summary } : {}),
  };
};

/**
 * A catalog with suggestions computed against the admin's current decisions (suggest.js present()). `runId` null is
 * the combined catalog of every finished run; a number is that run's own catalog. Only the decision-free stored
 * `suggestions` snapshot is ignored here: what the page shows always follows the current decisions.
 */
async function loadCatalog(db, runId, { version = null } = {}) {
  // 0.10.3: `version` (the admin's version switcher) limits the combined catalog to one game version's statistics;
  // null keeps every version (as before). A run's own catalog is that run's, whatever the version.
  const rows = runId === null
    ? [...await db.query('SELECT * FROM discovery_catalog WHERE ($2::text IS NULL OR game_version = $2) ORDER BY statistic_id LIMIT $1', [MAX_CATALOG_ROWS, version]), ...await productionOnly(db, version)]
    : await db.query('SELECT * FROM discovery_statistics WHERE run_id = $1 ORDER BY statistic_id LIMIT $2', [runId, MAX_CATALOG_ROWS]);
  const decisions = await currentDecisions(db, rows.map((r) => r.statistic_id));
  return rows.map((r) => present({
    statisticId: r.statistic_id,
    name: r.name,
    endpoint: r.endpoint,
    categoryPath: r.category_path,
    valueType: r.value_type,
    valueTypeBasis: r.value_type_basis,
    valueTypeGuessed: r.value_type_guessed,
    charactersSampled: r.characters_sampled,
    charactersPresent: r.characters_present,
    charactersNonzero: r.characters_nonzero,
    minValue: r.min_value,
    maxValue: r.max_value,
    medianValue: r.median_value,
    hasText: r.has_text,
    namedExample: r.named_example ?? null,
    duplicate: r.duplicate ?? null,
    runs: (r.runs ?? (runId === null ? [] : [runId])).map(Number), // pg returns bigint[] elements as strings
    fromProduction: Boolean(r.from_production),
    derived: r.derived ?? null,
  }, decisions.get(r.statistic_id) ?? new Map()));
}

/**
 * Statistics the production crawler has seen that no discovery run has (0.4.0: the catalog grows from production
 * crawls). Shaped like discovery_catalog rows, with counts measured from the production tables, so the combined
 * catalog shows them for approval like any other. Their value type is the same name-based guess discovery makes.
 */
async function productionOnly(db, version = null) {
  const sampled = (await db.one('SELECT count(*)::int AS n FROM characters WHERE stats_fetched_at IS NOT NULL AND ($1::text IS NULL OR game_version = $1)', [version])).n;
  const rows = await db.query(
    `SELECT s.id, s.name, s.category_path, s.has_text, s.named_example, s.derived,
            (SELECT count(*)::int FROM character_statistics cs WHERE cs.statistic_id = s.id) AS present,
            (SELECT count(*)::int FROM character_statistics cs WHERE cs.statistic_id = s.id AND cs.value <> 0) AS nonzero,
            (SELECT min(value) FROM character_statistics cs WHERE cs.statistic_id = s.id) AS min_value,
            (SELECT max(value) FROM character_statistics cs WHERE cs.statistic_id = s.id) AS max_value
       FROM statistics s WHERE NOT EXISTS (SELECT 1 FROM discovery_catalog d WHERE d.statistic_id = s.id)
        AND ($2::text IS NULL OR s.game_version = $2)
      ORDER BY s.id LIMIT $1`,
    [MAX_CATALOG_ROWS, version],
  );
  return rows.map((r) => {
    const g = guessValueType(r.name, { namedExample: r.named_example });
    return {
      // 0.9.0: a collection count names the collection it is counted from.
      statistic_id: r.id, name: r.name, endpoint: r.derived ? `everstats.collections.${r.derived}` : 'character.achievement-statistics', category_path: r.category_path, derived: r.derived ?? null,
      value_type: g.type, value_type_basis: g.basis, value_type_guessed: g.guessed,
      characters_sampled: sampled, characters_present: r.present, characters_nonzero: r.nonzero,
      min_value: r.min_value, max_value: r.max_value, median_value: null, has_text: r.has_text, named_example: r.named_example,
      duplicate: null, runs: [], from_production: true,
    };
  });
}

const combinedView = async (db) => {
  const row = await db.one('SELECT summary, analysed_at FROM discovery_combined WHERE id = 1');
  return row ? { ...row.summary, analysedAt: row.analysed_at } : null;
};

/** Re-analyses every finished run (newest MAX_REANALYSE_RUNS), then rebuilds the combined catalog. No Blizzard request. */
async function reanalyseAll(db) {
  const runs = await db.query("SELECT id, summary, options FROM discovery_runs WHERE status IN ('done', 'stopped') AND summary IS NOT NULL ORDER BY id DESC LIMIT $1", [MAX_REANALYSE_RUNS]);
  for (const run of runs) {
    const summary = isProbe(run) ? await analyseProbe(db, run.id, run.summary.live, run.options) : await analyseStored(db, run.id, run.summary);
    await db.query('UPDATE discovery_runs SET summary = $2::jsonb WHERE id = $1', [run.id, JSON.stringify(summary)]);
  }
  const combined = await analyseCombined(db);
  await db.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.reanalysed', $1::jsonb)", [JSON.stringify({ runs: runs.map((r) => r.id) })]);
  return combined;
}

// ---- CSV
const FORMULA = /^[=+\-@\t\r]/;
const cell = (v, { text = false } = {}) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (text && FORMULA.test(s)) s = `'${s}`; // a spreadsheet must never run a Blizzard string as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvValue = (s) => {
  if (!s) return '';
  if (s.value === null) return 'unknown';
  if (s.kind === 'duplicate') return `duplicate of ${s.value.of}`;
  return s.value;
};
export function catalogCsv(catalog) {
  const head = ['statistic_id', 'name', 'blizzard_category', 'blizzard_subcategory', 'category_path', 'endpoint', 'runs', 'value_type', 'value_type_guessed', 'value_type_basis',
    'characters_sampled', 'characters_present', 'characters_nonzero', 'min', 'median', 'max', 'has_text',
    ...KINDS.flatMap((k) => [`suggested_${k}`, `${k}_decision`, `${k}_reasoning`])];
  const lines = [head.join(',')];
  for (const s of catalog) {
    const sug = Object.fromEntries(s.suggestions.map((x) => [x.kind, x]));
    lines.push([
      cell(s.statisticId), cell(s.name, { text: true }), cell(s.categoryPath[0]?.name, { text: true }), cell(s.categoryPath[1]?.name, { text: true }),
      cell(s.categoryPath.map((c) => c.name).join(' > '), { text: true }), cell(s.endpoint), cell((s.runs ?? []).join(' ')), cell(s.valueType), cell(s.valueTypeGuessed),
      cell(s.valueTypeBasis, { text: true }),
      cell(s.charactersSampled), cell(s.charactersPresent), cell(s.charactersNonzero), cell(s.minValue), cell(s.medianValue), cell(s.maxValue), cell(s.hasText),
      ...KINDS.flatMap((k) => [cell(csvValue(sug[k]), { text: true }), cell(sug[k]?.decision ?? ''), cell(sug[k]?.reasoning, { text: true })]),
    ].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function createDiscoveryRouter({ db, limits, networkOf, limitBy, fetch = globalThis.fetch }) {
  const deps = { fetch };
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const source = getSource('blizzard');

  r.get('/', route(async (req, res) => {
    const limit = pageLimit(req.query.limit, { fallback: 25, max: 100 });
    const before = req.query.before ? intParam(req.query.before) : null;
    // 0.10.3: ?version= (or v) &region= (or r) &kind=discovery|probe narrow the list; none of them = every run, as before.
    const version = versionParam(req.query.version ?? req.query.v);
    const region = regionParam(req.query.region ?? req.query.r);
    const kind = ['discovery', 'probe'].includes(req.query.kind) ? req.query.kind : null;
    const rows = await db.query(
      `SELECT id, status, requested_at, started_at, finished_at, heartbeat_at, options, progress, problem, stop_requested_at, game_version, region,
              (summary IS NOT NULL) AS has_summary, summary->'requests' AS requests, summary->'catalogSize' AS catalog_size, summary->'wallMs' AS wall_ms
         FROM discovery_runs
        WHERE ($1::bigint IS NULL OR id < $1) AND ($3::text IS NULL OR game_version = $3) AND ($4::text IS NULL OR region = $4)
          AND ($5::text IS NULL OR coalesce(options->>'kind', 'discovery') = $5)
        ORDER BY id DESC LIMIT $2`,
      [before, limit + 1, version, region, kind],
    );
    // One run at a time across every version and kind: the one in flight, wherever it is, so a page can say why it waits.
    const active = await db.one(
      `SELECT id, status, options, progress, heartbeat_at, game_version, region, stop_requested_at FROM discovery_runs
        WHERE status IN ('queued', 'running') ORDER BY id LIMIT 1`,
    );
    const settings = (await listSettings(db)).filter((s) => s.section === 'discovery');
    res.json({
      configured: await isConfigured(db, source.credential),
      grant: await grantStatus(db),
      settings,
      runs: rows.slice(0, limit).map((x) => ({ ...runView({ ...x, summary: undefined }), version: x.game_version, region: x.region, requests: x.requests, catalogSize: x.catalog_size, wallMs: x.wall_ms })),
      nextBefore: rows.length > limit ? rows[limit - 1].id : null,
      active: active ? { ...runView({ ...active, summary: undefined }), version: active.game_version, region: active.region } : null,
    });
  }));

  r.post('/authorize', writes, route(async (req, res) => res.json({ url: await startGrant(db, res) })));
  r.delete('/grant', writes, route(async (req, res) => {
    await forgetGrant(db);
    res.json({ grant: null });
  }));

  r.post('/runs', writes, route(async (req, res) => {
    if (!(await isConfigured(db, source.credential))) throw new HttpError(409, 'Enter the Blizzard API keys in the key manager first.', 'not_configured');
    const slug = characterSlug(req.body?.name, req.body?.surname);
    if (!slug.ok) throw new HttpError(400, slug.problem, 'invalid');
    const options = {
      primary: { name: String(req.body.name).trim(), surname: String(req.body.surname).trim(), slug: slug.slug },
      account: req.body?.account !== false,
      guild: req.body?.guild !== false,
      maxCharacters: await getSetting(db, 'discovery.maxCharacters'),
      requestsPerSecond: await getSetting(db, 'discovery.requestsPerSecond'),
    };
    res.status(201).json({ run: runView(await queueRun(options, 'discovery.queued')) });
  }));

  /** One run at a time, discovery or probe: the worker claims the oldest queued one. */
  const queueRun = (options, eventType, scope = PRIMARY_SCOPE) => db.tx(async (q) => {
    await q.query('LOCK TABLE discovery_runs IN SHARE ROW EXCLUSIVE MODE');
    const busy = await q.one("SELECT id FROM discovery_runs WHERE status IN ('queued', 'running') LIMIT 1");
    if (busy) throw new HttpError(409, `Run #${busy.id} hasn't finished yet.`, 'busy');
    const created = await q.one(
      "INSERT INTO discovery_runs (status, options, game_version, region) VALUES ('queued', $1::jsonb, $2, $3) RETURNING *",
      [JSON.stringify(options), scope.version, scope.region],
    );
    await q.query('INSERT INTO admin_events (type, detail) VALUES ($1, $2::jsonb)', [eventType, JSON.stringify({ run: created.id })]);
    return created;
  });

  // 0.8.3: the endpoint probe (discovery/probe/): every endpoint in Blizzard's docs, tried once. 0.10.0: against any
  // game version in the registry (enabled or not) and region; a realm version's character is realm + name.
  r.post('/probes', writes, route(async (req, res) => {
    if (!(await isConfigured(db, source.credential))) throw new HttpError(409, 'Enter the Blizzard API keys in the key manager first.', 'not_configured');
    const { version, region, v } = probeScopeOf(req.body);
    let primary;
    if (v.realms) {
      const name = realmNameOf(req.body?.name);
      const realmSlug = realmSlugOf(req.body?.realm);
      if (!name) throw new HttpError(400, 'Enter the character’s name (letters only).', 'invalid');
      if (!realmSlug) throw new HttpError(400, 'Enter the character’s realm.', 'invalid');
      primary = { name, surname: '', realmSlug, slug: name.toLowerCase() };
    } else {
      const slug = characterSlug(req.body?.name, req.body?.surname);
      if (!slug.ok) throw new HttpError(400, slug.problem, 'invalid');
      primary = { name: String(req.body.name).trim(), surname: String(req.body.surname).trim(), slug: slug.slug };
    }
    const guildName = String(req.body?.guild ?? '').trim().slice(0, 120);
    const guildSlug = guildSlugOf(guildName);
    if (!guildSlug) throw new HttpError(400, 'Enter the guild’s name (letters, digits, spaces, apostrophes or hyphens).', 'invalid');
    const guildRealm = v.realms ? (realmSlugOf(req.body?.guildRealm) ?? primary.realmSlug) : null;
    const options = {
      kind: 'probe',
      version,
      region,
      primary,
      guild: { name: guildName, slug: guildSlug, ...(guildRealm ? { realmSlug: guildRealm } : {}) },
      requestsPerSecond: await getSetting(db, 'discovery.requestsPerSecond'),
    };
    res.status(201).json({ run: runView(await queueRun(options, 'discovery.probe_queued', { version, region })) });
  }));

  /**
   * 0.10.3: the endpoint probe matrix: every endpoint as the NEWEST finished probe of each game version (in one region)
   * answered it, from the stored summaries only (nothing is asked). A version never probed there is listed with no run.
   */
  r.get('/probe-matrix', route(async (req, res) => {
    const region = regionParam(req.query.region ?? req.query.r) ?? PRIMARY_SCOPE.region;
    const latest = await db.query(
      `SELECT DISTINCT ON (game_version) id, game_version, finished_at, status, summary->'entries' AS entries, summary->'areas' AS areas
         FROM discovery_runs
        WHERE options->>'kind' = 'probe' AND region = $1 AND status IN ('done', 'stopped') AND summary IS NOT NULL
        ORDER BY game_version, id DESC LIMIT $2`,
      [region, GAME_VERSIONS.length],
    );
    const byVersion = new Map(latest.map((x) => [x.game_version, x]));
    const versions = GAME_VERSIONS.map((v) => {
      const run = byVersion.get(v.id);
      return { id: v.id, name: v.name, short: v.short ?? v.name, run: run ? { id: run.id, status: run.status, finishedAt: run.finished_at } : null };
    });
    const rows = new Map();
    const areas = new Map();
    for (const run of latest) {
      for (const a of run.areas ?? []) if (!areas.has(a.id)) areas.set(a.id, a.label);
      for (const e of run.entries ?? []) {
        if (!rows.has(e.id)) rows.set(e.id, { id: e.id, area: e.area, template: e.template, cells: {} });
        const best = (e.attempts ?? []).find((a) => a.responseId === e.best) ?? null;
        rows.get(e.id).cells[run.game_version] = { outcome: e.outcome, status: best?.status ?? null, skipped: e.skipped ?? null };
      }
    }
    res.json({ region, versions, areas: [...areas].map(([id, label]) => ({ id, label })), rows: [...rows.values()] });
  }));

  // 0.10.0: the versions a probe can ask about (the client's pickers), whatever is enabled for players.
  r.get('/probe-versions', route(async (req, res) => {
    res.json({ versions: publicVersions().map((x) => ({ ...x, enabledForPlayers: x.enabled })), primary: PRIMARY_VERSION.id });
  }));

  /**
   * 0.10.0: the admin's own characters on a version, to prefill a probe: /profile/user/wow in that version's profile
   * namespace with the Discovery Battle.net token, then the highest-level one's profile for its guild. STORES NOTHING:
   * the answer goes to the admin's browser only (no characters row, no discovery_responses row, nothing logged but
   * the fact of the request).
   */
  r.get('/probe-characters', route(async (req, res) => {
    const { version, region, v } = probeScopeOf(req.query);
    if (!(await isConfigured(db, source.credential))) throw new HttpError(409, 'Enter the Blizzard API keys in the key manager first.', 'not_configured');
    const grant = await grantToken(db);
    if (!grant) return res.json({ version, region, grant: false, characters: [], pick: null, guild: null, note: 'Authorize Battle.net on this page first: your character list is read with that token.' });
    const ctx = blizzardContext(version, region);
    let src;
    try {
      src = await openSource(db, 'blizzard', { fetch: deps.fetch, maxAttempts: 1, perSecond: 10, region });
    } catch (err) {
      throw new HttpError(409, err instanceof SourceError ? err.message : 'Couldn’t open the Blizzard source.', 'source');
    }
    const list = await src.get(ctx.paths.accountCharacters, { namespace: ctx.namespaces.profile, auth: 'user', userToken: grant.token });
    if (list.status === 404) return res.json({ version, region, grant: true, characters: [], pick: null, guild: null, note: `Your Battle.net account has no characters on ${v.name} (Blizzard answered 404). Type one in: ${v.realms ? 'realm and name' : 'name and surname'}.` });
    if (list.status !== 200 || !list.json) return res.json({ version, region, grant: true, characters: [], pick: null, guild: null, note: `Blizzard didn’t give the character list (${list.status === null ? `no answer: ${list.error ?? 'error'}` : `HTTP ${list.status}`}). Type one in.` });
    // 0.10.1: on a realm version, which realms are player realms and which are locked (realms/playerRealms.js), from
    // search/connected-realm (one page per 100 connected realms; it lists the same set as connected-realm/index).
    let realmInfo = null;
    if (ctx.realms) {
      const pages = [];
      for (let page = 1; page <= 5; page += 1) {
        const r = await src.get(ctx.paths.connectedRealmSearch, { namespace: ctx.namespaces.dynamic, query: { orderby: 'id', _page: page } });
        if (r.status !== 200 || !r.json) break;
        pages.push(r.json);
        if (!(Number(r.json.pageCount) > page)) break;
      }
      realmInfo = pages.length ? realmMapFromSearch(connectedRealmsFromSearch(pages)) : null;
    }
    const characters = parseAccountCharacters(list.json, { realms: ctx.realms }).map((c) => {
      const info = realmInfo && c.realmSlug ? realmInfo.get(c.realmSlug) ?? null : null;
      return {
        id: c.id, name: c.name, surname: c.surname, realmSlug: c.realmSlug ?? null, level: c.level, class: c.class, race: c.race, faction: c.faction,
        // null = unknown (no realm data); internal = on no connected realm Blizzard lists (never picked).
        realm: realmInfo ? { internal: !info, locked: info?.locked ?? null, category: info?.category ?? null } : null,
      };
    });
    if (!characters.length) return res.json({ version, region, grant: true, characters, pick: null, guild: null, note: `Your Battle.net account lists no characters on ${v.name}. Type one in: ${v.realms ? 'realm and name' : 'name and surname'}.` });
    // Highest level wins, but a character on an open realm before one on a locked realm (probe #6: a Legacy-realm
    // character answered 404 everywhere), and never one on an internal realm. Level 10+ first (below, no profile).
    const rank = (c) => [c.realm?.internal ? 0 : 1, (c.level ?? 0) >= 10 ? 1 : 0, c.realm?.locked === true ? 0 : 1, c.level ?? 0];
    const cmp = (a, b) => {
      const x = rank(a);
      const y = rank(b);
      for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
      return a.id - b.id;
    };
    const pick = [...characters].sort(cmp)[0];
    if (pick.realm?.internal) return res.json({ version, region, grant: true, characters, pick: null, guild: null, note: `Every character on your list is on an internal realm Blizzard doesn't list. Type one in.` });
    let guild = null;
    if (!ctx.realms || pick.realmSlug) {
      const prof = await src.get(ctx.characterPath({ realmSlug: pick.realmSlug, slug: (ctx.realms ? pick.name : `${pick.name}-${pick.surname}`).toLowerCase() }), { namespace: ctx.namespaces.profile });
      const pp = prof.status === 200 ? parseProfile(prof.json, { realms: ctx.realms }) : null;
      if (pp?.guild) guild = { name: pp.guild.name, slug: pp.guild.slug, realmSlug: pp.guild.realm?.slug ?? null };
    }
    const why = pick.realm?.locked === true
      ? `${pick.name}'s realm is locked (every realm your characters are on is): its profile may not answer.`
      : pick.realm && characters.some((c) => c.realm?.locked === true && (c.level ?? 0) > (pick.level ?? 0))
        ? `Picked ${pick.name} (level ${pick.level}) on an open realm over higher-level characters on locked realms.`
        : null;
    const guildNote = guild ? null : `${pick.name} is in no guild Blizzard names (or its profile didn’t answer): type a guild in.`;
    res.json({ version, region, grant: true, characters, pick, guild, note: [why, guildNote].filter(Boolean).join(' ') || null });
  }));

  // 0.10.0: the admin's eyes on the render: does it draw the race Blizzard names? Kept in the run's live record, so a
  // re-analyse keeps it.
  r.post('/runs/:id/render-check', writes, route(async (req, res) => {
    const id = intParam(req.params.id);
    const verdict = req.body?.verdict;
    if (!['right', 'wrong', null].includes(verdict ?? null)) throw new HttpError(400, 'Right race, wrong race, or clear.', 'invalid');
    const run = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
    if (!isProbe(run) || !run.summary?.live) throw new HttpError(409, 'Only a finished endpoint probe has a render to check.', 'not_done');
    const live = { ...run.summary.live, renderCheck: verdict ? { verdict, at: new Date().toISOString() } : null };
    const summary = await analyseProbe(db, id, live, run.options);
    await db.tx(async (q) => {
      await q.query('UPDATE discovery_runs SET summary = $2::jsonb WHERE id = $1', [id, JSON.stringify(summary)]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.render_checked', $1::jsonb)", [JSON.stringify({ run: id, verdict: verdict ?? 'cleared' })]);
    });
    res.json({ run: runView(await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id])) });
  }));

  r.get('/runs/:id/export-boards.csv', route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT id, options, summary FROM discovery_runs WHERE id = $1', [id]);
    if (!run || !isProbe(run)) throw new HttpError(404, 'Not found');
    if (!run.summary) throw new HttpError(409, 'That probe has no results yet.', 'not_done');
    res.set('Content-Disposition', `attachment; filename="everstats-probe-${id}-boards.csv"`);
    res.type('text/csv; charset=utf-8').send(probeBoardsCsv(run.summary));
  }));

  // Stop a probe: a queued one never starts; a running one stops before its next request and keeps what it has.
  r.post('/runs/:id/stop', writes, route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
    if (!isProbe(run)) throw new HttpError(409, 'Only an endpoint probe can be stopped.', 'not_probe');
    if (!['queued', 'running'].includes(run.status)) throw new HttpError(409, 'That probe has already finished.', 'not_running');
    await db.tx(async (q) => {
      await q.query(
        `UPDATE discovery_runs SET stop_requested_at = coalesce(stop_requested_at, now()),
                status = CASE WHEN status = 'queued' THEN 'stopped' ELSE status END,
                finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END,
                problem = CASE WHEN status = 'queued' THEN 'Stopped before it started.' ELSE problem END
          WHERE id = $1`,
        [id],
      );
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.stop_requested', $1::jsonb)", [JSON.stringify({ run: id })]);
    });
    res.json({ run: runView(await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id])) });
  }));

  r.get('/runs/:id', route(async (req, res) => {
    const row = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [intParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'Not found');
    res.json({ run: runView(row, { skeletons: req.query.skeletons === '1' }) });
  }));

  // Re-analyse a finished run with the current rules, from its stored responses: no request goes to Blizzard.
  r.post('/runs/:id/reanalyse', writes, route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
    if (!['done', 'stopped'].includes(run.status) || !run.summary) throw new HttpError(409, 'Only a finished run can be re-analysed.', 'not_done');
    const summary = isProbe(run) ? await analyseProbe(db, id, run.summary.live, run.options) : await analyseStored(db, id, run.summary);
    await db.tx(async (q) => {
      await q.query('UPDATE discovery_runs SET summary = $2::jsonb WHERE id = $1', [id, JSON.stringify(summary)]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.reanalysed', $1::jsonb)", [JSON.stringify({ run: id })]);
    });
    await analyseCombined(db); // the combined catalog follows the same rules
    const row = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    res.json({ run: runView(row) });
  }));

  // ---- the combined catalog of every finished run: what the admin approves from
  r.get('/catalog', route(async (req, res) => {
    // 0.10.3: ?version= limits it to one version's statistics. Discovery runs ask the primary version only, so the
    // combined summary (built from those runs) belongs to the primary version and is null for any other.
    const version = versionParam(req.query.version ?? req.query.v);
    const combined = version === null || version === PRIMARY_VERSION.id ? await combinedView(db) : null;
    res.json({ version, combined, catalog: await loadCatalog(db, null, { version }) });
  }));
  r.post('/reanalyse', writes, route(async (req, res) => {
    await reanalyseAll(db);
    res.json({ combined: await combinedView(db) });
  }));
  r.get('/catalog/export.csv', route(async (req, res) => {
    const version = versionParam(req.query.version ?? req.query.v);
    const csv = catalogCsv(await loadCatalog(db, null, { version }));
    res.set('Content-Disposition', `attachment; filename="everstats-discovery-combined-catalog${version ? `-${version}` : ''}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  }));

  r.get('/runs/:id/catalog', route(async (req, res) => {
    const id = intParam(req.params.id);
    res.json({ catalog: await loadCatalog(db, id) });
  }));

  // The raw response log, newest last, metadata only (bodies one at a time below).
  r.get('/runs/:id/responses', route(async (req, res) => {
    const id = intParam(req.params.id);
    const limit = pageLimit(req.query.limit, { fallback: 100, max: 200 });
    const after = req.query.after ? intParam(req.query.after) : 0;
    const endpoint = typeof req.query.endpoint === 'string' && req.query.endpoint ? req.query.endpoint.slice(0, 100) : null;
    const rows = await db.query(
      `SELECT id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, bytes, truncated, error, fetched_at
         FROM discovery_responses WHERE run_id = $1 AND id > $2 AND ($3::text IS NULL OR endpoint = $3) ORDER BY id LIMIT $4`,
      [id, after, endpoint, limit + 1],
    );
    res.json({ responses: rows.slice(0, limit), nextAfter: rows.length > limit ? rows[limit - 1].id : null });
  }));

  r.get('/responses/:id', route(async (req, res) => {
    const row = await db.one('SELECT * FROM discovery_responses WHERE id = $1', [intParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'Not found');
    if (req.query.download === '1') {
      // The body exactly as Blizzard sent it, as a file (never rendered here: text/plain + attachment + nosniff).
      res.set('Content-Disposition', `attachment; filename="everstats-discovery-response-${row.id}.json"`);
      return res.type('text/plain; charset=utf-8').send(row.body ?? '');
    }
    res.json({ response: row });
  }));

  // A decision on the statistic as the page shows it: `runId` names a run's catalog, `combined: true` the combined
  // one. Decisions belong to the statistic, not the run, so they apply in every view and survive re-analysis.
  //   kind = a suggestion kind: approve / reject / clear the suggestion currently shown
  //   kind = 'value_type': set the value type (decision 'approved', `value` one of VALUE_TYPES) or clear it
  r.put('/decisions', writes, route(async (req, res) => {
    const { statisticId, kind, decision } = req.body ?? {};
    const runId = req.body?.combined === true ? null : intParam(req.body?.runId);
    const version = versionParam(req.body?.version);
    if (!DECISION_KINDS.includes(kind) || !DECISIONS.includes(decision) || !Number.isSafeInteger(statisticId)) throw new HttpError(400, 'That isn’t a decision.', 'invalid');
    const [stat] = (await loadCatalog(db, runId, { version })).filter((s) => s.statisticId === statisticId);
    if (!stat) throw new HttpError(404, 'Not found');
    let value;
    let reasoning;
    if (kind === 'value_type') {
      if (decision === 'rejected') throw new HttpError(400, 'Choose a value type, or clear your correction.', 'invalid');
      value = decision === 'cleared' ? stat.analysedValueType : req.body?.value;
      if (!VALUE_TYPES.includes(value)) throw new HttpError(400, 'That isn’t a value type.', 'invalid');
      reasoning = decision === 'cleared' ? 'Correction cleared: back to the analysis.' : `Set by the admin (the analysis said "${stat.analysedValueType}").`;
    } else {
      const suggestion = stat.suggestions.find((s) => s.kind === kind);
      if (!suggestion) throw new HttpError(404, 'Not found');
      if (suggestion.value === null && decision !== 'cleared') throw new HttpError(400, 'There’s nothing to decide yet: the samples can’t settle this one.', 'unknown');
      value = suggestion.value;
      reasoning = suggestion.reasoning;
    }
    await db.tx(async (q) => {
      await q.query(
        'INSERT INTO discovery_decisions (statistic_id, kind, value, decision, reasoning, run_id, game_version) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)',
        [statisticId, kind, JSON.stringify(value), decision, String(reasoning).slice(0, 600), runId, version ?? PRIMARY_VERSION.id],
      );
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.decided', $1::jsonb)", [JSON.stringify({ statisticId, kind, decision })]);
      // 0.6.0: tiers are graded from the live decisions. One full grading follows a burst of decisions (debounced).
      await requestTierRecompute(q, 'decision');
    });
    clearCatalogCache(); // character pages and boards follow the decision at once
    const [after] = (await loadCatalog(db, runId, { version })).filter((s) => s.statisticId === statisticId);
    res.json({ statistic: after });
  }));

  // ---- exports (GET, so a plain download link works; the admin cookie is SameSite=Strict and same-origin)
  r.get('/runs/:id/export.csv', route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT id, options, summary FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
    if (isProbe(run)) {
      if (!run.summary) throw new HttpError(409, 'That probe has no results yet.', 'not_done');
      res.set('Content-Disposition', `attachment; filename="everstats-probe-${id}.csv"`);
      return res.type('text/csv; charset=utf-8').send(probeCsv(run.summary));
    }
    const csv = catalogCsv(await loadCatalog(db, id));
    res.set('Content-Disposition', `attachment; filename="everstats-discovery-${id}-catalog.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  }));

  r.get('/runs/:id/export.json', route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
    if (isProbe(run)) {
      // Every request with its body, each cut to MAX_EXPORT_BODY characters (the field outline and counts in the
      // summary come from the full bodies; any body in full is on the page, Raw responses).
      const raw = await db.query(
        `SELECT id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, headers, content_type, bytes, truncated, error, fetched_at,
                left(body, $2) AS body, (length(body) > $2) AS body_cut
           FROM discovery_responses WHERE run_id = $1 ORDER BY id LIMIT 5000`,
        [id, MAX_EXPORT_BODY],
      );
      res.set('Content-Disposition', `attachment; filename="everstats-probe-${id}.json"`);
      return res.json({
        exportedAt: new Date().toISOString(),
        note: `Everstats endpoint probe export (${versionById(run.options?.version ?? PRIMARY_VERSION.id)?.name ?? run.options?.version}, ${run.options?.region ?? PRIMARY_SCOPE.region}). "summary.answers" answers the questions in words; "summary.realms" every realm and its type; "summary.statistics" the statistic catalog compared with Forever's; "summary.groups" each group with Forever's choice as a suggestion (nothing applied); "summary.boards.list" every board rule A7 would make and "summary.boards.skipped" every field that isn't one, with why; "summary.render" the render check; "summary.entries" is every endpoint in Blizzard's docs as tried on this version (status, size, item count, values tried and why, or why it was skipped); "summary.skeletons" each answer's field outline by response id; "raw" every request with its body cut to ${MAX_EXPORT_BODY} characters (body_cut). Blizzard data: delete this file within 30 days.`,
        run: runView(run, { skeletons: true }),
        raw,
      });
    }
    const primary = run.summary?.characters?.[0]?.path ?? null;
    // Raw bodies, exactly as received, for the evidence that answers the run's questions: game data, the account,
    // the slug probes, the guild's profile, and every endpoint of the primary character. The rest stay on the page.
    const raw = await db.query(
      `SELECT id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, headers, content_type, bytes, truncated, error, fetched_at, body
         FROM discovery_responses
        WHERE run_id = $1 AND (subject_kind IN ('data', 'account', 'probe') OR endpoint = 'guild.profile' OR (subject_kind = 'character' AND subject = $2))
        ORDER BY id LIMIT 2000`,
      [id, primary],
    );
    const log = await db.query(
      `SELECT id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, bytes, error, fetched_at
         FROM discovery_responses WHERE run_id = $1 ORDER BY id LIMIT 100000`,
      [id],
    );
    res.set('Content-Disposition', `attachment; filename="everstats-discovery-${id}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      note: 'Everstats discovery export. "summary" is the run’s analysis; "catalog" every statistic seen with suggestions and the admin’s decisions; "requests" every request the run made (no bodies); "raw" the bodies, exactly as received, of game data, account, slug probes, guild profile and the primary character.',
      run: runView(run, { skeletons: true }),
      catalog: await loadCatalog(db, id),
      requests: log,
      raw,
    });
  }));

  return r;
}
