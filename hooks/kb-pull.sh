#!/usr/bin/env bash
# SessionStart hook — pulls latest pm/ files from server.
# Always exits 0 — pull failure must never block the session.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

node "$PLUGIN_ROOT/scripts/kb-sync.js" pull 2>/dev/null || true

exit 0
