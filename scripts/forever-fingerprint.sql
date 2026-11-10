-- Forever's numbers, as one fingerprint, to compare BEFORE and AFTER deploying 0.10.0 (deploy step 3 and 6). Read-only.
-- Written against columns that exist in BOTH 0.9.2 and 0.10.0, and it leaves out the boards 0.10.0 adds (rule A7:
-- statistics whose derived key starts 'feed:'), so the two outputs must be identical line for line.
--   docker exec -i everstats-db psql -U postgres -At -v ON_ERROR_STOP=1 < scripts/forever-fingerprint.sql > before.txt
-- Pause the crawler first (Admin → Crawler → Paused) so values don't move between the two runs, and take the AFTER run
-- once the first full grading after the deploy has finished (Admin → Tiers → Gradings).
\pset footer off
SELECT 'characters', count(*), count(*) FILTER (WHERE stats_fetched_at IS NOT NULL), count(*) FILTER (WHERE hidden) FROM characters;
SELECT 'rulesets', id, name FROM rulesets ORDER BY id;
-- Every Blizzard / collection statistic value (not the new feed boards), hashed.
SELECT 'values', count(*), md5(string_agg(cs.character_id || ':' || cs.statistic_id || '=' || cs.value || '@' || cs.ruleset_id, ',' ORDER BY cs.character_id, cs.statistic_id))
  FROM character_statistics cs JOIN statistics s ON s.id = cs.statistic_id WHERE s.derived IS NULL OR s.derived NOT LIKE 'feed:%';
-- Boards: population and leader of the ten most-populated boards on each ruleset (overall).
SELECT 'board', b.ruleset_id, b.statistic_id, b.n, b.top FROM (
  SELECT cs.ruleset_id, cs.statistic_id, count(*) AS n, max(cs.value) AS top, row_number() OVER (PARTITION BY cs.ruleset_id ORDER BY count(*) DESC, cs.statistic_id) AS k
    FROM character_statistics cs JOIN statistics s ON s.id = cs.statistic_id
   WHERE NOT cs.hidden AND cs.value > 0 AND (s.derived IS NULL OR s.derived NOT LIKE 'feed:%')
   GROUP BY cs.ruleset_id, cs.statistic_id) b WHERE b.k <= 10 ORDER BY b.ruleset_id, b.k;
-- Weekly and rolling gains (not the new feed boards).
SELECT 'gains', g.period, count(*), md5(string_agg(g.character_id || ':' || g.statistic_id || '=' || g.gain, ',' ORDER BY g.period, g.character_id, g.statistic_id))
  FROM stat_gains g JOIN statistics s ON s.id = g.statistic_id WHERE s.derived IS NULL OR s.derived NOT LIKE 'feed:%' GROUP BY g.period ORDER BY g.period;
-- Tiers: the letter distribution per ruleset, and every character's letter and score, hashed.
SELECT 'tiers', ruleset_id, coalesce(letter, '-'), count(*) FROM character_tiers GROUP BY ruleset_id, letter ORDER BY ruleset_id, letter;
SELECT 'tier-hash', count(*), md5(string_agg(character_id || ':' || coalesce(letter, '-') || ':' || coalesce(round(score::numeric, 6)::text, '-'), ',' ORDER BY character_id)) FROM character_tiers;
SELECT 'category-tier-hash', count(*), md5(string_agg(character_id || ':' || category_key || ':' || coalesce(letter, '-') || ':' || coalesce(round(score::numeric, 6)::text, '-'), ',' ORDER BY character_id, category_key)) FROM character_category_tiers;
-- What counts (the grading plan each ruleset was last graded with).
-- (Only what counts: the plan's "ungraded" list also names categories that hold only the new feed boards.)
SELECT 'plan', ruleset_id, md5((plan->'statisticIds')::text || (plan->'categories')::text), population, graded FROM tier_rulesets ORDER BY ruleset_id;
-- Path Vexley's page: level, ruleset, guild, statistic values, letter.
SELECT 'path-vexley', c.id, c.level, c.ruleset_id, c.guild_id, t.letter, round(t.score::numeric, 6),
       (SELECT md5(string_agg(cs.statistic_id || '=' || cs.value, ',' ORDER BY cs.statistic_id)) FROM character_statistics cs JOIN statistics s ON s.id = cs.statistic_id
         WHERE cs.character_id = c.id AND (s.derived IS NULL OR s.derived NOT LIKE 'feed:%'))
  FROM characters c LEFT JOIN character_tiers t ON t.character_id = c.id WHERE c.slug = 'path-vexley';
-- Guild totals (not the new feed boards).
SELECT 'guild-totals', count(*), md5(string_agg(gt.guild_id || ':' || gt.statistic_id || ':' || gt.period || '=' || gt.total, ',' ORDER BY gt.guild_id, gt.statistic_id, gt.period))
  FROM guild_totals gt JOIN statistics s ON s.id = gt.statistic_id WHERE s.derived IS NULL OR s.derived NOT LIKE 'feed:%';
