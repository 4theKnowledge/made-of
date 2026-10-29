#!/bin/sh
# Railway's preDeployCommand runs this. We chain migrate -> seed-if-empty
# in a script file so shell quoting can't drop the second command.
set -e
echo "predeploy: migrate..."
node dist-scripts/migrate.js
echo "predeploy: seed-if-empty..."
node dist-scripts/seed-if-empty.js
echo "predeploy: done."
