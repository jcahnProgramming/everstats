import { boardCounts, characterRanks, everyoneTied } from '../stats/boards.js';
import { categoryKey, loadCatalog } from '../stats/catalog.js';

/**
 * A tracked character as the public API shows it. Everything carries its freshness: fetchedAt (the last full fetch:
 * statistics, gear), checkedAt (the profile, read even when nothing changed), media.fetchedAt (renders lag the profile
 * by hours) and each statistic's own updatedAt from Blizzard.
 */
export async function characterView(db, row, { mine = false } = {}) {
  const ruleset = row.ruleset_id !== null ? await db.one('SELECT id, name FROM rulesets WHERE id = $1', [row.ruleset_id]) : null;
  const guild = row.guild_id !== null ? await db.one('SELECT name, slug FROM guilds WHERE id = $1', [row.guild_id]) : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    surname: row.surname,
    level: row.level,
    race: row.race,
    class: row.class,
    faction: row.faction,
    gender: row.gender,
    ruleset,
    guild: guild ? { name: guild.name, slug: guild.slug } : null,
    lastLoginAt: row.last_login_at,
    fetchedAt: row.last_fetched_at,
    checkedAt: row.last_checked_at,
    statsFetchedAt: row.stats_fetched_at,
    trackedSince: row.tracked_since,
    media: {
      state: row.media_state ?? 'not_ready',
      render: row.media?.['main-raw'] ?? null,
      avatar: row.media?.avatar ?? null,
      fetchedAt: row.media_fetched_at,
    },
    equipment: row.equipment ?? null,
    attributes: row.attributes ?? null,
    hidden: row.hidden,
    mine,
  };
}

/**
 * Every statistic in the catalog for this character, grouped by category (the owner's decision, else the
 * suggestion). A statistic the character doesn't have is zero (Blizzard lists only what a character has done), and
 * zeros share the rank after everyone above zero. Hidden characters (seen by their owner) get no ranks.
 */
export async function characterStatistics(db, row) {
  const { statistics, categories } = await loadCatalog(db);
  const ranked = row.ruleset_id !== null && !row.hidden;
  const mineById = row.ruleset_id !== null ? await characterRanks(db, row.id, row.ruleset_id) : new Map();
  const counts = ranked ? await boardCounts(db, row.ruleset_id) : null;
  return {
    population: counts?.population ?? null,
    ranked,
    categories: categories.map((c) => ({
      label: c.label,
      key: categoryKey(c.label),
      farmable: c.farmable,
      graded: c.graded,
      statistics: c.statisticIds.map((id) => {
        const s = statistics.get(id);
        const mine = mineById.get(id);
        const value = mine?.value ?? 0;
        const bc = counts?.byStat.get(id) ?? { nonzero: 0, min: null, max: null };
        let rank = null;
        if (ranked) rank = value > 0 ? mine.rank : bc.nonzero + 1;
        return {
          id,
          name: s.name,
          value,
          text: mine?.text ?? null,
          named: s.named,
          grading: s.grading,
          rank,
          tied: ranked ? everyoneTied(counts.population, bc) : false,
          updatedAt: mine?.updatedAt ?? null,
        };
      }),
    })),
  };
}
