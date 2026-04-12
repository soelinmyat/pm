#!/usr/bin/env bash
# SessionEnd hook — pushes modified pm/ files to server if dirty marker exists.
# Always exits 0 — push failure must never block the session.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

DIRTY_MARKER="$PROJECT_DIR/.pm/sync-dirty"

# No dirty marker — nothing was written to pm/ this session
[ -f "$DIRTY_MARKER" ] || exit 0

# Check sync preferences — skip if sync.enabled or sync.auto_push is false
SYNC_SKIP=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('$PROJECT_DIR/.pm/config.json','utf8'));
    const s = c.sync || {};
    const enabled = s.enabled !== undefined ? s.enabled : (c.projectId ? true : false);
    const autoPush = s.auto_push !== undefined ? s.auto_push : true;
    if (!enabled || !autoPush) process.stdout.write('skip');
  } catch {}
" 2>/dev/null || true)

if [ "$SYNC_SKIP" = "skip" ]; then
  rm -f "$DIRTY_MARKER"
  exit 0
fi

# Push changes to server
node "$PLUGIN_ROOT/scripts/kb-sync.js" push 2>/dev/null || true

# Remove dirty marker regardless of push result
rm -f "$DIRTY_MARKER"

exit 0
