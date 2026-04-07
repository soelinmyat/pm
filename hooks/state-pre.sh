#!/usr/bin/env bash
# PreToolUse hook — snapshots PM state files before Write/Edit/MultiEdit so the
# post hook can infer workflow phase and stage transitions.

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
  snapshot \
  --project-dir "$PROJECT_DIR" \
  --file "$TARGET_PATH" 2>/dev/null || true
