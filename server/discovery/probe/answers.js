/**
 * The endpoint probe's plain-English answers (0.8.3): what the 0.9.0 Collections design needs to know, read from the
 * probe's results only. Each answer is { id, module, question, verdict: 'yes' | 'no' | 'unknown', text, evidence }.
 * 'unknown' whenever the results can't settle it (skipped, stopped first, an answer with an empty list, a zero that
 * one character can't prove): never a guess.
 * 0.10.0: for any game version (`version`); the Legacy answer only where its guesses ran.
 */
import { PRIMARY_VERSION, versionById } from '../../core/gameVersions.js';

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : String(n));
// 0.9.2: "character" and "guild", as the endpoint tables say them (was a bare "C" and "G": "C/collections/mounts").
const short = (t) => String(t).replace('{C}', 'character').replace('{G}', 'guild').replace('/data/wow/', '');
const statuses = (e) => e.attempts.map((a) => (a.status === null ? 'no answer' : a.status)).join(' then ');

export function probeAnswers(entries, { foreverTerms = [], primary = null, version = PRIMARY_VERSION.id } = {}) {
  const versionName = versionById(version)?.name ?? version;
  const by = new Map(entries.map((e) => [e.id, e]));
  const best = (id) => {
    const e = by.get(id);
    return e?.attempts.find((a) => a.status === 200) ?? null;
  };
  /** Why an entry has no 200, in words. */
  const why = (id) => {
    const e = by.get(id);
    if (!e) return 'not in the probe';
    if (e.skipped) return `skipped (${e.skipped})`;
    if (e.attempts.length === 0) return 'not asked (the probe was stopped first)';
    return `answered ${statuses(e)}`;
  };
  const allNotFound = (ids) => ids.every((id) => {
    const e = by.get(id);
    return e && e.attempts.length > 0 && e.attempts.every((a) => a.status === 404);
  });
  const who = primary ? [primary.name, primary.surname].filter(Boolean).join(' ') : 'the character';
  const answers = [];
  const add = (a) => answers.push(a);

  // ---- missing catalogs: a full list per type, beside the character's own
  const catalog = (id, label, indexId, charId, noun) => {
    const b = best(indexId);
    const mine = charId ? best(charId) : null;
    const mineText = charId ? (mine ? ` ${who}'s own list has ${fmt(mine.count ?? 0)}${mine.listKey ? ` (${mine.listKey})` : ''}.` : ` ${who}'s own list: ${why(charId)}.`) : '';
    const path = short(by.get(indexId)?.template ?? indexId);
    let verdict;
    let text;
    if (b && (b.count ?? 0) > 0) {
      verdict = 'yes';
      text = `${path} answered with ${fmt(b.count)} ${noun}.${mineText}`;
    } else if (b) {
      verdict = 'unknown';
      text = `${path} answered 200, but its list was empty.${mineText}`;
    } else if (allNotFound([indexId])) {
      verdict = 'no';
      text = `${path} ${why(indexId)}.${mineText}`;
    } else {
      verdict = 'unknown';
      text = `${path} ${why(indexId)}.${mineText}`;
    }
    add({ id, module: 'Missing catalogs', question: `${label}: is there a full list to compare against?`, verdict, text, evidence: [indexId, ...(charId ? [charId] : [])] });
  };
  catalog('catalog-mounts', 'Mounts', 'data.mount-index', 'character.collections-mounts', 'mounts');
  catalog('catalog-pets', 'Pets', 'data.pet-index', 'character.collections-pets', 'pets');
  catalog('catalog-toys', 'Toys', 'data.toy-index', 'character.collections-toys', 'toys');
  catalog('catalog-heirlooms', 'Heirlooms', 'data.heirloom-index', 'character.collections-heirlooms', 'heirlooms');
  catalog('catalog-titles', 'Titles', 'data.title-index', 'character.titles', 'titles');
  catalog('catalog-achievements', 'Achievements', 'data.achievement-index', 'character.achievements', 'achievements');
  catalog('catalog-appearance-sets', 'Appearance sets', 'data.item-appearance-set-index', 'character.collections-transmogs', 'appearance sets');
  {
    const slot = best('data.item-appearance-slot');
    const idx = best('data.item-appearance-slot-index');
    let verdict = 'unknown';
    let text;
    if (slot && (slot.count ?? 0) > 0) {
      verdict = 'yes';
      text = `item-appearance/slot/${slot.values?.slotType ?? '…'} answered with ${fmt(slot.count)} appearances (${slot.listKey}); ${idx ? `the slot index lists ${fmt(idx.count ?? 0)} slots` : `the slot index ${why('data.item-appearance-slot-index')}`}.`;
    } else if (slot) {
      text = 'An appearance slot answered 200, but listed no appearances.';
    } else {
      if (allNotFound(['data.item-appearance-slot-index'])) verdict = 'no';
      text = `item-appearance/slot/index ${why('data.item-appearance-slot-index')}; a slot ${why('data.item-appearance-slot')}.`;
    }
    add({ id: 'catalog-appearances', module: 'Missing catalogs', question: 'Appearances: is there a full list, slot by slot?', verdict, text, evidence: ['data.item-appearance-slot-index', 'data.item-appearance-slot'] });
  }

  // ---- drop sources: the Adventure Journal's encounter loot
  {
    const enc = best('data.journal-encounter');
    const inst = best('data.journal-instance-index');
    const items = enc?.lists?.items;
    let verdict = 'unknown';
    let text;
    if (enc && items > 0) {
      verdict = 'yes';
      text = `journal-encounter/${enc.values?.journalEncounterId ?? '…'} lists ${fmt(items)} items it drops.`;
    } else if (enc) {
      text = `journal-encounter/${enc.values?.journalEncounterId ?? '…'} answered, but with no items list${items === 0 ? ' (empty)' : ''}: one encounter can't settle it.`;
    } else {
      if (allNotFound(['data.journal-encounter-index', 'data.journal-instance-index'])) verdict = 'no';
      text = `journal-encounter/index ${why('data.journal-encounter-index')}; an encounter ${why('data.journal-encounter')}.`;
    }
    text += ` journal-instance/index: ${inst ? `${fmt(inst.count ?? 0)} instances` : why('data.journal-instance-index')}.`;
    add({ id: 'sources', module: 'Sources', question: 'Drop sources: does the journal list what each encounter drops?', verdict, text, evidence: ['data.journal-encounter-index', 'data.journal-encounter', 'data.journal-instance-index'] });
  }

  // ---- housing
  {
    const ids = entries.filter((e) => e.area === 'housing' || ['search.decor', 'search.fixture', 'search.fixture-hook', 'data.guess-housing-index', 'character.guess-housing'].includes(e.id)).map((e) => e.id);
    const answered = ids.filter((id) => best(id));
    const withData = answered.filter((id) => (best(id).count ?? 1) > 0);
    let verdict = 'unknown';
    let text;
    if (withData.length) {
      verdict = 'yes';
      text = `Answered with data: ${withData.map((id) => `${short(by.get(id).template)}${best(id).count !== null ? ` (${fmt(best(id).count)})` : ''}`).join(', ')}.`;
    } else if (answered.length) {
      text = `Answered 200 but empty: ${answered.map((id) => short(by.get(id).template)).join(', ')}.`;
    } else if (allNotFound(ids.filter((id) => by.get(id).attempts.length))) {
      verdict = ids.some((id) => by.get(id).attempts.length) ? 'no' : 'unknown';
      text = `None of the ${ids.length} housing paths answered (${ids.filter((id) => by.get(id).attempts.length).length} asked, all 404; the rest skipped for want of an id).`;
    } else {
      text = ids.map((id) => `${short(by.get(id).template)} ${why(id)}`).join('; ');
    }
    add({ id: 'housing', module: 'Housing', question: 'Housing: does any housing endpoint answer?', verdict, text, evidence: ids });
  }

  // ---- Legacy (a Forever-only system: only the guesses and the words in answers can say). 0.10.0: asked only where
  // the guesses ran (the version they are about).
  if (by.has('character.guess-legacy')) {
    const ids = ['character.guess-legacy', 'character.guess-legacies', 'character.guess-heritage', 'data.guess-legacy-index', 'data.guess-legacies-index', 'data.guess-heritage-index'];
    const answered = ids.filter((id) => best(id));
    const hits = foreverTerms.find((t) => t.id === 'legacy')?.hits ?? [];
    let verdict;
    let text;
    if (answered.length) {
      verdict = 'yes';
      text = `Answered: ${answered.map((id) => best(id).path).join(', ')}.`;
    } else if (hits.length) {
      verdict = 'unknown';
      text = `No guessed path answered, but the word “Legacy” appears in ${fmt(hits.length)} place${hits.length === 1 ? '' : 's'} in the answers (e.g. ${hits.slice(0, 3).map((h) => `“${h.value.slice(0, 60)}” in ${h.endpoint.replace(/^ep\./, '')}`).join('; ')}).`;
    } else {
      verdict = allNotFound(ids) ? 'no' : 'unknown';
      text = `None of the guessed paths answered (${ids.map((id) => `${short(by.get(id)?.template ?? id)} ${why(id)}`).join('; ')}), and the word “Legacy” appears in no answer. It may still exist under a name nobody has guessed.`;
    }
    add({ id: 'legacy', module: 'Legacy', question: 'Legacy: is there a Forever “Legacy” endpoint or field?', verdict, text, evidence: ids });
  }

  // ---- achievement points
  {
    const prof = best('character.profile');
    const ach = best('character.achievements');
    const gld = best('guild.profile');
    const vals = [
      ['profile achievement_points', prof?.numbers?.achievement_points],
      ['achievements total_points', ach?.numbers?.total_points],
      ['guild achievement_points', gld?.numbers?.achievement_points],
    ];
    const seen = vals.filter(([, v]) => Number.isFinite(v));
    const listed = ach?.lists?.achievements ?? null;
    let verdict = 'unknown';
    let text = seen.length ? seen.map(([k, v]) => `${k} = ${fmt(v)}`).join(', ') : 'No answer carried an achievement-points field.';
    if (seen.some(([, v]) => v > 0)) verdict = 'yes';
    else if (seen.length && listed > 0) {
      verdict = 'no';
      text += `, although ${who}'s achievements list has ${fmt(listed)} entries: the points aren't filled in.`;
    } else if (seen.length) text += `. ${who} lists no achievements, so a zero proves nothing.`;
    add({ id: 'achievement-points', module: 'Achievement points', question: 'Achievement points: are they ever above zero?', verdict, text, evidence: ['character.profile', 'character.achievements', 'guild.profile'] });
  }

  // ---- "first seen": does any collection answer carry a date per item?
  {
    const ids = ['character.collections-mounts', 'character.collections-pets', 'character.collections-toys', 'character.collections-heirlooms', 'character.collections-transmogs', 'character.titles', 'character.achievements'];
    const parts = [];
    let anyYes = false;
    let anyNo = false;
    for (const id of ids) {
      const b = best(id);
      const name = short(by.get(id).template);
      if (!b) {
        parts.push(`${name}: ${why(id)}`);
        continue;
      }
      if (b.timestampKeys?.length) {
        anyYes = anyYes || id !== 'character.achievements';
        parts.push(`${name}: per item ${b.timestampKeys.join(', ')}`);
      } else if ((b.count ?? 0) > 0) {
        anyNo = anyNo || id !== 'character.achievements';
        parts.push(`${name}: ${fmt(b.count)} items, no date on any`);
      } else parts.push(`${name}: answered with an empty list`);
    }
    const verdict = anyYes ? 'yes' : anyNo ? 'no' : 'unknown';
    add({ id: 'first-seen', module: '"First seen"', question: 'Do collection answers say when each item was collected?', verdict, text: `${parts.join('; ')}.${verdict === 'no' ? ' “First seen” would have to be when Everstats first saw it.' : ''}`, evidence: ids });
  }

  // ---- PvP
  {
    const season = best('data.pvp-season-index');
    const region = best('data.pvp-region-index');
    const bracket = by.get('character.pvp-bracket');
    const brOk = (bracket?.attempts ?? []).filter((a) => a.status === 200).map((a) => a.values?.pvpBracket);
    const yes = (season?.count ?? 0) > 0 || (region?.count ?? 0) > 0 || brOk.length > 0;
    const asked = [season, region].some(Boolean) || (bracket?.attempts.length ?? 0) > 0;
    const verdict = yes ? 'yes' : asked && allNotFound(['data.pvp-season-index', 'data.pvp-region-index']) && brOk.length === 0 ? 'no' : 'unknown';
    const text = `pvp-season/index: ${season ? `${fmt(season.count ?? 0)} seasons` : why('data.pvp-season-index')}; pvp-region/index (classic): ${region ? `${fmt(region.count ?? 0)} regions` : why('data.pvp-region-index')}; ${who}'s brackets: ${bracket?.attempts.length ? bracket.attempts.map((a) => `${a.values?.pvpBracket} ${a.status ?? 'no answer'}`).join(', ') : why('character.pvp-bracket')}; pvp-summary: ${best('character.pvp-summary') ? 'answered' : why('character.pvp-summary')}.`;
    add({ id: 'pvp', module: 'PvP', question: 'PvP brackets and seasons: is there data?', verdict, text, evidence: ['data.pvp-season-index', 'data.pvp-region-index', 'character.pvp-bracket', 'character.pvp-summary'] });
  }

  // ---- Mythic+
  {
    const season = best('data.mythic-keystone-season-index');
    const mine = best('character.mythic-keystone-profile');
    const verdict = (season?.count ?? 0) > 0 ? 'yes' : season ? 'unknown' : allNotFound(['data.mythic-keystone-season-index']) ? 'no' : 'unknown';
    const text = `mythic-keystone/season/index: ${season ? `${fmt(season.count ?? 0)} seasons` : why('data.mythic-keystone-season-index')}; ${who}'s mythic-keystone-profile: ${mine ? `answered (${Object.entries(mine.lists ?? {}).map(([k, n]) => `${k}: ${n}`).join(', ') || 'no lists'})` : why('character.mythic-keystone-profile')}.`;
    add({ id: 'mythic', module: 'Mythic+', question: 'Mythic+ seasons: is there data?', verdict, text, evidence: ['data.mythic-keystone-season-index', 'character.mythic-keystone-profile'] });
  }

  // ---- a character by id
  {
    const e = by.get('account.protected-character');
    const b = best('account.protected-character');
    let verdict = 'unknown';
    let text;
    if (b) {
      verdict = 'yes';
      text = `${b.path} answered 200 with the admin's Battle.net token (${fmt(b.bytes)} bytes). Only works for characters on the token's own account.`;
    } else if (e?.skipped) text = `Skipped: ${e.skipped}.`;
    else if (e?.attempts.length) {
      verdict = e.attempts.every((a) => a.status === 404 || a.status === 403 || a.status === 401) ? 'no' : 'unknown';
      text = `${e.attempts.map((a) => `${a.path} ${a.status ?? 'no answer'}`).join('; ')}.`;
    } else text = why('account.protected-character');
    add({ id: 'by-id', module: 'Fetch by id', question: 'Can a character be fetched by id (protected-character)?', verdict, text, evidence: ['account.profile', 'account.protected-character'] });
  }

  // ---- search, realms
  {
    const ids = entries.filter((e) => e.area === 'search').map((e) => e.id);
    const ok = ids.filter((id) => best(id));
    const verdict = ok.length ? 'yes' : allNotFound(ids) ? 'no' : 'unknown';
    const text = ok.length ? `${ok.length} of ${ids.length} search endpoints answered: ${ok.map((id) => `${short(by.get(id).template)} (${fmt(best(id).count ?? 0)} results on page 1)`).join(', ')}.` : `None of the ${ids.length} search endpoints answered (${ids.map((id) => `${short(by.get(id).template)} ${why(id)}`).join('; ')}).`;
    add({ id: 'search', module: 'Search', question: 'Does search work at all?', verdict, text, evidence: ids });
  }
  {
    const b = best('data.connected-realm-index');
    const verdict = (b?.count ?? 0) > 0 ? 'yes' : b || allNotFound(['data.connected-realm-index']) ? 'no' : 'unknown';
    add({ id: 'realms', module: 'Realms', question: `Does ${versionName} have connected realms (auctions, Mythic+ leaderboards)?`, verdict, text: `connected-realm/index: ${b ? `${fmt(b.count ?? 0)} connected realms` : why('data.connected-realm-index')}.`, evidence: ['data.connected-realm-index'] });
  }

  // ---- what answered that we didn't expect: a Forever guess, a path never probed before, a later-expansion system
  const unexpected = entries.filter((e) => e.outcome === 'answered' && (e.flags.includes('guess') || e.flags.includes('first') || e.flags.includes('later'))).map((e) => {
    const b = e.attempts.find((a) => a.status === 200);
    return { id: e.id, area: e.area, path: b.path, namespace: b.namespace, count: b.count, listKey: b.listKey, bytes: b.bytes, flags: e.flags };
  });
  return { answers, unexpected };
}
