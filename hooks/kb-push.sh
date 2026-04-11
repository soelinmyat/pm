#!/usr/bin/env bash
# SessionEnd hook — pushes modified pm/ files to server if dirty marker exists.
# Always exits 0 — push failure must never block the session.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

DIRTY_MARKER="$PROJECT_DIR/.pm/sync-dirty"

# No dirty marker — nothing was written to pm/ this session
[ -f "$DIRTY_MARKER" ] || exit 0

# Push changes to server
node "$PLUGIN_ROOT/scripts/kb-sync.js" push 2>/dev/null || true

# Remove dirty marker regardless of push result
rm -f "$DIRTY_MARKER"

exit 0
