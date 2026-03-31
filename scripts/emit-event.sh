#!/usr/bin/env bash
# emit-event.sh — Fire-and-forget event emission to the PM dashboard.
# Usage: emit-event.sh <type> <source> [detail_json]
# Example: emit-event.sh "pr_created" "add-auth" '{"pr_number":42,"url":"..."}'
#
# Discovers the dashboard port via find-dashboard-port.sh.
# If no server is running, exits silently (exit 0).
# POST is non-blocking — never delays the caller.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TYPE="${1:-}"
SOURCE="${2:-}"
DETAIL="${3:-"{}"}"

if [[ -z "$TYPE" || -z "$SOURCE" ]]; then
  exit 0
fi

# Determine project root (git root or cwd)
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Discover dashboard port — silent exit if no server
PORT=$("$SCRIPT_DIR/find-dashboard-port.sh" "$PROJECT_ROOT" 2>/dev/null) || exit 0

TS=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || date +%s)

# Fire-and-forget POST — background + discard output
curl -s -o /dev/null -X POST "http://127.0.0.1:${PORT}/events" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"${TYPE}\",\"source\":\"${SOURCE}\",\"timestamp\":${TS},\"detail\":${DETAIL},\"source_type\":\"terminal\"}" &

exit 0
