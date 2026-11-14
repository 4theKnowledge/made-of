#!/bin/sh
# Railway's preDeployCommand runs this. We chain migrate -> seed-if-empty
# -> backfill-handles in a script file so shell quoting can't drop a step.
set -e
echo "predeploy: migrate..."
node dist-scripts/migrate.js
echo "predeploy: seed-if-empty..."
node dist-scripts/seed-if-empty.js
echo "predeploy: backfill-handles..."
# Non-fatal: deploy should still ship if a transient DB hiccup prevents
# backfill from finishing. The script is idempotent, so the next deploy
# picks up anyone still NULL.
node dist-scripts/backfill-handles.js || echo "predeploy: backfill-handles failed (non-fatal)"
echo "predeploy: invalidate-stale-combine-runs..."
# Non-fatal: lazy invalidation in run-store.ts still catches stragglers
# per-request, so a failure here just means the cleanup is deferred.
node dist-scripts/invalidate-stale-combine-runs.js || echo "predeploy: invalidate-stale-combine-runs failed (non-fatal)"
echo "predeploy: migrate-hardcoded-pictograms..."
# Non-fatal and idempotent: copies PICTO / KIND_PICTO from the in-code
# fallback maps into items.pictogram / kinds.pictogram where the DB
# column is NULL. After this runs the DB is the source of truth for
# existing items; the in-code maps stay for client-bundle fallback
# until the follow-up phase lands (see task T-0353).
node dist-scripts/migrate-hardcoded-pictograms.js || echo "predeploy: migrate-hardcoded-pictograms failed (non-fatal)"
echo "predeploy: done."
