#!/usr/bin/env bash
# SessionStart hook — pulls latest pm/ files from server.
# Always exits 0 — pull failure must never block the session.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Check sync preferences — skip if sync.enabled or sync.auto_pull is false
SYNC_SKIP=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('$PROJECT_DIR/.pm/config.json','utf8'));
    const s = c.sync || {};
    const enabled = s.enabled !== undefined ? s.enabled : (c.projectId ? true : false);
    const autoPull = s.auto_pull !== undefined ? s.auto_pull : true;
    if (!enabled || !autoPull) process.stdout.write('skip');
  } catch {}
" 2>/dev/null || true)

[ "$SYNC_SKIP" = "skip" ] && exit 0

node "$PLUGIN_ROOT/scripts/kb-sync.js" pull 2>/dev/null || true

exit 0
