#!/usr/bin/env bash
# One-shot launcher for the pm UI.
#   ./pm/run.sh           # port 8765
#   ./pm/run.sh 9000      # custom port
# Runs the HTTP server and opens the browser once it's up (macOS/Linux).
# Auto-restarts on edits to pm/*.py via watchfiles so store/serve changes
# are picked up without a manual kill/restart.

set -euo pipefail

PORT="${1:-8765}"
URL="http://127.0.0.1:${PORT}/"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PM_DIR="$REPO/pm"

echo "starting pm on $URL (hot-reload on pm/*.py)"

# Open the browser once the port is listening.
(
  for _ in $(seq 1 40); do
    if curl -sf "${URL}api/tasks" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then
        open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      fi
      exit 0
    fi
    sleep 0.25
  done
) &

# watchfiles restarts the child on any .py change under pm/.
# Filter=python restricts to .py so tasks.jsonl / changelog.jsonl writes
# (which the server itself makes) don't trigger a restart loop.
exec uv run --project "$PM_DIR" --with watchfiles \
  watchfiles --filter python \
    "python $PM_DIR/serve.py --port $PORT" \
    "$PM_DIR"
