import { BLIZZARD_API, config } from '../../core/config.js';
import { APP_VERSION } from '../../core/version.js';
import { SourceError } from '../../sources/blizzard.js';
import { openSource } from '../../sources/registry.js';
import { createObserver, hrefsIn, namespacesIn, pickStaticNamespace, skeleton } from '../analyze.js';
import { characterPath } from '../endpoints.js';
import { grantToken } from '../grant.js';
import { probeAnswers } from './answers.js';
import { PROBE_AREAS, PROBE_ENDPOINTS, probeEndpointById, probeResponseEndpoint, templateParams } from './endpoints.js';

/**
 * The endpoint probe (0.8.3): one request (or a few) per entry of probe/endpoints.js, in order, against WoW Forever,
 * each stored as a discovery_responses row like any discovery run's (same 30-day retention), 404s and failures
 * included. Nothing is filled in: a {param} with no real value to try is a recorded skip, never a guess.
 *
 * `live` is what only the run knew (which response answered which entry with which values, and why each skip happened);
 * analyseProbe() builds the results and the plain-English answers from it plus the stored responses, so a probe can be
 * re-analysed later without asking Blizzard anything.
 */
const MAX_DISCOVERED = 2; // discovered values tried per entry, stopping at the first 200
const HEARTBEAT_EVERY = 5; // requests
const OUTLINE = { maxDepth: 6, maxKeys: 150 };
const ANALYSE_BATCH = 20;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const decode = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};
const pathOf = (href) => {
  try {
    return new URL(href, BLIZZARD_API.apiHost).pathname;
  } catch {
    return null;
  }
};
const nsOf = (href) => {
  try {
    return new URL(href, BLIZZARD_API.apiHost).searchParams.get('namespace');
  } catch {
    return null;
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => String.fromCharCode(92) + ch);

/** A path template → a regex over a decoded path, capturing each {param} (case-insensitive: slugs are lower case). */
export function templateRegex(template) {
  const names = [];
  let src = '';
  for (const m of String(template).matchAll(/\{([A-Za-z]+)\}|[^{]+/g)) {
    if (m[1]) {
      names.push(m[1]);
      src += '([^/?#]+?)';
    } else {
      src += escapeRe(m[0]);
    }
  }
  return { re: new RegExp(`^${src}$`, 'i'), names };
}

/** The top-level arrays of a document (minus _links): { key: length }, and the largest one: the index's item list. */
export function listsOf(json) {
  const lists = {};
  if (Array.isArray(json)) lists['(root)'] = json.length;
  else if (isObj(json)) for (const [k, v] of Object.entries(json)) if (k !== '_links' && Array.isArray(v)) lists[k] = v.length;
  const [listKey = null, count = null] = Object.entries(lists).sort((a, b) => b[1] - a[1])[0] ?? [];
  return { lists, listKey, count };
}

const largestList = (json) => {
  const { listKey } = listsOf(json);
  if (listKey === null) return [];
  return listKey === '(root)' ? json : json[listKey];
};

/** A listed item's value for a {param}: its slug for a *Slug, its type for a *Type, else its id; a bare value as is. */
function itemValue(item, param) {
  if (typeof item === 'string' || typeof item === 'number') return item;
  if (!isObj(item)) return null;
  const v = /slug/i.test(param) ? item.slug : /type/i.test(param) ? (item.type ?? item.id) : item.id;
  return typeof v === 'string' || typeof v === 'number' ? v : null;
}

const fill = (template, ctx, values = {}) => String(template)
  .replace('{C}', ctx.C).replace('{G}', ctx.G)
  .replace(/\{([A-Za-z]+)\}/g, (m, k) => encodeURIComponent(String(values[k])));

/**
 * Candidate values for an entry from one earlier 200 answer, best first:
 *   1. the entry's custom `pick`;
 *   2. links in the answer whose path matches this entry's path (they carry their own namespace);
 *   3. the answer's own values, when they cover every {param} ("the same season as …");
 *   4. the ids its item list carries, when exactly one {param} is still missing.
 */
export function candidatesFrom(entry, src, success, ctx) {
  const fixed = entry.fixed ?? {};
  const needed = templateParams(entry.path).filter((p) => !(p in fixed));
  const fromLabel = success.path;
  if (entry.pick) {
    return entry.pick(success.json).map((v) => ({ values: { ...v, ...fixed }, ns: null, basis: `read from ${fromLabel}` }));
  }
  const tpl = String(entry.path).replace('{C}', ctx.C).replace('{G}', ctx.G).replace(/\{([A-Za-z]+)\}/g, (m, k) => (k in fixed ? encodeURIComponent(String(fixed[k])) : m));
  const { re, names } = templateRegex(tpl);
  const out = [];
  const seen = new Set();
  const own = decode(String(success.path).split('?')[0]).toLowerCase();
  for (const { href } of hrefsIn(success.json)) {
    const p = pathOf(href);
    if (!p || decode(p).toLowerCase() === own) continue;
    const m = re.exec(decode(p));
    if (!m) continue;
    const values = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    if (Object.values(values).some((v) => String(v).toLowerCase() === 'index')) continue;
    const key = JSON.stringify(values);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ values: { ...values, ...fixed }, ns: nsOf(href), basis: `linked from ${fromLabel}` });
  }
  if (out.length) return out;
  const known = success.values ?? {};
  const missing = needed.filter((p) => !(p in known));
  if (needed.length && missing.length === 0) {
    return [{ values: { ...Object.fromEntries(needed.map((p) => [p, known[p]])), ...fixed }, ns: null, basis: `same values as ${fromLabel}` }];
  }
  if (missing.length === 1) {
    const base = Object.fromEntries(needed.filter((p) => p in known).map((p) => [p, known[p]]));
    for (const item of largestList(success.json)) {
      const v = itemValue(item, missing[0]);
      if (v === null || String(v).toLowerCase() === 'index') continue;
      const values = { ...base, [missing[0]]: String(v), ...fixed };
      const key = JSON.stringify(values);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ values, ns: null, basis: `listed in ${fromLabel}` });
    }
  }
  return out;
}

const subjectKind = (e) => (e.id.startsWith('character.') ? 'character' : e.id.startsWith('guild.') ? 'guild' : e.id.startsWith('account.') ? 'account' : 'data');
const ALT = { static: 'dynamic', dynamic: 'static' };

export async function runProbe({ db, runId, fetch = globalThis.fetch, sleep, now = Date.now }) {
  const run = await db.one('SELECT id, options FROM discovery_runs WHERE id = $1', [runId]);
  const opts = run.options;
  const source = await openSource(db, 'blizzard', { fetch, perSecond: opts.requestsPerSecond, ...(sleep ? { sleep } : {}), now });
  await source.appToken(); // fail fast, with a clear reason, if the app's keys don't work
  const grant = await grantToken(db);

  const ctx = {
    C: characterPath(opts.primary.slug),
    G: `/data/wow/guild/${encodeURIComponent(opts.guild.slug)}`,
    primaryId: null,
  };
  const ns = { profile: BLIZZARD_API.namespaces.profile, dynamic: BLIZZARD_API.namespaces.dynamic, static: null };
  const namespaceLinks = {};
  const live = { attempts: [], skipped: {}, userToken: Boolean(grant), stopped: null, character: ctx.C, guild: ctx.G };
  const results = new Map(); // entry id → { success: { json, values, namespace, path }, statuses: [] }
  const progress = { phase: 'starting', requests: 0, entriesDone: 0, entriesTotal: PROBE_ENDPOINTS.length, answered: 0, skipped: 0 };
  let sinceBeat = 0;
  let stopRequested = false;

  async function beat(force = false) {
    sinceBeat += 1;
    if (!force && sinceBeat < HEARTBEAT_EVERY) return;
    sinceBeat = 0;
    await db.query('UPDATE discovery_runs SET progress = $2::jsonb, heartbeat_at = now() WHERE id = $1', [runId, JSON.stringify(progress)]);
  }
  async function shouldStop() {
    if (stopRequested) return true;
    const row = await db.one('SELECT stop_requested_at FROM discovery_runs WHERE id = $1', [runId]);
    stopRequested = Boolean(row?.stop_requested_at);
    return stopRequested;
  }

  const kindNs = (kind) => {
    if (kind === 'static' && !ns.static) ns.static = pickStaticNamespace(namespaceLinks, { region: config.region });
    return ns[kind] ?? null;
  };

  /** One request, stored. A link to another host is refused and stored as such, never fetched. */
  async function attempt(e, path, namespace, values, basis) {
    let r;
    try {
      r = await source.get(path, { namespace, auth: e.auth === 'user' ? 'user' : 'app', userToken: e.auth === 'user' ? grant.token : null, query: e.query ?? null });
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      r = { path: String(path).slice(0, 300), namespace: namespace ?? null, auth: e.auth === 'user' ? 'user' : 'app', status: null, latencyMs: null, attempts: 0, headers: {}, contentType: null, bytes: null, body: null, truncated: false, json: null, error: err.code, fetchedAt: new Date(now()).toISOString() };
    }
    const row = await db.one(
      `INSERT INTO discovery_responses (run_id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, headers, content_type, bytes, body, truncated, error, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [runId, probeResponseEndpoint(e.id), subjectKind(e), subjectKind(e) === 'character' ? ctx.C : subjectKind(e) === 'guild' ? ctx.G : '', r.path, r.namespace, r.auth, r.status, r.latencyMs, r.attempts,
        JSON.stringify(r.headers), r.contentType, r.bytes, r.body, r.truncated, r.error, r.fetchedAt],
    );
    for (const n of namespacesIn(r.body)) {
      namespaceLinks[n] ??= { count: 0, firstEndpoint: e.id };
      namespaceLinks[n].count += 1;
    }
    live.attempts.push({ entry: e.id, responseId: Number(row.id), path: r.path, namespace: r.namespace, values, basis });
    progress.requests += 1;
    const res = results.get(e.id) ?? { success: null, statuses: [] };
    res.statuses.push(r.status);
    if (r.status === 200 && r.json !== null && !res.success) {
      res.success = { json: r.json, values, namespace: r.namespace, path: r.path };
      progress.answered += 1;
    }
    results.set(e.id, res);
    await beat();
    return r;
  }

  const skip = (e, reason) => {
    live.skipped[e.id] = reason;
    progress.skipped += 1;
  };
  const statusText = (id) => {
    if (live.skipped[id]) return 'skipped';
    const st = results.get(id)?.statuses ?? [];
    return st.length ? st.map((x) => (x === null ? 'no answer' : x)).join('/') : 'not asked';
  };

  function realmState() {
    const r = results.get('data.connected-realm-index');
    if (r?.success && (listsOf(r.success.json).count ?? 0) > 0) return null;
    if (!r) return 'connected-realm/index wasn’t asked';
    if (r.success) return 'Forever has no connected realms: connected-realm/index answered 200 with an empty list';
    return `Forever has no connected realms we can see: connected-realm/index answered ${statusText('data.connected-realm-index')}`;
  }

  async function runEntry(e) {
    if (e.auth === 'user' && !grant) return skip(e, 'needs user token: authorize Battle.net on the Discovery page first');
    if (e.realms) {
      const why = realmState();
      if (why) return skip(e, why);
    }
    const namespace = kindNs(e.ns);
    if (!namespace) return skip(e, 'no static namespace was detected in any answer so far, and none is ever guessed');
    const params = templateParams(e.path).filter((p) => !(p in (e.fixed ?? {})));

    if (params.length === 0) {
      if (await shouldStop()) return null;
      const r = await attempt(e, fill(e.path, ctx, e.fixed), namespace, e.fixed ?? {}, 'no parameters');
      const alt = ALT[e.ns] ? kindNs(ALT[e.ns]) : null;
      if (r.status === 404 && alt && e.path.startsWith('/data/') && !e.id.startsWith('guild.')) {
        if (await shouldStop()) return null;
        await attempt(e, fill(e.path, ctx, e.fixed), alt, e.fixed ?? {}, `asked again in the ${ALT[e.ns]} namespace after a 404`);
      }
      return null;
    }

    let candidates = [];
    let common = false;
    const tried = [];
    for (const src of e.from ?? []) {
      const res = results.get(src);
      if (!res?.success) {
        tried.push(`${src.replace(/^[a-z]+\./, '')} ${statusText(src)}`);
        continue;
      }
      candidates = candidatesFrom(e, src, res.success, ctx).map((cand) => ({
        ...cand,
        ns: cand.ns ?? (probeEndpointById.get(src)?.path.startsWith('/data/') && probeEndpointById.get(src).ns !== 'profile' ? res.success.namespace : null),
      }));
      if (candidates.length) break;
      tried.push(`${src.replace(/^[a-z]+\./, '')} answered with no ${params.join('/')} in it`);
    }
    if (!candidates.length && e.common) {
      candidates = e.common.map((values) => ({ values: { ...values, ...(e.fixed ?? {}) }, ns: null, basis: 'common value (no index lists these)' }));
      common = true;
    }
    if (!candidates.length) return skip(e, `no real ${params.join(' / ')} to try (${tried.join('; ') || 'no source'})`);
    if (e.preferPrimary && ctx.primaryId !== null) {
      candidates.sort((a, b) => (String(b.values[e.preferPrimary]) === String(ctx.primaryId)) - (String(a.values[e.preferPrimary]) === String(ctx.primaryId)));
    }
    for (const cand of common ? candidates : candidates.slice(0, MAX_DISCOVERED)) {
      if (await shouldStop()) return null;
      const r = await attempt(e, fill(e.path, ctx, cand.values), cand.ns ?? namespace, cand.values, cand.basis);
      if (!common && r.status === 200) break;
    }
    return null;
  }

  const areaLabel = new Map(PROBE_AREAS.map((a) => [a.id, a.label]));
  for (const e of PROBE_ENDPOINTS) {
    if (await shouldStop()) break;
    progress.phase = `${areaLabel.get(e.area)}: ${e.path.replace('{C}', 'character').replace('{G}', 'guild')}`;
    await beat(true);
    await runEntry(e);
    if (e.id === 'character.profile') {
      const id = results.get(e.id)?.success?.json?.id;
      ctx.primaryId = Number.isFinite(id) ? id : null;
    }
    progress.entriesDone += 1;
  }
  if (stopRequested) live.stopped = { afterEntries: progress.entriesDone, afterRequests: progress.requests };
  live.namespaces = { profile: ns.profile, dynamic: ns.dynamic, staticDetected: ns.static ?? pickStaticNamespace(namespaceLinks, { region: config.region }) };
  progress.phase = 'analysing';
  await beat(true);
  return { summary: await analyseProbe(db, runId, live, opts), stopped: Boolean(live.stopped) };
}

const TIMESTAMPISH = /timestamp|_at$|date|acquired|first_?seen|collected_?on/i;

/** What one stored response says, without its body: counts, lists, top-level numbers, timestamp-like keys, outline. */
export function factsOf(row) {
  const f = {
    responseId: Number(row.id), status: row.status, latencyMs: row.latency_ms, bytes: row.bytes, error: row.error, retries: Math.max(0, (row.attempts ?? 1) - 1),
    count: null, listKey: null, lists: {}, numbers: {}, timestampKeys: [], outline: null,
  };
  if (row.status !== 200 || row.body === null || row.truncated) return f;
  let json;
  try {
    json = JSON.parse(row.body);
  } catch {
    return f;
  }
  Object.assign(f, listsOf(json));
  if (isObj(json)) for (const [k, v] of Object.entries(json)) if (typeof v === 'number' || typeof v === 'boolean') f.numbers[k] = v;
  f.outline = skeleton(json, OUTLINE);
  f.timestampKeys = Object.keys(f.outline).filter((k) => k.includes('[]') && TIMESTAMPISH.test(k.split('.').at(-1)));
  return f;
}

/** The results, totals and answers of a probe, from its stored responses and `live` only (no request to Blizzard). */
export async function analyseProbe(db, runId, live, options = null) {
  const opts = options ?? (await db.one('SELECT options FROM discovery_runs WHERE id = $1', [runId]))?.options ?? {};
  const obs = createObserver();
  const facts = new Map();
  for (let after = 0; ;) {
    const rows = await db.query(
      `SELECT id, endpoint, subject, path, namespace, auth, status, latency_ms, attempts, headers, content_type, bytes, body, truncated, error, fetched_at
         FROM discovery_responses WHERE run_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [runId, after, ANALYSE_BATCH],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      after = row.id;
      let json = null;
      if (row.status === 200 && row.body !== null && !row.truncated) {
        try {
          json = JSON.parse(row.body);
        } catch {
          json = null;
        }
      }
      obs.add(row.endpoint, row.subject, {
        path: row.path, namespace: row.namespace, auth: row.auth, status: row.status, latencyMs: row.latency_ms, attempts: row.attempts,
        headers: row.headers, contentType: row.content_type, bytes: row.bytes, body: row.body, truncated: row.truncated, json, error: row.error,
        fetchedAt: new Date(row.fetched_at).toISOString(),
      });
      facts.set(Number(row.id), factsOf(row));
    }
  }

  const skeletons = {};
  const entries = PROBE_ENDPOINTS.map((e) => {
    const attempts = live.attempts.filter((a) => a.entry === e.id).map((a) => {
      const f = facts.get(a.responseId) ?? { status: null, error: 'response no longer stored' };
      const { outline, ...rest } = f;
      if (outline) skeletons[a.responseId] = outline;
      return { ...a, ...rest };
    });
    const best = attempts.find((a) => a.status === 200) ?? attempts.at(-1) ?? null;
    const skipped = live.skipped[e.id] ?? null;
    const outcome = best?.status === 200 ? 'answered' : skipped ? 'skipped' : !best ? 'not asked' : best.status === 404 ? 'not found' : 'other';
    return {
      id: e.id, area: e.area, template: e.path, nsKind: e.ns,
      flags: ['first', 'later', 'classic', 'guess'].filter((k) => e[k]), auth: e.auth ?? 'app',
      outcome, skipped, best: best ? best.responseId : null, attempts,
    };
  });

  const areas = PROBE_AREAS.map((a) => {
    const list = entries.filter((x) => x.area === a.id);
    const tally = (o) => list.filter((x) => x.outcome === o).length;
    return { id: a.id, label: a.label, entries: list.length, answered: tally('answered'), notFound: tally('not found'), other: tally('other'), skipped: tally('skipped'), notAsked: tally('not asked') };
  });

  const base = obs.summary();
  const { answers, unexpected } = probeAnswers(entries, { foreverTerms: base.foreverTerms, primary: opts.primary ?? null, userToken: live.userToken });
  return {
    kind: 'probe',
    live,
    primary: opts.primary ?? null,
    guild: opts.guild ?? null,
    namespaces: live.namespaces ?? null,
    stopped: live.stopped ?? null,
    requests: base.requests,
    retried: base.retried,
    throttled: base.throttled,
    firstRequestAt: base.firstRequestAt,
    lastRequestAt: base.lastRequestAt,
    wallMs: base.wallMs,
    latency: base.latency,
    rateHeaders: base.rateHeaders,
    foreverTerms: base.foreverTerms.map((t) => ({ ...t, hits: t.hits.slice(0, 40), total: t.hits.length })),
    entryCount: entries.length,
    areas,
    answers,
    unexpected,
    entries,
    skeletons,
    analysedAt: new Date().toISOString(),
    analysedWith: APP_VERSION,
  };
}

/** Claims nothing: runs one probe and records how it ended ('done', 'stopped' or 'failed'). Errors in this app's words. */
export async function executeProbe({ db, runId, fetch, sleep }) {
  try {
    const { summary, stopped } = await runProbe({ db, runId, fetch, sleep });
    const status = stopped ? 'stopped' : 'done';
    await db.query(
      `UPDATE discovery_runs SET status = $3, finished_at = now(), heartbeat_at = now(), summary = $2::jsonb,
              problem = CASE WHEN $3 = 'stopped' THEN 'Stopped by the admin; the results cover what was asked before that.' ELSE NULL END,
              progress = jsonb_set(progress, '{phase}', to_jsonb($3::text)) WHERE id = $1`,
      [runId, JSON.stringify(summary), status],
    );
    return status;
  } catch (err) {
    const problem = err instanceof SourceError ? err.message : `Stopped by an unexpected ${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}`;
    if (!(err instanceof SourceError)) console.error(`[discovery] probe ${runId} failed: ${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}\n${String(err?.stack ?? '').split('\n').slice(1, 5).join('\n')}`);
    await db.query("UPDATE discovery_runs SET status = 'failed', finished_at = now(), problem = $2 WHERE id = $1", [runId, problem.slice(0, 400)]);
    return 'failed';
  }
}

// ---- CSV: one row per request, and one per skipped entry
const FORMULA = /^[=+\-@\t\r]/;
const cell = (v, { text = false } = {}) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (text && FORMULA.test(s)) s = `'${s}`; // a spreadsheet must never run a Blizzard string as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function probeCsv(summary) {
  const areaLabel = new Map(PROBE_AREAS.map((a) => [a.id, a.label]));
  const head = ['area', 'endpoint_id', 'template', 'flags', 'outcome', 'path_tried', 'namespace', 'values', 'basis', 'status', 'latency_ms', 'bytes', 'item_count', 'list_key', 'lists', 'timestamp_keys', 'skipped_reason', 'response_id', 'field_outline'];
  const lines = [head.join(',')];
  for (const e of summary.entries ?? []) {
    const common = [cell(areaLabel.get(e.area) ?? e.area), cell(e.id), cell(e.template, { text: true }), cell(e.flags.join(' ')), cell(e.outcome)];
    if (e.attempts.length === 0) {
      lines.push([...common, '', '', '', '', '', '', '', '', '', '', '', cell(e.skipped ?? (e.outcome === 'not asked' ? 'not asked: the probe was stopped first' : ''), { text: true }), '', ''].join(','));
      continue;
    }
    for (const a of e.attempts) {
      const outline = summary.skeletons?.[a.responseId];
      lines.push([...common, cell(a.path, { text: true }), cell(a.namespace), cell(Object.keys(a.values ?? {}).length ? a.values : ''), cell(a.basis, { text: true }), cell(a.status ?? 'no answer'),
        cell(a.latencyMs), cell(a.bytes), cell(a.count), cell(a.listKey, { text: true }), cell(Object.keys(a.lists ?? {}).length ? a.lists : '', { text: true }), cell((a.timestampKeys ?? []).join(' '), { text: true }),
        cell(e.skipped, { text: true }), cell(a.responseId), cell(outline ? Object.entries(outline).map(([k, t]) => `${k}: ${t}`).join('; ') : '', { text: true })].join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
