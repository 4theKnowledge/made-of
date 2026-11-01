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
echo "predeploy: done."
