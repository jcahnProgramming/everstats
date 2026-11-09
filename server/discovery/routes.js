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
import { guessValueType } from './analyze.js';

/**
 * /api/admin/discovery/*: mounted INSIDE the admin router, after its gate, so without an admin session every one of
 * these is the same plain 404 as a path that doesn't exist. Raw payloads leave the server only through here.
 */
const MAX_CATALOG_ROWS = 20_000;
const MAX_REANALYSE_RUNS = 50;
const KINDS = SUGGESTION_KINDS; // decisions on a suggestion
const DECISION_KINDS = [...SUGGESTION_KINDS, 'value_type']; // … plus the admin's own value-type corrections
const DECISIONS = ['approved', 'rejected', 'cleared'];

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
    ...(summary !== undefined ? { summary } : {}),
  };
};

/**
 * A catalog with suggestions computed against the admin's current decisions (suggest.js present()). `runId` null is
 * the combined catalog of every finished run; a number is that run's own catalog. Only the decision-free stored
 * `suggestions` snapshot is ignored here: what the page shows always follows the current decisions.
 */
async function loadCatalog(db, runId) {
  const rows = runId === null
    ? [...await db.query('SELECT * FROM discovery_catalog ORDER BY statistic_id LIMIT $1', [MAX_CATALOG_ROWS]), ...await productionOnly(db)]
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
  }, decisions.get(r.statistic_id) ?? new Map()));
}

/**
 * Statistics the production crawler has seen that no discovery run has (0.4.0: the catalog grows from production
 * crawls). Shaped like discovery_catalog rows, with counts measured from the production tables, so the combined
 * catalog shows them for approval like any other. Their value type is the same name-based guess discovery makes.
 */
async function productionOnly(db) {
  const sampled = (await db.one('SELECT count(*)::int AS n FROM characters WHERE stats_fetched_at IS NOT NULL')).n;
  const rows = await db.query(
    `SELECT s.id, s.name, s.category_path, s.has_text, s.named_example,
            (SELECT count(*)::int FROM character_statistics cs WHERE cs.statistic_id = s.id) AS present,
            (SELECT count(*)::int FROM character_statistics cs WHERE cs.statistic_id = s.id AND cs.value <> 0) AS nonzero,
            (SELECT min(value) FROM character_statistics cs WHERE cs.statistic_id = s.id) AS min_value,
            (SELECT max(value) FROM character_statistics cs WHERE cs.statistic_id = s.id) AS max_value
       FROM statistics s WHERE NOT EXISTS (SELECT 1 FROM discovery_catalog d WHERE d.statistic_id = s.id)
      ORDER BY s.id LIMIT $1`,
    [MAX_CATALOG_ROWS],
  );
  return rows.map((r) => {
    const g = guessValueType(r.name, { namedExample: r.named_example });
    return {
      statistic_id: r.id, name: r.name, endpoint: 'character.achievement-statistics', category_path: r.category_path,
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
  const runs = await db.query("SELECT id, summary FROM discovery_runs WHERE status = 'done' AND summary IS NOT NULL ORDER BY id DESC LIMIT $1", [MAX_REANALYSE_RUNS]);
  for (const run of runs) {
    const summary = await analyseStored(db, run.id, run.summary);
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

export function createDiscoveryRouter({ db, limits, networkOf, limitBy }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const source = getSource('blizzard');

  r.get('/', route(async (req, res) => {
    const limit = pageLimit(req.query.limit, { fallback: 25, max: 100 });
    const before = req.query.before ? intParam(req.query.before) : null;
    const rows = await db.query(
      `SELECT id, status, requested_at, started_at, finished_at, heartbeat_at, options, progress, problem,
              (summary IS NOT NULL) AS has_summary, summary->'requests' AS requests, summary->'catalogSize' AS catalog_size, summary->'wallMs' AS wall_ms
         FROM discovery_runs WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
      [before, limit + 1],
    );
    const settings = (await listSettings(db)).filter((s) => s.section === 'discovery');
    res.json({
      configured: await isConfigured(db, source.credential),
      grant: await grantStatus(db),
      settings,
      runs: rows.slice(0, limit).map((x) => ({ ...runView({ ...x, summary: undefined }), requests: x.requests, catalogSize: x.catalog_size, wallMs: x.wall_ms })),
      nextBefore: rows.length > limit ? rows[limit - 1].id : null,
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
    const row = await db.tx(async (q) => {
      await q.query('LOCK TABLE discovery_runs IN SHARE ROW EXCLUSIVE MODE');
      const busy = await q.one("SELECT id FROM discovery_runs WHERE status IN ('queued', 'running') LIMIT 1");
      if (busy) throw new HttpError(409, `Run #${busy.id} hasn't finished yet.`, 'busy');
      const created = await q.one("INSERT INTO discovery_runs (status, options) VALUES ('queued', $1::jsonb) RETURNING *", [JSON.stringify(options)]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.queued', $1::jsonb)", [JSON.stringify({ run: created.id })]);
      return created;
    });
    res.status(201).json({ run: runView(row) });
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
    if (run.status !== 'done' || !run.summary) throw new HttpError(409, 'Only a finished run can be re-analysed.', 'not_done');
    const summary = await analyseStored(db, id, run.summary);
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
    res.json({ combined: await combinedView(db), catalog: await loadCatalog(db, null) });
  }));
  r.post('/reanalyse', writes, route(async (req, res) => {
    await reanalyseAll(db);
    res.json({ combined: await combinedView(db) });
  }));
  r.get('/catalog/export.csv', route(async (req, res) => {
    const csv = catalogCsv(await loadCatalog(db, null));
    res.set('Content-Disposition', 'attachment; filename="everstats-discovery-combined-catalog.csv"');
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
    if (!DECISION_KINDS.includes(kind) || !DECISIONS.includes(decision) || !Number.isSafeInteger(statisticId)) throw new HttpError(400, 'That isn’t a decision.', 'invalid');
    const [stat] = (await loadCatalog(db, runId)).filter((s) => s.statisticId === statisticId);
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
        'INSERT INTO discovery_decisions (statistic_id, kind, value, decision, reasoning, run_id) VALUES ($1, $2, $3::jsonb, $4, $5, $6)',
        [statisticId, kind, JSON.stringify(value), decision, String(reasoning).slice(0, 600), runId],
      );
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.decided', $1::jsonb)", [JSON.stringify({ statisticId, kind, decision })]);
    });
    clearCatalogCache(); // character pages and boards follow the decision at once
    const [after] = (await loadCatalog(db, runId)).filter((s) => s.statisticId === statisticId);
    res.json({ statistic: after });
  }));

  // ---- exports (GET, so a plain download link works; the admin cookie is SameSite=Strict and same-origin)
  r.get('/runs/:id/export.csv', route(async (req, res) => {
    const id = intParam(req.params.id);
    const csv = catalogCsv(await loadCatalog(db, id));
    res.set('Content-Disposition', `attachment; filename="everstats-discovery-${id}-catalog.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  }));

  r.get('/runs/:id/export.json', route(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await db.one('SELECT * FROM discovery_runs WHERE id = $1', [id]);
    if (!run) throw new HttpError(404, 'Not found');
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
