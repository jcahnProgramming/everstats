-- Rolls migration 027 (0.10.0, game versions) back, so the 0.9.2 code runs again. ONLY for a rollback to 0.9.2: run it
-- after stopping both app containers and BEFORE starting the 0.9.2 images (RESTORE.md "Rolling back 0.10.0").
--   docker exec -i everstats-db psql -U postgres -v ON_ERROR_STOP=1 < scripts/rollback-027.sql
-- One transaction: all of it or nothing. It refuses (and changes nothing) if any row belongs to a version other than
-- Forever or a region other than US (none can exist before 0.11.0 turns a version on).
--
-- What it deletes, and why (CLAUDE.md "Data rules"):
--   - discovery_group_decisions and the 'group_exempt' markers: the 0.10.0 group choices (ours). 0.9.2 has no groups
--     and decides per statistic only, which is exactly what those rows preserved; the per-statistic decisions stay.
--   - the feed boards' statistics ('feed:…' derived keys) and their values: Blizzard data 0.9.2 never made.
--   - blizzard_ids, realms: empty before 0.11.0 (only other versions use them).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM characters WHERE game_version <> 'forever' OR region <> 'us')
     OR EXISTS (SELECT 1 FROM guilds WHERE game_version <> 'forever' OR region <> 'us')
     OR EXISTS (SELECT 1 FROM statistics WHERE game_version <> 'forever')
     OR EXISTS (SELECT 1 FROM rulesets WHERE game_version <> 'forever' OR region <> 'us') THEN
    RAISE EXCEPTION 'rows of another game version or region exist: this rollback would lose them';
  END IF;
END $$;

-- 0.10.0 data 0.9.2 doesn't know
DELETE FROM character_statistics cs USING statistics s WHERE s.id = cs.statistic_id AND s.derived LIKE 'feed:%';
DELETE FROM stat_gains g USING statistics s WHERE s.id = g.statistic_id AND s.derived LIKE 'feed:%';
DELETE FROM account_pins p USING statistics s WHERE s.id = p.statistic_id AND s.derived LIKE 'feed:%';
DELETE FROM pin_rank_history p USING statistics s WHERE s.id = p.statistic_id AND s.derived LIKE 'feed:%';
DELETE FROM statistics WHERE derived LIKE 'feed:%';
DELETE FROM discovery_decisions WHERE kind = 'group_exempt';
DELETE FROM pipeline_facts WHERE key = 'tier_groups_migrated_at';
DELETE FROM settings WHERE key LIKE '%@%' OR key IN ('crawler.versionShares', 'crawler.budgetScope');

-- the schema, back to 026
DROP TABLE discovery_group_decisions;
DROP TABLE blizzard_ids;
DROP TABLE realms;
DROP SEQUENCE local_character_ids, local_guild_ids, local_ruleset_ids, local_statistic_ids;

ALTER TABLE discovery_decisions DROP CONSTRAINT discovery_decisions_kind_check;
ALTER TABLE discovery_decisions ADD CONSTRAINT discovery_decisions_kind_check
  CHECK (kind IN ('category', 'bad', 'grading', 'leaderboard', 'duplicate', 'value_type'));
ALTER TABLE discovery_decisions DROP COLUMN game_version;
ALTER TABLE discovery_catalog DROP COLUMN game_version;
ALTER TABLE discovery_runs DROP COLUMN game_version, DROP COLUMN region;

ALTER TABLE collection_catalog_state DROP CONSTRAINT collection_catalog_state_pkey;
ALTER TABLE collection_catalog_state DROP COLUMN game_version, DROP COLUMN region;
ALTER TABLE collection_catalog_state ADD PRIMARY KEY (kind);
ALTER TABLE collection_catalog DROP CONSTRAINT collection_catalog_pkey;
ALTER TABLE collection_catalog DROP COLUMN game_version, DROP COLUMN region;
ALTER TABLE collection_catalog ADD PRIMARY KEY (kind, id);
ALTER TABLE item_media DROP CONSTRAINT item_media_pkey;
ALTER TABLE item_media DROP COLUMN game_version, DROP COLUMN region;
ALTER TABLE item_media ADD PRIMARY KEY (item_id);

DROP INDEX guild_fetches_live;
ALTER TABLE guild_fetches DROP COLUMN game_version, DROP COLUMN region;
CREATE UNIQUE INDEX guild_fetches_live ON guild_fetches (slug) WHERE state IN ('roster', 'ready', 'queued', 'running');

DROP INDEX crawl_queue_pending;
ALTER TABLE crawl_queue DROP COLUMN game_version, DROP COLUMN region;
CREATE UNIQUE INDEX crawl_queue_pending ON crawl_queue (kind, key) WHERE state IN ('queued', 'running');

DROP INDEX statistics_derived;
DROP INDEX statistics_blizzard;
ALTER TABLE statistics DROP COLUMN game_version, DROP COLUMN blizzard_id, DROP COLUMN source;
CREATE UNIQUE INDEX statistics_derived ON statistics (derived) WHERE derived IS NOT NULL;

DROP INDEX rulesets_blizzard;
DROP INDEX rulesets_category_key;
ALTER TABLE rulesets DROP COLUMN game_version, DROP COLUMN region, DROP COLUMN blizzard_id, DROP COLUMN category_key;

DROP INDEX guilds_blizzard;
DROP INDEX guilds_slug;
ALTER TABLE guilds DROP COLUMN game_version, DROP COLUMN region, DROP COLUMN realm_slug, DROP COLUMN blizzard_id;
CREATE INDEX guilds_slug ON guilds (slug);

DROP INDEX characters_blizzard;
DROP INDEX characters_slug;
ALTER TABLE characters DROP COLUMN game_version, DROP COLUMN region, DROP COLUMN realm_slug, DROP COLUMN blizzard_id;
CREATE UNIQUE INDEX characters_slug ON characters (slug) WHERE slug IS NOT NULL;

ALTER TABLE badge_definitions DROP COLUMN game_version;
ALTER TABLE share_card_images DROP COLUMN game_version;

DELETE FROM _migrations WHERE id = '027_game_versions';
COMMIT;
