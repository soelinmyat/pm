#!/usr/bin/env bash
# PostToolUse hook — logs pm: skill invocations when analytics is enabled.
# Fires after every Skill tool call. Checks the analytics flag, extracts
# the skill name from stdin JSON, and delegates to pm-log.sh.
#
# Also emits run-start for each skill invocation and writes .current-run
# so agent-step.sh can correlate agent dispatches to the active skill run.
# When a new skill starts, the previous run is automatically closed.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Check analytics flag — bail fast if disabled
ANALYTICS=$(sed -n 's/^analytics: *//p' "$PROJECT_DIR/.claude/pm.local.md" 2>/dev/null | head -1)
[ "$ANALYTICS" != "true" ] && exit 0

# Read tool input from stdin (PostToolUse provides JSON)
INPUT=$(cat)

# Extract skill name and args from tool_input via JSON parsing so quoted args
# survive intact.
SKILL=$(printf '%s' "$INPUT" | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const ti = d.tool_input || {};
process.stdout.write(ti.skill || '');
" 2>/dev/null) || exit 0
[ -z "$SKILL" ] && exit 0

# Only log pm: skills (skip third-party skills)
case "$SKILL" in pm:*) ;; *) exit 0 ;; esac

# Strip pm: prefix for the log (matches pm-log.sh convention: "dev", "ship", etc.)
SKILL_SHORT="${SKILL#pm:}"

# Extract args if present
ARGS=$(printf '%s' "$INPUT" | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const ti = d.tool_input || {};
process.stdout.write(typeof ti.args === 'string' ? ti.args : '');
" 2>/dev/null) || ARGS=""

# Log — pm-log.sh uses git root for project detection, so cd to project dir
cd "$PROJECT_DIR"

# Legacy invoked event (backward compatible)
"$PLUGIN_ROOT/scripts/pm-log.sh" "$SKILL_SHORT" "invoked" "${ARGS:+args=$ARGS}"

# --- Run lifecycle tracking ---
ANALYTICS_DIR="$PROJECT_DIR/.pm/analytics"
CURRENT_RUN_FILE="$ANALYTICS_DIR/.current-run"
CURRENT_SKILL_FILE="$ANALYTICS_DIR/.current-skill"

# Close previous run if one was active
if [ -f "$CURRENT_RUN_FILE" ]; then
  PREV_RUN_ID=$(cat "$CURRENT_RUN_FILE" 2>/dev/null)
  PREV_SKILL=$(cat "$CURRENT_SKILL_FILE" 2>/dev/null || true)
  if [ -z "$PREV_SKILL" ]; then
    PREV_SKILL=$(printf '%s' "$PREV_RUN_ID" | sed 's/-.*//')
  fi
  if [ -n "$PREV_RUN_ID" ] && [ -n "$PREV_SKILL" ]; then
    "$PLUGIN_ROOT/scripts/pm-log.sh" active-step-close 2>/dev/null || true
    "$PLUGIN_ROOT/scripts/pm-log.sh" run-end \
      --skill "$PREV_SKILL" \
      --run-id "$PREV_RUN_ID" \
      --status completed 2>/dev/null || true
  fi
fi

# Start new run and write run_id for agent-step correlation
RUN_ID=$("$PLUGIN_ROOT/scripts/pm-log.sh" run-start --skill "$SKILL_SHORT" ${ARGS:+--args "$ARGS"}) || true
if [ -n "$RUN_ID" ]; then
  mkdir -p "$ANALYTICS_DIR"
  printf '%s' "$RUN_ID" > "$CURRENT_RUN_FILE"
  printf '%s' "$SKILL_SHORT" > "$CURRENT_SKILL_FILE"
fi
