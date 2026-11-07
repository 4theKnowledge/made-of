-- Strip the banded-era `maxAges` and `ageNeedScale` knobs from existing
-- daily configs and nuke the pre-generated schedule rows so the cron
-- rebuilds them under the new (chapter-progression, uncapped) rules.
--
-- T-0196. Related: T-0187 (chapter-progression refactor).
--
-- Config rows: strip the two legacy keys in place; leave everything else
-- (guestIngredient, targetDiscoveries, targetByDow). The runtime
-- normaliser already ignores unknown keys, but this cleanup keeps the
-- JSON tidy for admins eyeballing the row.
UPDATE "combine_daily_config"
SET "config" = ("config" - 'maxAges' - 'ageNeedScale'),
    "updated_at" = now();

-- Schedule rows: future scheduled days were generated with the old
-- rules (capped recipes, guest-pool clamped to above-cap items). Delete
-- them so the next cron tick regenerates clean payloads. Keep today's
-- row so players mid-day aren't served an empty payload between
-- migration and the next cron tick. Past rows are an immutable record
-- of what was served and stay.
DELETE FROM "combine_dailies"
WHERE "day" > to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
