#!/usr/bin/env bash
# SessionEnd hook — closes any open analytics run when the session ends.
# Without this, the last run in a session stays open forever (only closed
# when the next skill starts, which never happens if the session ends first).

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Check analytics flag — bail fast if disabled
ANALYTICS=$(sed -n 's/^analytics: *//p' "$PROJECT_DIR/.claude/pm.local.md" 2>/dev/null | head -1)
[ "$ANALYTICS" != "true" ] && exit 0

CURRENT_RUN_FILE="$PROJECT_DIR/.pm/analytics/.current-run"
[ -f "$CURRENT_RUN_FILE" ] || exit 0

PREV_RUN_ID=$(cat "$CURRENT_RUN_FILE" 2>/dev/null)
PREV_SKILL=$(printf '%s' "$PREV_RUN_ID" | sed 's/-.*//')

if [ -n "$PREV_RUN_ID" ] && [ -n "$PREV_SKILL" ]; then
  cd "$PROJECT_DIR"
  "$PLUGIN_ROOT/scripts/pm-log.sh" run-end \
    --skill "$PREV_SKILL" \
    --run-id "$PREV_RUN_ID" \
    --status completed 2>/dev/null || true
  rm -f "$CURRENT_RUN_FILE"
fi

# Clean up any stale agent start timestamps
rm -rf "$PROJECT_DIR/.pm/analytics/.agent-starts" 2>/dev/null || true
