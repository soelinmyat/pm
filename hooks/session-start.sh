#!/usr/bin/env bash
# SessionStart hook for pm plugin
# Preloads the using-pm skill into session context

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL_FILE="${PLUGIN_ROOT}/skills/using-pm/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Warning: using-pm/SKILL.md not found at ${SKILL_FILE}. Skill routing unavailable."
  exit 0
fi

# Read using-pm skill content
using_dev_content=$(cat "$SKILL_FILE" 2>&1 || echo "Error reading using-pm skill")

# Escape string for JSON embedding using bash parameter substitution
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_dev_escaped=$(escape_for_json "$using_dev_content")

session_context="<EXTREMELY_IMPORTANT>\nYou have plugin skills.\n\n**Below is the full content of your 'using-pm' skill — your guide to using plugin skills. For all other skills, use the 'Skill' tool:**\n\n${using_dev_escaped}\n</EXTREMELY_IMPORTANT>"

# Output context injection as JSON
# Claude Code expects hookSpecificOutput.additionalContext
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"
else
  printf '{\n  "additional_context": "%s"\n}\n' "$session_context"
fi

exit 0
