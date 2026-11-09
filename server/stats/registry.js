/**
 * 0.4.0: the live catalog is server/stats/catalog.js (the `statistics` table, grown by crawls, classified by the
 * owner's discovery decisions, else the suggestions). This file keeps the shapes tiers will be built against; the
 * arrays stay empty until tiers are built from the catalog.
 *
 * Statistic, category and leaderboard definitions: a REGISTRY, filled from the discovery pass (what Blizzard's WoW
 * Forever statistics endpoint really returns), never typed in from memory. Empty until then, on purpose: pages that
 * read it show "no coverage yet", never sample data.
 *
 * The shapes everything else will be built against:
 *
 *   Category    { id, label, order, graded, inOverall }
 *                 graded     false for categories that never get a tier (deaths & mishaps)
 *                 inOverall  false for farmable categories (Social, Camping & Hearth): their own tier shows on the
 *                            character page, but never counts toward the overall tier (owner decision, 2026-11-09)
 *   Statistic   { id, blizzardId, label, categoryId, unit, direction, graded, provenance }
 *                 direction  'higher_is_better' | 'lower_is_better'
 *                 graded     false for "bad" stats (deaths and the like): they get a leaderboard, never a tier
 *                 provenance which endpoint / field it comes from, shown beside every value
 *   Leaderboard one per Statistic per ruleset; rulesets come from the API (/data/wow/ruleset/index), never a list here
 *
 * The registry's source will be a table written by the discovery pass (so a new statistic in a game patch is data,
 * not a deploy). Until that exists these are empty arrays.
 */
export const CATEGORIES = Object.freeze([]);
export const STATISTICS = Object.freeze([]);

export const statisticsInCategory = (categoryId) => STATISTICS.filter((s) => s.categoryId === categoryId);
