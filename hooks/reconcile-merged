#!/usr/bin/env bash
# SessionStart hook — detects recently merged PRs whose Linear issues are still open.
# Outputs advisory context so the agent can reconcile on startup.
#
# Runs async to avoid blocking session start. Lightweight: one gh call + file scan.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Only run if the project has Linear integration
CONFIG="$PROJECT_DIR/.pm/config.json"
[ -f "$CONFIG" ] || exit 0
grep -q '"linear"' "$CONFIG" 2>/dev/null || exit 0

# Check for gh CLI
command -v gh >/dev/null 2>&1 || exit 0

cd "$PROJECT_DIR"

# Get PRs merged in the last 48 hours that reference issue IDs
MERGED_PRS=$(gh pr list --state merged --limit 20 \
  --json number,title,headRefName,mergedAt \
  --jq '[.[] | select(.mergedAt > (now - 172800 | todate))] | .[]' 2>/dev/null) || exit 0

[ -z "$MERGED_PRS" ] && exit 0

# Extract issue IDs from merged PR titles/branches and check for stale dev sessions
STALE_ISSUES=""

# Scan dev sessions for merged branches that weren't cleaned up
SESSION_DIR="$PROJECT_DIR/.pm/dev-sessions"
if [ -d "$SESSION_DIR" ]; then
  for session in "$SESSION_DIR"/*.md; do
    [ -f "$session" ] || continue

    # Extract issue ID from session file
    ISSUE_ID=$(grep -m1 -oE '[A-Z]+-[0-9]+' "$session" 2>/dev/null | head -1)
    [ -z "$ISSUE_ID" ] && continue

    # Extract branch from session file (handles multiple formats:
    #   branch: feat/foo, - Branch: feat/foo, - **Branch:** feat/foo)
    BRANCH=$(grep -m1 -i '[*-]*[[:space:]]*branch:' "$session" 2>/dev/null \
      | sed 's/.*[Bb]ranch:[[:space:]]*\*\{0,2\}//' | sed 's/\*//g' | tr -d ' ' | head -1)
    [ -z "$BRANCH" ] && continue

    # Check if this branch's PR was merged
    PR_STATE=$(gh pr view "$BRANCH" --json state --jq .state 2>/dev/null) || continue
    if [ "$PR_STATE" = "MERGED" ]; then
      STALE_ISSUES="${STALE_ISSUES}  - ${ISSUE_ID} (branch: ${BRANCH}, session: $(basename "$session"))\n"
    fi
  done
fi

if [ -n "$STALE_ISSUES" ]; then
  printf "Post-merge reconciliation needed:\n"
  printf "These issues have merged PRs but dev sessions are still open (Linear status likely not updated):\n"
  printf "%b" "$STALE_ISSUES"
  printf "Action: For each, update Linear issue to Done and clean up the dev session file.\n"
fi
