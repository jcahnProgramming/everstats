import { RENDER_ORIGIN } from '../crawler/parse.js';

/**
 * Blizzard collection responses → the PARSED values Everstats keeps (never a raw body). Shapes are the ones the 0.8.3
 * endpoint probe stored (run #4: Path Vexley, profile-forever-us, static-…-forever-us). Fields a response doesn't have
 * are left out, never filled in. Every list is capped so one odd response can't fill the database.
 *
 *   collections/mounts      mounts[]: { mount{id,name}, is_useable }
 *   collections/pets        pets[]: { species{id,name}, level, quality{type,name}, stats{health,power,speed}, id }
 *   collections/toys        toys[]: { toy{id,name} }
 *   collections/heirlooms   heirlooms[] (EMPTY on Forever in run #4: the response has only _links)
 *   collections/transmogs   slots[]: { slot{type,name}, appearances[]{id} }
 *   titles                  titles[]{id,name}, active_title{id,name} (run #4's character had none: no `titles` key)
 *   achievements            total_quantity, total_points (0), achievements[]: { id, achievement{name}, criteria{ id,
 *                           is_completed, amount?, child_criteria[]{ id, amount?, is_completed } }, completed_timestamp? }
 *   reputations             reputations[]: { faction{id,name}, standing{ raw, value, max, tier, name } }
 *   professions             primaries[] / secondaries[]: { profession{id,name}, tiers[]{ skill_points, max_skill_points,
 *                           tier{id,name}, known_recipes[] } } (older shapes: skill_points on the profession itself)
 *   quests                  in_progress[]{id,name}; quests/completed: quests[]{id,name}
 *   encounters/dungeons|raids  expansions[].instances[] (run #4's character had none: the documented shape is read
 *                           defensively: instance{id,name}, modes[]{ difficulty, status, progress{ completed_count,
 *                           total_count, encounters[]{ encounter{id,name}, completed_count, last_kill_timestamp } } })
 *   pvp-summary             honorable_kills, pvp_rank (Forever), and whatever other plain numbers it carries
 *   hunter-pets             hunter_pets[]: { name, level, creature{id,name}, is_active, is_summoned } (404 for non-hunters)
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v) => (Number.isFinite(v) ? Math.trunc(v) : null);
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : null);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
const ms = (v) => (Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const idName = (o) => (isObj(o) && Number.isSafeInteger(o.id) ? { id: o.id, name: str(o.name) ?? null } : null);
const QUALITIES = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom']);
const quality = (q) => {
  const t = String(q?.type ?? '').toLowerCase();
  return QUALITIES.has(t) ? t : null;
};

/** The versioned static namespace Blizzard's own links name ("static-1.60.1_70399-forever-us"), or null. */
export function staticNamespaceIn(json, region = 'us') {
  const m = /namespace=(static-[A-Za-z0-9._-]{1,60})/.exec(JSON.stringify(json ?? null));
  return m && m[1].endsWith(`-${region}`) ? m[1] : null;
}

export const parseMounts = (j) => ({
  items: list(j?.mounts, 5000).map((m) => ({ ...idName(m?.mount), useable: m?.is_useable === true })).filter((m) => Number.isSafeInteger(m.id)),
});

export const parsePets = (j) => ({
  items: list(j?.pets, 5000).filter((p) => isObj(p?.species) && Number.isSafeInteger(p.species.id)).map((p) => ({
    id: int(p.id), speciesId: p.species.id, name: str(p.species.name), level: int(p.level), quality: quality(p.quality), qualityName: str(p.quality?.name, 30),
    stats: isObj(p.stats) ? { health: int(p.stats.health), power: int(p.stats.power), speed: int(p.stats.speed) } : null,
    nickname: str(p.name, 60),
  })),
  slots: int(j?.unlocked_battle_pet_slots),
});

export const parseToys = (j) => ({ items: list(j?.toys, 5000).map((t) => idName(t?.toy)).filter(Boolean) });

export const parseHeirlooms = (j) => ({
  items: list(j?.heirlooms, 2000).map((h) => ({ ...idName(h?.heirloom), upgrade: int(h?.upgrade?.level) })).filter((h) => Number.isSafeInteger(h.id)),
});

export const parseTitles = (j) => ({
  active: idName(j?.active_title),
  items: list(j?.titles, 2000).map(idName).filter(Boolean),
});

export function parseTransmogs(j) {
  const slots = list(j?.slots, 40).filter((s) => isObj(s?.slot) && typeof s.slot.type === 'string').map((s) => ({
    type: s.slot.type.slice(0, 30), name: str(s.slot.name, 40) ?? s.slot.type,
    ids: [...new Set(list(s.appearances, 20000).map((a) => a?.id).filter(Number.isSafeInteger))],
  }));
  const sets = list(j?.appearance_sets, 5000).map(idName).filter(Boolean);
  return { slots, ...(sets.length ? { sets } : {}) };
}

function criteriaOf(c, depth = 0) {
  if (!isObj(c) || depth > 4) return null;
  const out = { id: int(c.id), done: c.is_completed === true };
  if (Number.isFinite(c.amount)) out.amount = c.amount;
  const kids = list(c.child_criteria, 60).map((x) => criteriaOf(x, depth + 1)).filter(Boolean);
  if (kids.length) out.children = kids;
  return out;
}

export const parseAchievements = (j) => ({
  totalQuantity: int(j?.total_quantity),
  totalPoints: int(j?.total_points),
  items: list(j?.achievements, 10000).filter((a) => Number.isSafeInteger(a?.id)).map((a) => ({
    id: a.id, name: str(nameOf(a.achievement), 160), completedAt: ms(a.completed_timestamp), criteria: criteriaOf(a.criteria),
  })),
});

export const parseReputations = (j) => ({
  items: list(j?.reputations, 1000).filter((r) => Number.isSafeInteger(r?.faction?.id)).map((r) => ({
    id: r.faction.id, name: str(r.faction.name), tier: int(r.standing?.tier), standing: str(r.standing?.name, 30),
    value: int(r.standing?.value), max: int(r.standing?.max), raw: int(r.standing?.raw),
  })),
});

function professionOf(p) {
  if (!Number.isSafeInteger(p?.profession?.id)) return null;
  const tiers = list(p.tiers, 20).map((t) => ({
    id: int(t?.tier?.id), name: str(t?.tier?.name), skill: int(t?.skill_points), max: int(t?.max_skill_points), recipes: Array.isArray(t?.known_recipes) ? t.known_recipes.length : null,
  }));
  // Older shapes put the skill on the profession itself.
  if (!tiers.length && Number.isFinite(p.skill_points)) tiers.push({ id: null, name: null, skill: int(p.skill_points), max: int(p.max_skill_points), recipes: null });
  return { id: p.profession.id, name: str(p.profession.name), tiers };
}

export const parseProfessions = (j) => ({
  primaries: list(j?.primaries, 10).map(professionOf).filter(Boolean),
  secondaries: list(j?.secondaries, 10).map(professionOf).filter(Boolean),
});

export const parseQuestsInProgress = (j) => ({ items: list(j?.in_progress, 200).map(idName).filter(Boolean) });
export const parseQuestsCompleted = (j) => ({ items: list(j?.quests, 20000).map(idName).filter(Boolean) });

export function parseEncounters(j, kind) {
  const out = [];
  for (const ex of list(j?.expansions, 30)) {
    for (const inst of list(ex?.instances, 200)) {
      if (!Number.isSafeInteger(inst?.instance?.id)) continue;
      out.push({
        id: inst.instance.id, name: str(inst.instance.name), kind, expansion: str(ex?.expansion?.name, 60),
        modes: list(inst.modes, 10).map((m) => ({
          difficulty: str(m?.difficulty?.name, 40), status: str(m?.status?.type, 30),
          completed: int(m?.progress?.completed_count), total: int(m?.progress?.total_count),
          bosses: list(m?.progress?.encounters, 60).filter((e) => Number.isSafeInteger(e?.encounter?.id)).map((e) => ({
            id: e.encounter.id, name: str(e.encounter.name), kills: int(e.completed_count), lastKillAt: ms(e.last_kill_timestamp),
          })),
        })),
      });
    }
  }
  return { items: out };
}

/** PvP summary: the plain numbers Blizzard sent, each under its own key (Forever: honorable_kills, pvp_rank). */
export function parsePvp(j) {
  const fields = {};
  if (!isObj(j)) return { fields };
  for (const [k, v] of Object.entries(j)) {
    if (k.startsWith('_') || !/^[a-z_]{1,40}$/.test(k)) continue;
    if (Number.isFinite(v)) fields[k] = v;
  }
  return { fields };
}

export const parseHunterPets = (j) => ({
  items: list(j?.hunter_pets, 50).filter((p) => typeof p?.name === 'string').map((p) => ({
    name: p.name.slice(0, 60), level: int(p.level), creature: str(p.creature?.name), active: p.is_active === true, summoned: p.is_summoned === true, slot: int(p.slot),
  })),
});

// ---- Static catalogs

/** An icon URL on Blizzard's render host only (the CSP's one other image host), else null. */
export function renderUrl(v) {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.origin === RENDER_ORIGIN && u.protocol === 'https:' ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** A media response → its first asset of `key` ('icon', 'zoom'), on the render host. */
export function mediaAsset(j, key) {
  for (const a of list(j?.assets, 20)) if (a?.key === key) return renderUrl(a.value);
  return null;
}

/** An index's list of { id, name } under `field` ("mounts", "pets", …). */
export const indexOf = (j, field, max = 50_000) => list(j?.[field], max).map(idName).filter(Boolean);

export function parseAchievementDetail(j) {
  if (!Number.isSafeInteger(j?.id)) return null;
  const crit = (c, depth = 0) => {
    if (!isObj(c) || depth > 4) return null;
    const out = { id: int(c.id), description: str(c.description, 200), amount: Number.isFinite(c.amount) ? c.amount : null };
    const kids = list(c.child_criteria, 60).map((x) => crit(x, depth + 1)).filter(Boolean);
    if (kids.length) out.children = kids;
    return out;
  };
  return {
    id: j.id, name: str(j.name, 160), description: str(j.description, 400), categoryId: int(j.category?.id), category: str(j.category?.name),
    points: int(j.points), accountWide: j.is_account_wide === true ? true : j.is_account_wide === false ? false : null,
    reward: str(j.reward_description, 300), criteria: crit(j.criteria), order: int(j.display_order), mediaId: int(j.media?.id),
  };
}

export function parseAppearanceDetail(j) {
  if (!Number.isSafeInteger(j?.id)) return null;
  return {
    id: j.id, slot: str(j.slot?.type, 30), slotName: str(j.slot?.name, 40),
    itemClass: str(j.item_class?.name, 40), itemClassId: int(j.item_class?.id),
    subclass: str(j.item_subclass?.name, 40), subclassId: int(j.item_subclass?.id),
    items: list(j.items, 30).map(idName).filter(Boolean),
    mediaId: int(j.media?.id),
  };
}

/** /data/wow/search/item results → [{ id, name, quality, appearances: [ids] }] (en_US names from the localised maps). */
export function parseItemSearch(j) {
  const local = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.en_US === 'string' ? v.en_US : null);
  return {
    page: int(j?.page), pageCount: int(j?.pageCount),
    items: list(j?.results, 1000).map((r) => r?.data).filter((d) => Number.isSafeInteger(d?.id)).map((d) => ({
      id: d.id, name: str(local(d.name), 160), quality: quality(d.quality),
      appearances: list(d.appearances, 20).map((a) => a?.id).filter(Number.isSafeInteger),
    })),
  };
}
