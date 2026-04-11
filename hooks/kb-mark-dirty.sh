#!/usr/bin/env bash
# PostToolUse hook — marks sync as dirty when a pm/ file is written.
# Lightweight: no HTTP, no sync, just creates a marker file.
# Always exits 0 — must never block any tool use.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

INPUT=$(cat)

# Extract file_path from tool_input
TARGET_PATH=$(printf '%s' "$INPUT" | node -e "
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const toolInput = payload.tool_input || {};
process.stdout.write(typeof toolInput.file_path === 'string' ? toolInput.file_path : '');
" 2>/dev/null) || exit 0

[ -z "$TARGET_PATH" ] && exit 0

# Resolve to absolute path for comparison
ABS_PROJECT=$(cd "$PROJECT_DIR" 2>/dev/null && pwd) || exit 0
PM_DIR="$ABS_PROJECT/pm/"

# Check if file is inside pm/ (handles relative, ./relative, and absolute paths)
case "$TARGET_PATH" in
  "$PM_DIR"*) ;;
  pm/*) ;;
  ./pm/*) ;;
  *) exit 0 ;;
esac

# Create dirty marker
mkdir -p "$PROJECT_DIR/.pm"
touch "$PROJECT_DIR/.pm/sync-dirty"

exit 0
