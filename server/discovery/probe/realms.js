import { GAME_VERSIONS, versionById } from '../../core/gameVersions.js';
import { LOCKED_REALM_RULE, PLAYER_REALM_RULE, realmConnectedId, realmExclusion, realmMapFromSearch } from '../../realms/playerRealms.js';

/**
 * 0.10.0: the probe's realm step. After realm/index answers, EVERY realm it lists is asked (realm/{slug}, dynamic
 * namespace), stored like every other response (endpoint REALM_SWEEP_ENDPOINT). From those answers:
 *   realmList(details, …)  each realm as Blizzard describes it: id, slug, name, type, category, timezone, locale,
 *                          is_tournament and any other plain field, plus a count per type. 0.10.1: each realm is a
 *                          player realm or EXCLUDED (realms/playerRealms.js rule 1: internal realms), and locked or not
 *                          (rule 2); every count is over player realms only, the excluded ones are listed apart.
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
    connectedRealmId: realmConnectedId(json),
    extra,
  };
}

/**
 * `listed`: the connected realm ids connected-realm/index lists (playerRealms.listedConnectedRealms), or null when it
 * didn't answer (then nothing is excluded and the list says it couldn't tell). `connected`: search/connected-realm's
 * realms (playerRealms.connectedRealmsFromSearch), for the lock state; [] when it didn't answer.
 */
export function realmList(details, { listed = null, connected = [] } = {}) {
  const locks = realmMapFromSearch(connected);
  const realms = details.map(({ slug, json, status }) => {
    if (status !== 200) return { slug, answered: false, status };
    const r = realmOf(json, slug);
    if (!r.answered) return r;
    const ex = realmExclusion(r.connectedRealmId, listed);
    const lock = locks.get(r.slug) ?? null;
    return { ...r, excluded: ex.excluded, locked: ex.excluded ? null : (lock?.locked ?? null) };
  });
  const players = realms.filter((x) => x.answered && !x.excluded);
  const count = (key) => {
    const m = new Map();
    for (const r of players) {
      const k = key(r) ?? '(none)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([value, realmsN]) => ({ value, realms: realmsN })).sort((a, b) => b.realms - a.realms);
  };
  const lockedBy = new Map();
  for (const r of players.filter((x) => x.locked !== null)) {
    const k = r.category ?? '(none)';
    const e = lockedBy.get(k) ?? { category: k, locked: 0, open: 0 };
    e[r.locked ? 'locked' : 'open'] += 1;
    lockedBy.set(k, e);
  }
  return {
    asked: details.length,
    answered: realms.filter((r) => r.answered).length,
    players: players.length,
    exclusionKnown: listed !== null,
    excluded: realms.filter((r) => r.excluded).map((r) => ({ slug: r.slug, name: r.name, category: r.category, connectedRealmId: r.connectedRealmId, reason: r.excluded })),
    locked: players.filter((r) => r.locked === true).length,
    lockKnown: players.filter((r) => r.locked !== null).length,
    lockByCategory: [...lockedBy.values()].sort((a, b) => (b.locked + b.open) - (a.locked + a.open)),
    rules: { players: PLAYER_REALM_RULE, locked: LOCKED_REALM_RULE },
    realms,
    byType: count((r) => (r.type ? `${r.type.type ?? '?'} (${r.type.name ?? '?'})` : null)),
    byCategory: count((r) => r.category),
    byTimezone: count((r) => r.timezone),
    tournament: players.filter((r) => r.isTournament === true).length,
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
    } else if (!realms || (realms.players ?? realms.answered) === 0) {
      text = `${v?.name ?? version} grades within each realm's TYPE, but no realm detail answered (realm/index ${indexStatus ?? 'not asked'}), so the types are unknown.`;
    } else {
      const types = realms.byType.filter((t) => t.value !== '(none)');
      verdict = types.length ? 'yes' : 'unknown';
      text = types.length
        ? `${fmt(realms.players ?? realms.answered)} player realms${realms.excluded?.length ? ` (${fmt(realms.excluded.length)} internal realms excluded)` : ''}. Each becomes the ${label} its realm type names: ${types.map((t) => `${t.value}: ${fmt(t.realms)} realm${t.realms === 1 ? '' : 's'}`).join('; ')}. One set of boards and tiers per ${label}.${realms.byType.some((t) => t.value === '(none)') ? ` ${fmt(realms.byType.find((t) => t.value === '(none)').realms)} realm(s) named no type: their characters would be on no board until Blizzard says.` : ''}`
        : `${fmt(realms.players ?? realms.answered)} player realms answered, but none named a type: the ${label} is unknown.`;
    }
    out.push({ id: 'realm-categories', module: 'Realms', question: `How do realms map to Everstats' ${v?.realmCategory.plural ?? 'realm categories'} (tiers and boards)?`, verdict, text, evidence: ['data.realm-index', REALM_SWEEP_ENDPOINT, 'data.ruleset-index'] });
  }

  // The Classic Era family: how Era, Hardcore, Anniversary and Season of Discovery servers are told apart.
  if (ERA_FAMILY.has(version)) {
    const answered = realms?.realms.filter((r) => r.answered && !r.excluded) ?? [];
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
  if (realms && v?.realms) out.push(...realmRuleAnswers(realms));
  return out;
}

/** 0.10.1: the internal realms excluded (rule 1) and what the locked realms are (rule 2), from the realm answers. */
export function realmRuleAnswers(realms) {
  const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
  const out = [];
  {
    let verdict = 'unknown';
    let text;
    if (!realms.exclusionKnown) {
      text = 'connected-realm/index didn’t answer here, so internal realms can’t be told apart: none were excluded.';
    } else {
      verdict = 'yes';
      const ex = realms.excluded ?? [];
      const cats = [...new Set(ex.map((r) => r.category ?? '(none)'))];
      text = ex.length
        ? `${fmt(ex.length)} of ${fmt(realms.answered)} realms are internal and EXCLUDED (no realm list, no board, never crawled): ${ex.slice(0, 24).map((r) => r.name ?? r.slug).join(', ')}${ex.length > 24 ? ` and ${fmt(ex.length - 24)} more` : ''}. Their Blizzard categories: ${cats.join(', ')}. Rule: ${PLAYER_REALM_RULE}`
        : `Every answered realm sits in a connected realm connected-realm/index lists: none excluded. Rule: ${PLAYER_REALM_RULE}`;
    }
    out.push({ id: 'internal-realms', module: 'Realms', question: 'Which realms are Blizzard’s internal or test realms (excluded everywhere)?', verdict, text, evidence: ['data.connected-realm-index', REALM_SWEEP_ENDPOINT] });
  }
  {
    let verdict = 'unknown';
    let text;
    if (!realms.lockKnown) {
      text = 'search/connected-realm gave no population for these realms, so which are locked is unknown.';
    } else {
      verdict = 'yes';
      const by = realms.lockByCategory ?? [];
      text = `${fmt(realms.locked)} of ${fmt(realms.lockKnown)} player realms are locked (${LOCKED_REALM_RULE}) By Blizzard's realm category: ${by.map((c) => `${c.category}: ${fmt(c.locked)} locked, ${fmt(c.open)} open`).join('; ')}.`;
      const allLocked = by.filter((c) => c.locked > 0 && c.open === 0);
      const allOpen = by.filter((c) => c.open > 0 && c.locked === 0);
      if (allLocked.length && allOpen.length) {
        text += ` In Blizzard's data here, every ${allLocked.map((c) => `"${c.category}"`).join(' / ')} realm is locked and every ${allOpen.map((c) => `"${c.category}"`).join(' / ')} realm is open.`;
      }
    }
    out.push({ id: 'locked-realms', module: 'Realms', question: 'Which player realms are locked, and what does Blizzard’s realm category say about it?', verdict, text, evidence: ['search.connected-realm', REALM_SWEEP_ENDPOINT] });
  }
  return out;
}
