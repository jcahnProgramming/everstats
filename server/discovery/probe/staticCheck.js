/**
 * 0.10.1: the static namespace check, for versions whose registry entry names a PLAIN static namespace
 * (gameVersions.js staticPlain: every version but Forever). Probes #5 (Retail) and #6 (Classic) used the versioned
 * namespace the links named (static-12.0.1_65617-us, static-5.5.0_61496-classic-us): every static index answered 404
 * and every search 200 with nothing in it. So before the first static entry, the probe asks the same static indexes in
 * each candidate:
 *   - the versioned namespace the links named (pickStatic: what 0.10.0 used),
 *   - the newest build any link named, when it differs (probe #5's links named three builds; the self links of
 *     answered static documents named 12.1.5_70077 while the detected one was 12.0.1_65617),
 *   - the plain one from the registry.
 * "Real data" = 200 with a non-empty item list. The candidate with the most items wins; a tie goes to the plain one
 * (the one Blizzard's namespace guides document). None with real data → the detected one, as before, and the summary
 * says so. Forever never gets here (staticPlain null): its probe works exactly as in 0.10.0.
 */
export const STATIC_CHECK_ENDPOINT = 'ep.static-check';
export const STATIC_CHECK_ENTRIES = Object.freeze(['data.playable-class-index', 'data.playable-race-index']);

/** "static-12.1.5_70077-us" → [12, 1, 5, 70077]; no build → null. */
export function buildOf(ns) {
  const m = /^static-(\d[A-Za-z0-9._]*?)-/.exec(String(ns ?? ''));
  if (!m) return null;
  return m[1].split(/[._]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
}
const newer = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** The namespaces to try, in order: [{ ns, why }]. `detected` is pickStatic's answer (may be null). */
export function staticCandidates({ namespaceLinks, ctx, detected }) {
  const out = [];
  const add = (ns, why) => {
    if (ns && ctx.isStatic(ns) && !out.some((c) => c.ns === ns)) out.push({ ns, why });
  };
  add(detected, 'the versioned namespace Blizzard’s links named most (what 0.10.0 used)');
  const builds = Object.keys(namespaceLinks).filter((n) => ctx.isStatic(n) && buildOf(n)).sort((a, b) => newer(buildOf(b), buildOf(a)));
  add(builds[0], 'the newest build any link named');
  add(ctx.plainStatic, 'the plain namespace from Blizzard’s namespace guide');
  return out;
}

const itemsIn = (json) => {
  if (!json || typeof json !== 'object') return 0;
  let best = 0;
  for (const [k, v] of Object.entries(json)) if (k !== '_links' && Array.isArray(v)) best = Math.max(best, v.length);
  return best;
};

/**
 * `tries`: [{ ns, why, entry, status, json }]. → { chosen, basis, candidates: [{ ns, why, results: [{ entry, status,
 * items }], items, real }] }
 */
export function chooseStatic(tries, { detected, plain }) {
  const by = new Map();
  for (const t of tries) {
    const c = by.get(t.ns) ?? { ns: t.ns, why: t.why, results: [], items: 0, real: false };
    const items = t.status === 200 ? itemsIn(t.json) : 0;
    c.results.push({ entry: t.entry, status: t.status, items });
    c.items += items;
    c.real ||= items > 0;
    by.set(t.ns, c);
  }
  const candidates = [...by.values()];
  const real = candidates.filter((c) => c.real).sort((a, b) => b.items - a.items || (b.ns === plain) - (a.ns === plain));
  if (real.length) return { chosen: real[0].ns, basis: `answered with real data (${real[0].items.toLocaleString('en-US')} items across ${real[0].results.length} static indexes)`, candidates };
  return { chosen: detected ?? null, basis: detected ? 'no candidate answered with real data: kept the detected one' : 'no candidate answered and none was detected', candidates };
}

/** The plain-English answer from `live.staticCheck` (null on Forever, and on probes before 0.10.1). */
export function staticAnswer({ check, detected, versionName, entries }) {
  const fmtR = (c) => `${c.ns}: ${c.results.map((r) => `${r.entry.replace(/^data\./, '')} ${r.status ?? 'no answer'}${r.items ? ` (${r.items} items)` : ''}`).join(', ')}`;
  if (!check) {
    const st = entries.filter((e) => e.nsKind === 'static' && e.attempts.length);
    const ok = st.filter((e) => e.outcome === 'answered').length;
    return {
      id: 'static-namespace', module: 'Namespaces', question: `Which static namespace serves ${versionName}'s game data?`, verdict: 'unknown',
      text: `Not checked in this run (it predates 0.10.1, which asks the plain namespace too). Only ${detected ?? 'no static namespace'} was asked: ${ok} of ${st.length} static endpoints answered 200. Run the probe again to compare.`,
      evidence: [STATIC_CHECK_ENDPOINT],
    };
  }
  const chosen = check.candidates.find((c) => c.ns === check.chosen);
  return {
    id: 'static-namespace', module: 'Namespaces', question: `Which static namespace serves ${versionName}'s game data?`,
    verdict: chosen?.real ? 'yes' : 'no',
    text: `${chosen?.real ? `${check.chosen}, ${check.basis}.` : `None: ${check.basis}.`} Tried: ${check.candidates.map(fmtR).join('; ')}. Every static endpoint after this used ${check.chosen ?? 'nothing (skipped)'}.`,
    evidence: [STATIC_CHECK_ENDPOINT],
  };
}
