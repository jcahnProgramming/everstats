/**
 * What a discovery run learns, built while it runs from each response (createObserver) and summed up at the end.
 * Everything here is measured from the responses; where the samples can't settle a question the summary says
 * "unknown from N samples", never a guess. Value types and categories are SUGGESTIONS (suggest.js), labelled as such.
 */

// Forever-only systems the owner asked about. Any string in any 200 response matching one is listed with where it was.
export const FOREVER_TERMS = [
  { id: 'camping', label: 'Camping', pattern: /\bcamp(?:s|ed|ing|fire|fires|site|sites)?\b/i },
  { id: 'legacy', label: 'Legacy', pattern: /\blegacy\b/i },
  { id: 'housing', label: 'Housing', pattern: /\bhousing\b|\bplayer house\b/i },
  { id: 'skyborne', label: 'Skyborne', pattern: /\bskyborne\b/i },
];
const MAX_TERM_HITS = 400;

// Response headers that might describe a quota. Every header name is counted too, so an unexpected one still shows.
const RATE_HEADER = /rate|limit|quota|remaining|retry|reset|throttl|budget/i;
// Character-level fields that might say when the data was last refreshed.
const FRESHNESS_FIELD = /timestamp|last_?log|logout|updated|_at$/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

/** Every `namespace=` value in a body (links carry the versioned static namespace). */
export function namespacesIn(body) {
  const out = new Set();
  for (const m of String(body ?? '').matchAll(/[?&]namespace=([A-Za-z0-9._-]+)/g)) out.add(m[1]);
  return [...out];
}

/** All hrefs in a JSON document, with the key path that led to each. */
export function hrefsIn(json) {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
      if (k === 'href' && typeof x === 'string') out.push({ href: x, path });
      else walk(x, path ? `${path}.${k}` : k);
    }
  };
  walk(json, '');
  return out;
}

/** A path → type skeleton of a document (arrays show their first element), for describing a shape without its data. */
export function skeleton(json, { maxDepth = 7, maxKeys = 400 } = {}) {
  const out = {};
  let n = 0;
  const walk = (v, path, depth) => {
    if (n >= maxKeys) return;
    const type = Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v;
    if (path) {
      out[path] = type;
      n += 1;
    }
    if (depth >= maxDepth) return;
    if (Array.isArray(v)) {
      if (v.length) walk(v[0], `${path}[]`, depth + 1);
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(json, '', 0);
  return out;
}

/**
 * Statistic-like objects in a document: { id: number, name: string } with a numeric `quantity`, or a text
 * `description` instead. Their category path is every ancestor object that also has an id and a name.
 */
export function statisticsIn(json) {
  const out = [];
  const walk = (v, ancestors) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, ancestors);
      return;
    }
    if (!isObj(v)) return;
    const named = Number.isFinite(v.id) && typeof v.name === 'string';
    const quantity = typeof v.quantity === 'number' ? v.quantity : null;
    const text = typeof v.description === 'string' ? v.description : null;
    if (named && (quantity !== null || (text !== null && 'last_updated_timestamp' in v))) {
      out.push({ id: v.id, name: v.name, quantity, text, lastUpdated: Number.isFinite(v.last_updated_timestamp) ? v.last_updated_timestamp : null, categoryPath: ancestors });
      return;
    }
    const next = named ? [...ancestors, { id: v.id, name: v.name }] : ancestors;
    for (const [k, x] of Object.entries(v)) {
      if (k === '_links' || k === 'character') continue; // the owning character is a sibling, not a category
      walk(x, next);
    }
  };
  walk(json, []);
  return out;
}

/** A value type guessed from the name. The basis says it's a guess, and from what. */
export function guessValueType(name, { anyText = false, anyFraction = false } = {}) {
  const rules = [
    ['gold', /\bgold\b|\bcopper\b|\bmoney\b/i],
    ['time', /\btime\b|\bplayed\b|\bduration\b|\bseconds?\b|\bminutes?\b|\bhours?\b|\bdays?\b/i],
    ['distance', /\bdistance\b|\byards?\b|\btravel(?:l)?ed\b|\bmiles?\b|\bfallen\b/i],
    ['highest-ever', /^(?:highest|most|largest|greatest|biggest|longest|fastest|best|max(?:imum)?)\b|\b(?:highest|largest|greatest|biggest)\b/i],
  ];
  for (const [type, re] of rules) {
    const m = re.exec(name);
    if (m) return { type, basis: `guessed from the name ("${m[0]}")` };
  }
  if (anyText) return { type: 'text', basis: 'some samples carry text instead of a number' };
  if (anyFraction) return { type: 'decimal', basis: 'some samples are fractions' };
  return { type: 'count', basis: 'guessed: whole numbers and no unit word in the name' };
}

export function createObserver() {
  const endpoints = new Map(); // id → { requests, statuses, latencies[], bytes, namespaces:Set, auth:Set, sampleSubjects[] }
  const headerNames = new Map(); // name → count
  const rateHeaders = new Map(); // name → { count, first, last, values: Set(≤12), numericMin, numericMax }
  const namespaceLinks = new Map(); // namespace → { count, firstEndpoint }
  const termHits = [];
  const termSeen = new Set();
  const skeletons = new Map(); // endpoint → skeleton of its first 200
  const stats = new Map(); // statistic id → aggregate
  const catalogSamples = new Map(); // endpoint → Set(subject) answered 200
  const freshness = [];
  const latencies = [];
  let requests = 0;
  let retried = 0;
  let throttled = 0;
  let firstAt = null;
  let lastAt = null;

  function scanTerms(json, endpoint, subject) {
    const walk = (v, path, owner) => {
      if (termHits.length >= MAX_TERM_HITS) return;
      if (typeof v === 'string') {
        for (const t of FOREVER_TERMS) {
          if (!t.pattern.test(v)) continue;
          const key = `${t.id}|${endpoint}|${owner?.id ?? ''}|${v.slice(0, 80)}`;
          if (termSeen.has(key)) continue;
          termSeen.add(key);
          termHits.push({ term: t.id, endpoint, subject, path, value: v.slice(0, 160), ownerId: owner?.id ?? null, ownerName: typeof owner?.name === 'string' ? owner.name : null });
        }
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}[${i}]`, owner));
      } else if (isObj(v)) {
        const o = Number.isFinite(v.id) || typeof v.name === 'string' ? v : owner;
        for (const [k, x] of Object.entries(v)) if (k !== '_links' && k !== 'href') walk(x, path ? `${path}.${k}` : k, o);
      }
    };
    walk(json, '', null);
  }

  return {
    /** One response (the source's get() result) for endpoint `endpoint` about `subject`. */
    add(endpoint, subject, r, { catalog = false } = {}) {
      requests += 1;
      if (r.attempts > 1) retried += 1;
      if (r.status === 429) throttled += 1;
      firstAt ??= r.fetchedAt;
      lastAt = r.fetchedAt;
      const e = endpoints.get(endpoint) ?? { requests: 0, statuses: {}, latencies: [], bytes: 0, namespaces: new Set(), auth: new Set(), errors: {} };
      e.requests += 1;
      const key = r.status === null ? 'no answer' : String(r.status);
      e.statuses[key] = (e.statuses[key] ?? 0) + 1;
      if (r.error) e.errors[r.error] = (e.errors[r.error] ?? 0) + 1;
      if (Number.isFinite(r.latencyMs)) {
        e.latencies.push(r.latencyMs);
        latencies.push(r.latencyMs);
      }
      e.bytes += r.bytes ?? 0;
      if (r.namespace) e.namespaces.add(r.namespace);
      e.auth.add(r.auth);
      endpoints.set(endpoint, e);

      for (const [k, v] of Object.entries(r.headers ?? {})) {
        headerNames.set(k, (headerNames.get(k) ?? 0) + 1);
        if (!RATE_HEADER.test(k)) continue;
        const h = rateHeaders.get(k) ?? { count: 0, first: v, last: v, values: new Set(), numericMin: null, numericMax: null };
        h.count += 1;
        h.last = v;
        if (h.values.size < 12) h.values.add(v);
        const n = Number(v);
        if (Number.isFinite(n)) {
          h.numericMin = h.numericMin === null ? n : Math.min(h.numericMin, n);
          h.numericMax = h.numericMax === null ? n : Math.max(h.numericMax, n);
        }
        rateHeaders.set(k, h);
      }

      for (const ns of namespacesIn(r.body)) {
        const n = namespaceLinks.get(ns) ?? { count: 0, firstEndpoint: endpoint };
        n.count += 1;
        namespaceLinks.set(ns, n);
      }

      if (r.status !== 200 || !r.json) return;
      if (!skeletons.has(endpoint)) skeletons.set(endpoint, skeleton(r.json));
      scanTerms(r.json, endpoint, subject);

      if (endpoint === 'character.profile' || endpoint === 'character.status') {
        for (const [k, v] of Object.entries(r.json)) {
          if (!FRESHNESS_FIELD.test(k) || (typeof v !== 'number' && typeof v !== 'string')) continue;
          const ms = typeof v === 'number' && v > 1e11 ? v : typeof v === 'number' && v > 1e9 ? v * 1000 : Date.parse(v);
          freshness.push({ subject, endpoint, field: k, raw: v, iso: Number.isFinite(ms) ? new Date(ms).toISOString() : null, fetchedAt: r.fetchedAt });
        }
      }

      if (!catalog) return;
      const sampled = catalogSamples.get(endpoint) ?? new Set();
      sampled.add(subject);
      catalogSamples.set(endpoint, sampled);
      for (const s of statisticsIn(r.json)) {
        const a = stats.get(s.id) ?? { id: s.id, name: s.name, endpoint, categoryPath: s.categoryPath, subjects: new Set(), values: [], nonzero: 0, anyText: false, anyFraction: false, names: new Set(), lastUpdated: [] };
        if (a.subjects.has(subject)) continue;
        a.subjects.add(subject);
        a.names.add(s.name);
        if (s.quantity !== null) {
          a.values.push(s.quantity);
          if (s.quantity !== 0) a.nonzero += 1;
          if (!Number.isInteger(s.quantity)) a.anyFraction = true;
        } else if (s.text !== null) {
          a.anyText = true;
        }
        if (s.lastUpdated) a.lastUpdated.push({ subject, at: s.lastUpdated });
        stats.set(s.id, a);
      }
    },

    /** The catalog rows (before suggestions). characters_sampled is per the statistic's own endpoint. */
    catalog() {
      return [...stats.values()].map((a) => {
        const sorted = [...a.values].sort((x, y) => x - y);
        const vt = guessValueType(a.name, { anyText: a.anyText, anyFraction: a.anyFraction });
        return {
          statisticId: a.id,
          name: a.name,
          otherNames: [...a.names].filter((n) => n !== a.name),
          endpoint: a.endpoint,
          categoryPath: a.categoryPath,
          valueType: vt.type,
          valueTypeBasis: vt.basis,
          charactersSampled: catalogSamples.get(a.endpoint)?.size ?? 0,
          charactersPresent: a.subjects.size,
          charactersNonzero: a.nonzero,
          numericSamples: sorted.length,
          minValue: sorted[0] ?? null,
          maxValue: sorted.at(-1) ?? null,
          medianValue: percentile(sorted, 0.5),
          hasText: a.anyText,
          lastUpdated: a.lastUpdated,
        };
      }).sort((x, y) => x.statisticId - y.statisticId);
    },

    summary() {
      const sorted = [...latencies].sort((a, b) => a - b);
      const wallMs = firstAt && lastAt ? Date.parse(lastAt) - Date.parse(firstAt) : null;
      return {
        requests,
        retried,
        throttled,
        firstRequestAt: firstAt,
        lastRequestAt: lastAt,
        wallMs,
        latency: {
          meanMs: sorted.length ? Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length) : null,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
          maxMs: sorted.at(-1) ?? null,
        },
        endpoints: [...endpoints].map(([id, e]) => {
          const l = [...e.latencies].sort((a, b) => a - b);
          return {
            id,
            requests: e.requests,
            statuses: e.statuses,
            errors: e.errors,
            p50Ms: percentile(l, 0.5),
            p95Ms: percentile(l, 0.95),
            meanBytes: e.requests ? Math.round(e.bytes / e.requests) : null,
            namespaces: [...e.namespaces],
            auth: [...e.auth],
          };
        }),
        headerNames: Object.fromEntries([...headerNames].sort()),
        rateHeaders: Object.fromEntries([...rateHeaders].map(([k, h]) => [k, { count: h.count, first: h.first, last: h.last, values: [...h.values], numericMin: h.numericMin, numericMax: h.numericMax }])),
        namespaceLinks: Object.fromEntries(namespaceLinks),
        foreverTerms: FOREVER_TERMS.map((t) => ({ id: t.id, label: t.label, hits: termHits.filter((h) => h.term === t.id) })),
        termHitsCapped: termHits.length >= MAX_TERM_HITS,
        freshness,
        skeletons: Object.fromEntries(skeletons),
        catalogSamples: Object.fromEntries([...catalogSamples].map(([k, v]) => [k, v.size])),
      };
    },
  };
}

/** The static namespace to use: the most-linked `static-…` namespace, preferring ones seen in the account profile. */
export function pickStaticNamespace(namespaceLinks, { region }) {
  const candidates = Object.entries(namespaceLinks)
    .filter(([ns]) => ns.startsWith('static-') && ns.endsWith(`-${region}`))
    .sort((a, b) => (b[1].firstEndpoint === 'account.profile') - (a[1].firstEndpoint === 'account.profile') || b[1].count - a[1].count);
  return candidates[0]?.[0] ?? null;
}

/** What the slugs Blizzard itself links to look like: hyphen counts, spaces, apostrophes, case. */
export function slugFindings(characterPaths) {
  const segs = characterPaths.map((p) => decodeURIComponent(p.split('/').filter(Boolean).at(-1) ?? ''));
  return {
    seen: segs.length,
    examples: segs.slice(0, 12),
    withMoreThanOneHyphen: segs.filter((s) => (s.match(/-/g) ?? []).length > 1),
    withNoHyphen: segs.filter((s) => !s.includes('-')),
    withSpace: segs.filter((s) => /\s/.test(s)),
    withApostrophe: segs.filter((s) => /['’]/.test(s)),
    withUppercase: segs.filter((s) => s !== s.toLowerCase()),
    withNonAscii: segs.filter((s) => /[^\x20-\x7e]/.test(s)),
  };
}
