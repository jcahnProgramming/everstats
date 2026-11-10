import { parseAccountCharacters } from '../../crawler/parse.js';

/**
 * 0.10.1: can characters on each kind of realm be fetched at all? Probe #6's character (Pathsrogue, Windseeker, a
 * "Legacy" realm) answered 404 for its profile and every character endpoint though the account list includes it. One
 * character can't say whether that is the realm or the character, so on a realm version the probe asks the PROFILE
 * (one request each) of a few more of the admin's own characters, grouped by the realm's Blizzard category and lock
 * state (realms/playerRealms.js): up to PER_GROUP per group, MAX_CHECKS in all, level MIN_LEVEL+ (below that Blizzard
 * serves no profile anywhere), never on an excluded realm. Each answer is stored like every probe response
 * (endpoint CHARACTER_CHECK_ENDPOINT). Nothing else is asked about them.
 */
export const CHARACTER_CHECK_ENDPOINT = 'ep.realm-character-check';
export const PER_GROUP = 2;
export const MAX_CHECKS = 8;
export const MIN_LEVEL = 10;

const groupOf = (realm) => {
  const cat = realm?.category ?? 'no category';
  return realm?.locked === true ? `${cat} · locked` : realm?.locked === false ? `${cat} · open` : cat;
};

/** `account`: the /profile/user/wow answer; `realms`: realmList's result; `primary`: the probe's character option. */
export function characterCheckPlan({ account, realms, primary }) {
  const bySlug = new Map((realms?.realms ?? []).filter((r) => r.answered).map((r) => [r.slug, r]));
  const list = parseAccountCharacters(account, { realms: true });
  const isPrimary = (c) => c.slug === String(primary?.slug ?? '').toLowerCase() && c.realmSlug === String(primary?.realmSlug ?? '').toLowerCase();
  const groups = new Map();
  for (const c of list) {
    const realm = bySlug.get(c.realmSlug);
    if (!realm || realm.excluded || isPrimary(c) || (c.level ?? 0) < MIN_LEVEL) continue;
    const g = groupOf(realm);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ name: c.name, slug: c.slug, realmSlug: c.realmSlug, level: c.level, group: g });
  }
  const plan = [];
  for (const list2 of groups.values()) plan.push(...list2.sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, PER_GROUP));
  return plan.slice(0, MAX_CHECKS);
}

/** The primary character's realm group, for the answer (null on a realmless version or an unknown realm). */
export function primaryGroup({ realms, primary }) {
  const r = (realms?.realms ?? []).find((x) => x.answered && x.slug === String(primary?.realmSlug ?? '').toLowerCase());
  return r ? { group: groupOf(r), realm: r } : null;
}

/**
 * The answers: did the probe's own character answer, and which kinds of realm serve character profiles.
 * `primaryStatus`: character.profile's statuses ('200', '404' …), `checks`: live.characterChecks with statuses.
 */
export function characterAnswers({ primary, primaryStatuses, primaryEndpoints, realms, checks, versionName }) {
  const out = [];
  const who = [primary?.name, primary?.surname].filter(Boolean).join(' ') || 'the probe’s character';
  const where = primary?.realmSlug ? ` (${primary.realmSlug})` : '';
  const st = primaryStatuses ?? [];
  const answered = st.includes(200);
  const pg = primaryGroup({ realms, primary });
  if (!answered) {
    const notFound = primaryEndpoints.filter((e) => e.statuses.length && e.statuses.every((x) => x === 404)).length;
    out.push({
      id: 'primary-character', module: 'Profile', question: 'Did the probe’s own character answer?', verdict: 'no',
      text: st.length
        ? `No. ${who}${where} answered ${st.map((x) => x ?? 'no answer').join('/')} for its profile, and ${notFound} of ${primaryEndpoints.length} character endpoints answered 404. Blizzard serves no profile for it on ${versionName}, so this probe has NO statistics, boards or groups from a character: those are not measured, not zero.${pg ? ` Its realm's category is "${pg.realm.category ?? 'none'}"${pg.realm.locked === true ? ', locked' : pg.realm.locked === false ? ', open' : ''}.` : ''} Pick a character on an open realm and run the probe again.`
        : `${who}${where}'s profile wasn't asked (the probe stopped first).`,
      evidence: ['character.profile'],
    });
  }
  if (!checks?.length && !pg) return out;
  const groups = new Map();
  const add = (g, name, status) => {
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ name, status });
  };
  if (pg && st.length) add(pg.group, `${primary?.name ?? '?'} (the probe’s character)`, answered ? 200 : st.at(-1));
  for (const c of checks ?? []) add(c.group, `${c.name} L${c.level ?? '?'} (${c.realmSlug})`, c.status);
  const lines = [...groups.entries()].map(([g, list]) => {
    const ok = list.filter((x) => x.status === 200).length;
    return `${g}: ${ok} of ${list.length} answered (${list.map((x) => `${x.name} ${x.status ?? 'no answer'}`).join(', ')})`;
  });
  const clear = [...groups.values()].every((list) => list.every((x) => x.status === 200) || list.every((x) => x.status === 404));
  out.push({
    id: 'realm-characters', module: 'Realms', question: 'Can characters on each kind of realm be fetched?',
    verdict: groups.size && clear && [...groups.values()].every((l) => l.length >= 2) ? 'yes' : 'unknown',
    text: `${lines.join('. ')}.${clear ? '' : ' Mixed answers within a group: the realm alone doesn’t decide it.'} ${[...groups.values()].some((l) => l.length < 2) ? 'A group with one character can’t settle it.' : ''} Profiles only (one request each, your own characters from your Battle.net list, level ${MIN_LEVEL}+).`.trim(),
    evidence: ['character.profile', CHARACTER_CHECK_ENDPOINT],
  });
  return out;
}
