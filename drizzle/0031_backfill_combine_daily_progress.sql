-- Backfill `progress` rows from `combine_runs` for daily runs that
-- completed but never landed a leaderboard record (T-0268).
--
-- Two gaps are filled:
--   1. Ended daily runs whose `/finish` never wrote a `progress` row
--      (bundle missed, session dropped, client never fired the POST).
--      Synthesize from the final `state_json`.
--   2. Existing daily `progress` rows whose `result.durationMs` is null
--      (ran before T-0247, or finish hit the no-`startedAt` fallback).
--      Patch from `combine_runs.started_at → ended_at`.
--
-- Safe to run multiple times — both halves are guarded by the current
-- state of the target rows.

-- 1. Insert missing rows. `DISTINCT ON (user_id, theme, daily_key)` keeps
--    one row per leaderboard slot (the latest ended run), matching the
--    leaderboard's `DISTINCT ON (user_id)` semantics.
INSERT INTO progress (id, user_id, kind, ref, result, created_at)
SELECT
  gen_random_uuid()::text,
  r.owner_id,
  'combine',
  r.theme,
  jsonb_build_object(
    'daily', r.daily_key,
    'mode', 'daily',
    'score', COALESCE((r.state_json->>'score')::int, 0),
    'turns', COALESCE((r.state_json->>'moves')::int, 0),
    'made', COALESCE((r.state_json->>'made')::int, 0),
    'chapter', COALESCE((r.state_json->>'chapter')::int, 0),
    'found', COALESCE(jsonb_array_length(r.state_json->'found'), 0),
    'manifestFound', COALESCE(jsonb_array_length(r.state_json->'manifestFound'), 0),
    'manifestSize', COALESCE(jsonb_array_length(r.state_json->'manifest'), 0),
    'engineVersion', r.engine_version,
    'durationMs', CASE
      WHEN r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
        THEN LEAST(
          GREATEST(
            (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000)::bigint,
            0
          ),
          86400000
        )
      ELSE NULL
    END
  ),
  COALESCE(r.ended_at, r.updated_at)
FROM (
  SELECT DISTINCT ON (owner_id, theme, daily_key) *
  FROM combine_runs
  WHERE status = 'ended'
    AND mode = 'daily'
    AND owner_kind = 'user'
    AND daily_key <> ''
  ORDER BY owner_id, theme, daily_key, COALESCE(ended_at, updated_at) DESC
) r
WHERE NOT EXISTS (
  SELECT 1 FROM progress p
  WHERE p.user_id = r.owner_id
    AND p.kind = 'combine'
    AND p.ref = r.theme
    AND p.result->>'daily' = r.daily_key
);

-- 2. Patch durationMs onto existing rows that are missing it.
UPDATE progress p
SET result = p.result || jsonb_build_object(
  'durationMs', LEAST(
    GREATEST(
      (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000)::bigint,
      0
    ),
    86400000
  )
)
FROM combine_runs r
WHERE p.kind = 'combine'
  AND p.result->>'daily' IS NOT NULL
  AND (p.result->>'durationMs') IS NULL
  AND r.owner_kind = 'user'
  AND r.mode = 'daily'
  AND r.status = 'ended'
  AND r.owner_id = p.user_id
  AND r.theme = p.ref
  AND r.daily_key = p.result->>'daily'
  AND r.started_at IS NOT NULL
  AND r.ended_at IS NOT NULL;
