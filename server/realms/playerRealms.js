/**
 * PLAYER REALMS (0.10.1): which realms of a realm version are real player realms, and which of those are locked. The ONE
 * place both rules live; the probe (discovery/probe/realms.js) and the crawler (crawler/fetch.js realmInfo) call it.
 *
 * Rule 1, internal realms: a realm is a player realm only when its connected realm (realm/{slug} → connected_realm.href)
 * is one Blizzard lists in /data/wow/connected-realm/index (search/connected-realm lists the same set). Every other
 * realm is EXCLUDED: on no realm list, no board, never crawled. Evidence (stored responses):
 *   - probe #6 (Classic, US): realm/index lists 50 realms; connected-realm/index lists 23 connected realms. The 22
 *     realms outside them are exactly Blizzard's internal ones (US2 CWOW CSI 80–87 and 180–187, US2 CWOW Account,
 *     US2 CWOW Log, US1/US2 CWOW Web, US1 CWOW GMSS 1–2), each in a connected realm of its own that isn't listed.
 *   - probe #5 (Retail, US): 349 realms, 83 listed connected realms; the 103 outside are all internal-looking
 *     (us1a-account-realm, us1a1inst …, rdb-us "Development", us1-auxiliary-70, us1-100-partner).
 *   Realm `category` can't tell them apart on its own ("United States" is Retail's category for real realms too), and a
 *   name list would miss the next one, so the field above decides. Never a name.
 *
 * Rule 2, locked realms: a realm is LOCKED when its connected realm's population type is LOCKED, or its
 * realm_locked_status says is_locked_for_new_characters. Probe #6: every Classic realm whose category is "Legacy" was
 * population LOCKED (connected-realm/4372 also: is_locked_for_new_characters true); the "Active" ones (Pagle and the
 * realms connected to it) were HIGH. Retail: no realm locked. "Legacy" / "Active" are Blizzard's own words (localised);
 * nothing here reads them.
 */
export const PLAYER_REALM_RULE = 'A realm counts only when its connected realm is one Blizzard lists in connected-realm/index. Internal and test realms sit in connected realms of their own that are never listed, so they are excluded: no realm list, no board, never crawled.';
export const LOCKED_REALM_RULE = 'A realm is locked when its connected realm says population LOCKED, or locked for new characters.';
export const EXCLUDED_REASON = 'internal realm: its connected realm isn’t one connected-realm/index lists';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** "…/connected-realm/4372?namespace=…" → 4372, or null. */
export function connectedRealmIdOf(href) {
  const m = /\/connected-realm\/(\d+)(?:[/?#]|$)/.exec(String(href ?? ''));
  return m ? Number(m[1]) : null;
}

/** A realm/{slug} answer → its connected realm's id, or null when Blizzard named none. */
export const realmConnectedId = (realmJson) => connectedRealmIdOf(realmJson?.connected_realm?.href);

/**
 * The connected realm ids Blizzard lists, from a connected-realm/index answer ({ connected_realms: [{ href }] }) or a
 * search/connected-realm page ({ results: [{ data: { id } }] }). → Set, or null when the answer lists nothing usable.
 */
export function listedConnectedRealms(json) {
  if (Array.isArray(json?.connected_realms)) {
    const ids = json.connected_realms.map((c) => connectedRealmIdOf(c?.href)).filter((x) => x !== null);
    return ids.length ? new Set(ids) : null;
  }
  if (Array.isArray(json?.results)) {
    const ids = json.results.map((r) => (Number.isSafeInteger(r?.data?.id) ? r.data.id : connectedRealmIdOf(r?.key?.href))).filter((x) => x !== null);
    return ids.length ? new Set(ids) : null;
  }
  return null;
}

const typeOf = (v) => (isObj(v) && typeof v.type === 'string' ? v.type : null);
/** A connected realm (its own answer, or one search result's `data`) → true / false, or null when it says nothing. */
export function isLocked(cr) {
  if (!isObj(cr)) return null;
  const forNew = cr.realm_locked_status?.is_locked_for_new_characters;
  const pop = typeOf(cr.population);
  if (forNew === true || pop === 'LOCKED') return true;
  if (forNew === false || pop !== null) return false;
  return null;
}

const localised = (v) => (typeof v === 'string' ? v : isObj(v) ? (typeof v.en_US === 'string' ? v.en_US : Object.values(v).find((x) => typeof x === 'string') ?? null) : null);

/**
 * search/connected-realm pages → every listed connected realm: { id, locked, population, status, realms: [{ id, slug,
 * name, category }] }. Names and categories in search answers are per-locale objects; en_US is read for display.
 */
export function connectedRealmsFromSearch(pages) {
  const out = [];
  for (const page of pages ?? []) {
    for (const r of Array.isArray(page?.results) ? page.results : []) {
      const d = r?.data;
      if (!isObj(d) || !Number.isSafeInteger(d.id)) continue;
      out.push({
        id: d.id,
        locked: isLocked(d),
        population: typeOf(d.population),
        status: typeOf(d.status),
        realms: (Array.isArray(d.realms) ? d.realms : []).filter((x) => typeof x?.slug === 'string').map((x) => ({
          id: Number.isSafeInteger(x.id) ? x.id : null, slug: x.slug.toLowerCase(), name: localised(x.name), category: localised(x.category),
        })),
      });
    }
  }
  return out;
}

/** realm slug → { connectedRealmId, locked } from connectedRealmsFromSearch's list. */
export function realmMapFromSearch(connected) {
  const m = new Map();
  for (const c of connected) for (const r of c.realms) m.set(r.slug, { connectedRealmId: c.id, locked: c.locked, category: r.category });
  return m;
}

/**
 * Rule 1 for one realm. `listed` null (Blizzard listed no connected realms, or wasn't asked) → unknown: not excluded,
 * and the caller says it couldn't tell. → { excluded: reason | null, known: boolean }
 */
export function realmExclusion(connectedRealmId, listed) {
  if (!listed) return { excluded: null, known: false };
  if (connectedRealmId === null || !listed.has(connectedRealmId)) return { excluded: EXCLUDED_REASON, known: true };
  return { excluded: null, known: true };
}
