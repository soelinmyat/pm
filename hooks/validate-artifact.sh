#!/usr/bin/env bash
# PostToolUse hook — validates frontmatter of pm/ artifacts after Write/Edit.
# Returns validation errors as feedback so the agent can fix them immediately.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

INPUT=$(cat)

# Extract the file path from the tool input
TARGET_PATH=$(printf '%s' "$INPUT" | node -e "
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const toolInput = payload.tool_input || {};
process.stdout.write(typeof toolInput.file_path === 'string' ? toolInput.file_path : '');
" 2>/dev/null) || exit 0

[ -z "$TARGET_PATH" ] && exit 0

# Only validate .md files inside a pm/ directory
case "$TARGET_PATH" in
  */pm/backlog/*.md|*/pm/thinking/*.md|*/pm/evidence/*.md|*/pm/insights/*.md|*/pm/strategy.md) ;;
  *) exit 0 ;;
esac

# Find the pm/ directory from the target path
PM_DIR=$(node -e "
const p = require('path');
let dir = p.dirname('$TARGET_PATH');
while (dir !== p.dirname(dir)) {
  if (p.basename(dir) === 'pm') { process.stdout.write(dir); process.exit(0); }
  dir = p.dirname(dir);
}
" 2>/dev/null) || exit 0

[ -z "$PM_DIR" ] && exit 0

# Run single-file validation
RESULT=$(node "$PLUGIN_ROOT/scripts/validate-file.js" --file "$TARGET_PATH" --pm-dir "$PM_DIR" 2>/dev/null) || true

# Check if validation failed
OK=$(printf '%s' "$RESULT" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r.ok));
" 2>/dev/null) || exit 0

if [ "$OK" = "false" ]; then
  # Extract error messages for agent feedback
  ERRORS=$(printf '%s' "$RESULT" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const msgs = r.errors.map(e => '- ' + (e.field ? e.field + ': ' : '') + e.message);
process.stdout.write('Frontmatter validation failed for ' + require('path').basename('$TARGET_PATH') + ':\n' + msgs.join('\n') + '\nPlease fix the frontmatter and save again.');
" 2>/dev/null)

  echo "$ERRORS"
fi

exit 0
