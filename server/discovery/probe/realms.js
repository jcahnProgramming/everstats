import { GAME_VERSIONS, versionById } from '../../core/gameVersions.js';

/**
 * 0.10.0: the probe's realm step. After realm/index answers, EVERY realm it lists is asked (realm/{slug}, dynamic
 * namespace), stored like every other response (endpoint REALM_SWEEP_ENDPOINT). From those answers:
 *   realmList(details)     each realm as Blizzard describes it: id, slug, name, type, category, timezone, locale,
 *                          is_tournament and any other plain field, plus a count per type
 *   realmAnswers(…)        how realms map to Everstats' realm categories (tiers and boards are graded within one), and,
 *                          for the Classic Era family, how its kinds of server are told apart. 'unknown' when the
 *                          answers can't settle it, never a guess.
 */
export const REALM_SWEEP_ENDPOINT = 'ep.realm-sweep';
export const MAX_REALMS = 600;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
const typeOf = (v) => (isObj(v) ? { type: typeof v.type === 'string' ? v.type : null, name: nameOf(v) } : null);

/** The realm slugs realm/index lists, in its order. */
export function realmSlugsIn(index) {
  const list = Array.isArray(index?.realms) ? index.realms : [];
  return [...new Set(list.map((r) => (isObj(r) && typeof r.slug === 'string' ? r.slug.toLowerCase() : null)).filter(Boolean))].slice(0, MAX_REALMS);
}

/** One realm answer → what the summary keeps (Blizzard's fields as sent; links dropped). */
export function realmOf(json, slug) {
  if (!isObj(json)) return { slug, answered: false };
  const extra = {};
  for (const [k, v] of Object.entries(json)) {
    if (['_links', 'id', 'slug', 'name', 'type', 'category', 'timezone', 'locale', 'is_tournament', 'region', 'connected_realm'].includes(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') extra[k] = v;
  }
  return {
    slug: typeof json.slug === 'string' ? json.slug : slug,
    answered: true,
    id: Number.isSafeInteger(json.id) ? json.id : null,
    name: nameOf(json),
    type: typeOf(json.type),
    category: typeof json.category === 'string' ? json.category : nameOf(json.category),
    timezone: typeof json.timezone === 'string' ? json.timezone : null,
    locale: typeof json.locale === 'string' ? json.locale : null,
    isTournament: typeof json.is_tournament === 'boolean' ? json.is_tournament : null,
    region: nameOf(json.region),
    connectedRealm: typeof json.connected_realm?.href === 'string',
    extra,
  };
}

export function realmList(details) {
  const realms = details.map(({ slug, json, status }) => (status === 200 ? realmOf(json, slug) : { slug, answered: false, status }));
  const count = (key) => {
    const m = new Map();
    for (const r of realms.filter((x) => x.answered)) {
      const k = key(r) ?? '(none)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([value, realmsN]) => ({ value, realms: realmsN })).sort((a, b) => b.realms - a.realms);
  };
  return {
    asked: details.length,
    answered: realms.filter((r) => r.answered).length,
    realms,
    byType: count((r) => (r.type ? `${r.type.type ?? '?'} (${r.type.name ?? '?'})` : null)),
    byCategory: count((r) => r.category),
    byTimezone: count((r) => r.timezone),
    tournament: realms.filter((r) => r.isTournament === true).length,
  };
}

// The Classic Era family is the registry's to say (gameVersions.js eraFamily), never a list here.
const ERA_FAMILY = new Set(GAME_VERSIONS.filter((v) => v.eraFamily).map((v) => v.id));
const NAME_PATTERNS = [
  { id: 'hardcore', label: 'Hardcore', re: /hardcore/i },
  { id: 'sod', label: 'Season of Discovery', re: /season of discovery|\bsod\b|discovery/i },
  { id: 'anniversary', label: 'Anniversary', re: /anniversary|fresh/i },
  { id: 'seasonal', label: 'Season (any)', re: /season/i },
];

/**
 * → [{ id, module, question, verdict, text, evidence }]. `version` is the probed version's id; `rulesets` the ruleset
 * index's answer (Forever's categories), when it answered.
 */
export function realmAnswers({ version, realms, rulesetsListed = null, indexStatus = null }) {
  const v = versionById(version);
  const out = [];
  const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
  const label = v?.realmCategory.label ?? 'realm category';

  // How realms map to Everstats' realm categories (what tiers and boards are graded within).
  {
    let verdict = 'unknown';
    let text;
    if (v?.realmCategory.source === 'ruleset') {
      text = rulesetsListed
        ? `${v.name} grades within its ${v.realmCategory.plural}: ruleset/index lists ${fmt(rulesetsListed.length)} (${rulesetsListed.join(', ') || 'none named'}). Realms: realm/index ${indexStatus ?? 'not asked'}${realms ? `, ${fmt(realms.answered)} realm details answered` : ''}.`
        : `${v.name} grades within its ${v.realmCategory.plural}, but ruleset/index gave no list here, so the probe can't say which.`;
      verdict = rulesetsListed?.length ? 'yes' : 'unknown';
    } else if (!realms || realms.answered === 0) {
      text = `${v?.name ?? version} grades within each realm's TYPE, but no realm detail answered (realm/index ${indexStatus ?? 'not asked'}), so the types are unknown.`;
    } else {
      const types = realms.byType.filter((t) => t.value !== '(none)');
      verdict = types.length ? 'yes' : 'unknown';
      text = types.length
        ? `${fmt(realms.answered)} realms answered. Each becomes the ${label} its realm type names: ${types.map((t) => `${t.value}: ${fmt(t.realms)} realm${t.realms === 1 ? '' : 's'}`).join('; ')}. One set of boards and tiers per ${label}.${realms.byType.some((t) => t.value === '(none)') ? ` ${fmt(realms.byType.find((t) => t.value === '(none)').realms)} realm(s) named no type: their characters would be on no board until Blizzard says.` : ''}`
        : `${fmt(realms.answered)} realms answered, but none named a type: the ${label} is unknown.`;
    }
    out.push({ id: 'realm-categories', module: 'Realms', question: `How do realms map to Everstats' ${v?.realmCategory.plural ?? 'realm categories'} (tiers and boards)?`, verdict, text, evidence: ['data.realm-index', REALM_SWEEP_ENDPOINT, 'data.ruleset-index'] });
  }

  // The Classic Era family: how Era, Hardcore, Anniversary and Season of Discovery servers are told apart.
  if (ERA_FAMILY.has(version)) {
    const answered = realms?.realms.filter((r) => r.answered) ?? [];
    const hits = NAME_PATTERNS.map((p) => ({ ...p, realms: answered.filter((r) => p.re.test(r.name ?? '') || p.re.test(r.slug ?? '')) })).filter((p) => p.realms.length);
    const types = realms?.byType ?? [];
    const cats = realms?.byCategory ?? [];
    const sibling = GAME_VERSIONS.filter((x) => ERA_FAMILY.has(x.id) && x.id !== version).map((x) => `${x.name} (${x.namespaces.profile.replace('{region}', '…')})`);
    let verdict = 'unknown';
    const parts = [];
    parts.push(`Namespace: Blizzard's Classic namespaces guide gives Anniversary its OWN namespace (classicann); this probe ran ${v?.name} in ${v?.namespaces.profile.replace('{region}', '…')}. ${sibling.length ? `The other: ${sibling.join(', ')}.` : ''}`);
    if (!answered.length) {
      parts.push('No realm detail answered, so whether Hardcore or Season of Discovery servers differ by realm type, category or name is unknown.');
    } else {
      parts.push(`Realm types seen: ${types.map((t) => `${t.value} ×${t.realms}`).join(', ') || 'none'}. Categories seen: ${cats.map((c) => `${c.value} ×${c.realms}`).join(', ') || 'none'}.`);
      parts.push(hits.length ? `Names that say what they are: ${hits.map((h) => `${h.label}: ${h.realms.slice(0, 6).map((r) => r.name ?? r.slug).join(', ')}${h.realms.length > 6 ? ` +${h.realms.length - 6}` : ''}`).join('; ')}.` : 'No realm name mentions Hardcore, Season of Discovery or Anniversary.');
      // Settled only when a field (type or category) separates the realms the names single out.
      const fieldSplits = hits.filter((h) => {
        const hType = new Set(h.realms.map((r) => r.type?.type));
        const rest = answered.filter((r) => !h.realms.includes(r));
        return hType.size === 1 && rest.length && !rest.some((r) => hType.has(r.type?.type));
      });
      if (fieldSplits.length) {
        verdict = 'yes';
        parts.push(`Told apart by realm TYPE: ${fieldSplits.map((h) => `${h.label} realms all have type ${h.realms[0].type?.type}`).join('; ')}.`);
      } else if (hits.length) {
        parts.push('Only by name: no realm type or category separates them, so a board per kind of server would have to read names (not built; the owner decides).');
      }
    }
    out.push({ id: 'era-family', module: 'Realms', question: 'Classic Era family: how are Era, Hardcore, Anniversary and Season of Discovery servers told apart?', verdict, text: parts.join(' '), evidence: ['data.realm-index', REALM_SWEEP_ENDPOINT] });
  }
  return out;
}
