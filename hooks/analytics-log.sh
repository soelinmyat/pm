#!/usr/bin/env bash
# PostToolUse hook — logs pm: skill invocations when analytics is enabled.
# Fires after every Skill tool call. Checks the analytics flag, extracts
# the skill name from stdin JSON, and delegates to pm-log.sh.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Check analytics flag — bail fast if disabled
ANALYTICS=$(sed -n 's/^analytics: *//p' "$PROJECT_DIR/.claude/pm.local.md" 2>/dev/null | head -1)
[ "$ANALYTICS" != "true" ] && exit 0

# Read tool input from stdin (PostToolUse provides JSON)
INPUT=$(cat)

# Extract skill name from tool_input.skill
SKILL=$(printf '%s' "$INPUT" | sed -n 's/.*"skill"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SKILL" ] && exit 0

# Only log pm: skills (skip third-party skills)
case "$SKILL" in pm:*) ;; *) exit 0 ;; esac

# Strip pm: prefix for the log (matches pm-log.sh convention: "dev", "ship", etc.)
SKILL_SHORT="${SKILL#pm:}"

# Extract args if present
ARGS=$(printf '%s' "$INPUT" | sed -n 's/.*"args"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# Log — pm-log.sh uses git root for project detection, so cd to project dir
cd "$PROJECT_DIR"
"$PLUGIN_ROOT/scripts/pm-log.sh" "$SKILL_SHORT" "invoked" "${ARGS:+args=$ARGS}"
