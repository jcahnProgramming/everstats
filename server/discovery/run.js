import { BLIZZARD_API, config } from '../core/config.js';
import { SourceError } from '../sources/blizzard.js';
import { openSource } from '../sources/registry.js';
import { FOREVER_TERMS, createObserver, hrefsIn, pickStaticNamespace, slugFindings } from './analyze.js';
import {
  ACCOUNT_ENDPOINTS, CHARACTER_ENDPOINTS, DATA_ENDPOINTS, GUILD_ENDPOINTS, MAX_LINKED_EXTRAS, PROTECTED_CHARACTER_SAMPLES,
  SLUG_PROBES, characterPath,
} from './endpoints.js';
import { grantToken } from './grant.js';
import { suggestionsFor } from './suggest.js';

/**
 * One discovery run, start to finish (the worker's discovery job calls this in the background):
 *
 *   1. game data: the ruleset index and every ruleset it links to, region and realm indexes (dynamic namespace)
 *   2. the Battle.net account (if authorized): /profile/user/wow and its links, with the admin's user token
 *   3. characters, until the cap: the primary character (plus slug probes), the account's characters, then the
 *      primary's guild roster. Each gets every CHARACTER_ENDPOINTS path plus any link its profile advertises.
 *   4. the primary's guild: profile, roster, activity, achievements
 *   5. static data, in the static namespace detected from the API's own links (never a hardcoded version)
 *   6. the statistics catalog with suggestions, and the summary that answers the run's questions
 *
 * Every request is stored as it was answered (discovery_responses), 404s and failures included. Nothing is
 * filled in or guessed: a question the samples can't answer says "unknown from N samples".
 */
const HEARTBEAT_EVERY = 10; // requests
const MAX_RULESET_RAW = 20_000; // characters of each ruleset's raw JSON copied into the summary

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
const lower = (p) => decodeURIComponent(p).toLowerCase();
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

/** Objects in a document that link to a character profile: what the account and roster responses list. */
export function characterEntries(json) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isObj(v)) return;
    const links = Object.entries(v).filter(([, x]) => isObj(x) && typeof x.href === 'string');
    const own = links.find(([, x]) => /\/profile\/wow\/character\//.test(x.href) && !/protected-character/.test(x.href));
    const prot = links.find(([, x]) => /protected-character/.test(x.href));
    // A roster member nests the character one level down: { character: { key: { href }, name, … }, rank }
    const nested = isObj(v.character) && isObj(v.character.key) && typeof v.character.key.href === 'string' ? v.character : null;
    if (own || prot) {
      out.push({
        href: own?.[1].href ?? null,
        protectedHref: prot?.[1].href ?? null,
        name: nameOf(v.name) ?? nameOf(v.character),
        id: Number.isFinite(v.id) ? v.id : null,
        level: Number.isFinite(v.level) ? v.level : null,
        className: nameOf(v.playable_class),
        race: nameOf(v.playable_race),
        faction: nameOf(v.faction),
        hasRealm: 'realm' in v,
        keys: Object.keys(v),
      });
    } else if (nested) {
      out.push({
        href: nested.key.href,
        protectedHref: null,
        name: nameOf(nested.name),
        id: Number.isFinite(nested.id) ? nested.id : null,
        level: Number.isFinite(nested.level) ? nested.level : null,
        className: nameOf(nested.playable_class),
        race: nameOf(nested.playable_race),
        faction: nameOf(nested.faction),
        hasRealm: 'realm' in nested,
        keys: Object.keys(nested),
        rank: Number.isFinite(v.rank) ? v.rank : null,
      });
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(json);
  return out;
}

export async function runDiscovery({ db, runId, fetch = globalThis.fetch, sleep, now = Date.now }) {
  const run = await db.one('SELECT id, options FROM discovery_runs WHERE id = $1', [runId]);
  const opts = run.options;
  const source = await openSource(db, 'blizzard', { fetch, perSecond: opts.requestsPerSecond, ...(sleep ? { sleep } : {}), now });
  await source.appToken(); // fail fast, with a clear reason, if the app's keys don't work

  const obs = createObserver();
  const ns = { dynamic: BLIZZARD_API.namespaces.dynamic, profile: BLIZZARD_API.namespaces.profile, static: null };
  const progress = { phase: 'game data', requests: 0, characters: 0, queued: 0 };
  const seenCharacterPaths = [];
  let sinceBeat = 0;

  async function beat(force = false) {
    sinceBeat += 1;
    if (!force && sinceBeat < HEARTBEAT_EVERY) return;
    sinceBeat = 0;
    await db.query('UPDATE discovery_runs SET progress = $2::jsonb, heartbeat_at = now() WHERE id = $1', [runId, JSON.stringify(progress)]);
  }
  const phase = async (name) => {
    progress.phase = name;
    await beat(true);
  };

  /** One request, stored and observed. A link to another host is refused and stored as such, never fetched. */
  async function fetchOne(endpoint, kind, subject, pathOrHref, { namespace, auth = 'app', userToken = null, catalog = false } = {}) {
    let r;
    try {
      r = await source.get(pathOrHref, { namespace, auth, userToken });
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      r = { path: String(pathOrHref).slice(0, 300), namespace: namespace ?? null, auth, status: null, latencyMs: null, attempts: 0, headers: {}, contentType: null, bytes: null, body: null, truncated: false, json: null, error: err.code, fetchedAt: new Date(now()).toISOString() };
    }
    await db.query(
      `INSERT INTO discovery_responses (run_id, endpoint, subject_kind, subject, path, namespace, auth, status, latency_ms, attempts, headers, content_type, bytes, body, truncated, error, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17)`,
      [runId, endpoint, kind, subject, r.path, r.namespace, r.auth, r.status, r.latencyMs, r.attempts, JSON.stringify(r.headers), r.contentType, r.bytes, r.body, r.truncated, r.error, r.fetchedAt],
    );
    obs.add(endpoint, subject, r, { catalog });
    progress.requests += 1;
    await beat();
    return r;
  }

  // ---- 1. game data
  const rulesetIndex = await fetchOne('data.ruleset-index', 'data', '', DATA_ENDPOINTS[0].path, { namespace: ns.dynamic });
  const rulesets = { indexStatus: rulesetIndex.status, listed: [], details: [] };
  if (rulesetIndex.json) {
    for (const v of Object.values(rulesetIndex.json)) {
      if (!Array.isArray(v)) continue;
      for (const item of v) if (isObj(item)) rulesets.listed.push({ id: item.id ?? null, name: nameOf(item.name) ?? item.name ?? null, type: item.type ?? null, href: item.key?.href ?? null, keys: Object.keys(item) });
    }
    const links = hrefsIn(rulesetIndex.json).map((h) => h.href).filter((h) => /\/data\/wow\/ruleset\/(?!index)/.test(pathOf(h) ?? ''));
    const targets = links.length ? links : rulesets.listed.filter((x) => x.id !== null).map((x) => `/data/wow/ruleset/${encodeURIComponent(x.id)}`);
    for (const t of [...new Set(targets)].slice(0, 30)) {
      const r = await fetchOne('data.ruleset', 'data', pathOf(t) ?? '', t, { namespace: nsOf(t) ?? ns.dynamic });
      rulesets.details.push({ path: r.path, status: r.status, raw: r.body ? r.body.slice(0, MAX_RULESET_RAW) : null });
    }
  }
  for (const e of DATA_ENDPOINTS.filter((d) => d.namespace === 'dynamic' && d.id !== 'data.ruleset-index')) {
    await fetchOne(e.id, 'data', '', e.path, { namespace: ns.dynamic });
  }

  // ---- 2. the account
  const account = { asked: Boolean(opts.account), authorized: false, battletag: null, status: null, characters: [], realmShaped: null };
  const queue = [{ path: characterPath(opts.primary.slug), source: 'primary', namespace: ns.profile }];
  const queued = new Set([lower(queue[0].path)]);
  const enqueue = (href, sourceName) => {
    const p = pathOf(href);
    if (!p || queued.has(lower(p))) return;
    queued.add(lower(p));
    queue.push({ path: p, source: sourceName, namespace: nsOf(href) ?? ns.profile });
  };
  if (opts.account) {
    await phase('account');
    const grant = await grantToken(db);
    if (grant) {
      account.authorized = true;
      account.battletag = grant.battletag;
      const prof = await fetchOne('account.profile', 'account', '', ACCOUNT_ENDPOINTS[0].path, { namespace: ns.profile, auth: 'user', userToken: grant.token });
      account.status = prof.status;
      if (prof.json) {
        const entries = characterEntries(prof.json);
        account.characters = entries.map(({ keys, ...e }) => ({ ...e, keys }));
        account.realmShaped = entries.length ? entries.some((e) => e.hasRealm) : null;
        for (const e of entries) if (e.href) enqueue(e.href, 'account');
        const primaryName = opts.primary.name.toLowerCase();
        const protectedSamples = [...entries].sort((a, b) => (b.name?.toLowerCase() === primaryName) - (a.name?.toLowerCase() === primaryName)).filter((e) => e.protectedHref).slice(0, PROTECTED_CHARACTER_SAMPLES);
        for (const e of protectedSamples) await fetchOne('account.protected-character', 'account', pathOf(e.protectedHref) ?? '', e.protectedHref, { auth: 'user', userToken: grant.token, namespace: nsOf(e.protectedHref) ?? ns.profile });
      }
      for (const e of ACCOUNT_ENDPOINTS.slice(1)) await fetchOne(e.id, 'account', '', e.path, { namespace: ns.profile, auth: 'user', userToken: grant.token });
    }
  }
  ns.static = pickStaticNamespace(obs.summary().namespaceLinks, { region: config.region });

  // ---- 3 + 4. characters, and the primary's guild
  const characters = [];
  let guild = { asked: Boolean(opts.guild), found: false, path: null, name: null, status: null, members: null };
  const known = new Set(CHARACTER_ENDPOINTS.map((e) => e.suffix));
  const probes = [];

  for (let i = 0; i < queue.length && characters.length < opts.maxCharacters; i++) {
    const c = queue[i];
    progress.characters = characters.length;
    progress.queued = queue.length;
    await phase(`character ${characters.length + 1} of up to ${Math.min(opts.maxCharacters, queue.length)}`);
    const subject = c.path;
    seenCharacterPaths.push(c.path);
    const profile = await fetchOne('character.profile', 'character', subject, c.path, { namespace: c.namespace });
    const j = profile.json ?? {};
    characters.push({
      path: c.path,
      source: c.source,
      status: profile.status,
      name: nameOf(j.name),
      level: Number.isFinite(j.level) ? j.level : null,
      className: nameOf(j.character_class) ?? nameOf(j.playable_class),
      race: nameOf(j.race) ?? nameOf(j.playable_race),
      faction: nameOf(j.faction),
      guild: nameOf(j.guild),
      hasRealm: 'realm' in j,
    });
    const primary = c.source === 'primary';
    if (profile.status !== 200 && !primary) continue; // nobody there: don't spend 26 more requests proving it

    await Promise.all(CHARACTER_ENDPOINTS.slice(1).map((e) => fetchOne(e.id, 'character', subject, `${c.path}${e.suffix}`, { namespace: c.namespace, catalog: Boolean(e.catalog) })));

    // Links the profile advertises that the registry doesn't list: fetch them too (that's how new endpoints show up).
    const extras = [...new Set(hrefsIn(j).map((h) => h.href).filter((h) => {
      const p = pathOf(h);
      return p && lower(p).startsWith(`${lower(c.path)}/`) && !known.has(p.slice(c.path.length));
    }))].slice(0, MAX_LINKED_EXTRAS);
    for (const h of extras) await fetchOne('character.linked', 'character', subject, h, { namespace: nsOf(h) ?? c.namespace });

    if (primary) {
      if (!ns.static) ns.static = pickStaticNamespace(obs.summary().namespaceLinks, { region: config.region });
      await phase('slug probes');
      for (const p of SLUG_PROBES) {
        const r = await fetchOne(p.id, 'probe', p.label, characterPath(p.segment(opts.primary)), { namespace: c.namespace });
        probes.push({ id: p.id, label: p.label, path: r.path, status: r.status, name: r.json ? nameOf(r.json.name) : null });
      }
      // The primary's guild, if the profile links one.
      const guildHref = (isObj(j.guild) && (j.guild.key?.href ?? j.guild.href)) || hrefsIn(j).map((h) => h.href).find((h) => /\/guild\//.test(pathOf(h) ?? '')) || null;
      guild = { ...guild, found: Boolean(guildHref), name: nameOf(j.guild), linked: Boolean(guildHref), inProfile: 'guild' in j };
      if (guildHref && opts.guild) {
        await phase('guild');
        const gPath = pathOf(guildHref);
        const gNs = nsOf(guildHref) ?? ns.profile;
        guild.path = gPath;
        for (const e of GUILD_ENDPOINTS) {
          const r = await fetchOne(e.id, 'guild', gPath, `${gPath}${e.suffix}`, { namespace: gNs });
          if (e.id === 'guild.profile') guild.status = r.status;
          if (e.id === 'guild.roster' && r.json) {
            const members = characterEntries(r.json);
            guild.members = members.length;
            guild.memberSample = members.slice(0, 5).map(({ keys, ...m }) => ({ ...m, keys }));
            for (const m of members) if (m.href) enqueue(m.href, 'guild');
          }
        }
      }
    }
  }
  for (const c of queue.slice(characters.length)) seenCharacterPaths.push(c.path);
  progress.characters = characters.length;

  // ---- 5. static data, in the detected static namespace
  await phase('static data');
  ns.static ??= pickStaticNamespace(obs.summary().namespaceLinks, { region: config.region });
  const staticNamespace = ns.static ?? BLIZZARD_API.namespaces.static;
  for (const e of DATA_ENDPOINTS.filter((d) => d.namespace === 'static')) await fetchOne(e.id, 'data', '', e.path, { namespace: staticNamespace });

  // ---- 6. catalog, suggestions, summary
  await phase('catalog');
  const catalog = obs.catalog().map((s) => ({ ...s, suggestions: suggestionsFor(s) }));
  await db.tx(async (q) => {
    for (const s of catalog) {
      await q.query(
        `INSERT INTO discovery_statistics (run_id, statistic_id, name, endpoint, category_path, value_type, value_type_basis, characters_sampled,
           characters_present, characters_nonzero, min_value, max_value, median_value, has_text, suggestions)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
        [runId, s.statisticId, s.name, s.endpoint, JSON.stringify(s.categoryPath), s.valueType, s.valueTypeBasis, s.charactersSampled, s.charactersPresent,
          s.charactersNonzero, s.minValue, s.maxValue, s.medianValue, s.hasText, JSON.stringify(s.suggestions)],
      );
    }
  });

  const base = obs.summary();
  const byTop = {};
  for (const s of catalog) {
    const top = s.categoryPath[0]?.name ?? '(no category)';
    byTop[top] = (byTop[top] ?? 0) + 1;
  }
  const primaryRow = characters[0];
  const mediaRow = await db.one("SELECT status, body FROM discovery_responses WHERE run_id = $1 AND endpoint = 'character.character-media' AND subject = $2 ORDER BY id LIMIT 1", [runId, primaryRow.path]);
  let mediaAssets = null;
  try {
    const m = mediaRow?.status === 200 ? JSON.parse(mediaRow.body) : null;
    mediaAssets = m ? (Array.isArray(m.assets) ? m.assets.map((a) => a.key ?? null) : Object.keys(m)) : null;
  } catch {
    mediaAssets = null;
  }
  const foreverInCatalog = base.foreverTerms.map((t) => ({ id: t.id, label: t.label, statistics: catalog.filter((s) => FOREVER_TEST[t.id].test(s.name) || s.categoryPath.some((c) => FOREVER_TEST[t.id].test(c.name))).map((s) => ({ id: s.statisticId, name: s.name, category: s.categoryPath.map((c) => c.name).join(' › ') })) }));

  const summary = {
    ...base,
    namespaces: {
      dynamic: ns.dynamic,
      profile: ns.profile,
      staticDetected: ns.static,
      staticUsed: staticNamespace,
      staticNote: ns.static ? 'Detected from links in the API’s own responses.' : `No versioned static namespace appeared in any link; the static requests used the unversioned guess ${staticNamespace}.`,
    },
    rulesets,
    account,
    characters,
    guild,
    slugs: { primary: opts.primary.slug, probes, findings: slugFindings(seenCharacterPaths) },
    catalogSize: catalog.length,
    catalogByBlizzardCategory: byTop,
    foreverInCatalog,
    primaryMedia: { status: mediaRow?.status ?? null, assets: mediaAssets },
  };
  return summary;
}

const FOREVER_TEST = Object.fromEntries(FOREVER_TERMS.map((t) => [t.id, t.pattern]));

/** Claims and runs one queued run; records the outcome. Errors keep to this app's words (never a body or token). */
export async function executeRun({ db, runId, fetch, sleep }) {
  try {
    const summary = await runDiscovery({ db, runId, fetch, sleep });
    await db.query("UPDATE discovery_runs SET status = 'done', finished_at = now(), heartbeat_at = now(), summary = $2::jsonb, progress = jsonb_set(progress, '{phase}', '\"done\"') WHERE id = $1", [runId, JSON.stringify(summary)]);
    return 'done';
  } catch (err) {
    const problem = err instanceof SourceError ? err.message : `Stopped by an unexpected ${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}`;
    if (!(err instanceof SourceError)) console.error(`[discovery] run ${runId} failed: ${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}\n${String(err?.stack ?? '').split('\n').slice(1, 5).join('\n')}`);
    await db.query("UPDATE discovery_runs SET status = 'failed', finished_at = now(), problem = $2 WHERE id = $1", [runId, problem.slice(0, 400)]);
    return 'failed';
  }
}
