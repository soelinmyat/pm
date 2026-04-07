#!/usr/bin/env bash
# PostToolUse hook — infers PM workflow phase/stage transitions from state-file
# writes and logs completed step spans automatically.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

ANALYTICS=$(sed -n 's/^analytics: *//p' "$PROJECT_DIR/.claude/pm.local.md" 2>/dev/null | head -1)
[ "$ANALYTICS" != "true" ] && exit 0

INPUT=$(cat)

TARGET_PATH=$(printf '%s' "$INPUT" | node -e "
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const toolInput = payload.tool_input || {};
process.stdout.write(typeof toolInput.file_path === 'string' ? toolInput.file_path : '');
" 2>/dev/null) || exit 0

[ -z "$TARGET_PATH" ] && exit 0

node "$PLUGIN_ROOT/scripts/state-telemetry.js" \
  apply \
  --project-dir "$PROJECT_DIR" \
  --plugin-root "$PLUGIN_ROOT" \
  --file "$TARGET_PATH" 2>/dev/null || true
