#!/usr/bin/env bash
# SessionStart hook — pulls latest pm/ changes from the remote.
# Uses git fetch + git checkout to update only pm/ files without rebasing.
# Always exits 0 — sync failure must never block the session.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
MANUAL=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --manual) MANUAL=true ;;
  esac
done

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || exit 0

# Escape string for JSON embedding
escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# Output additionalContext JSON to stdout
output_context() {
  local msg
  msg=$(escape_for_json "$1")
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$msg"
}

# Not a git repo — silent no-op
git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 || exit 0

cd "$PROJECT_DIR" || exit 0

# Check auto_sync preference (skip if false and not manual)
if [ "$MANUAL" = "false" ] && [ -f ".pm/config.json" ]; then
  AUTO_SYNC=$(node -e "
    try { const c = require('$PROJECT_DIR/.pm/config.json');
    console.log(c.preferences && c.preferences.auto_sync !== undefined ? c.preferences.auto_sync : 'true'); }
    catch(e) { console.log('true'); }" 2>/dev/null)
  [ "$AUTO_SYNC" = "false" ] && exit 0
fi

# Check for previous push failure marker
if [ -f ".pm/.sync-push-failed" ]; then
  FAIL_INFO=$(cat ".pm/.sync-push-failed" 2>/dev/null || true)
  output_context "Warning: previous KB push failed (${FAIL_INFO}). Run /sync push to retry."
fi

# No remote configured — silent no-op
git remote get-url origin >/dev/null 2>&1 || exit 0

# Get current branch
BRANCH=$(git branch --show-current 2>/dev/null) || exit 0
[ -z "$BRANCH" ] && exit 0

# Fetch from remote (may fail on network issues — that's OK)
if ! git fetch origin "$BRANCH" 2>/dev/null; then
  output_context "KB sync: fetch failed (network issue?). Using local copy."
  exit 0
fi

# Check if remote has pm/ changes we don't have
# Compare local HEAD pm/ tree with origin/{branch} pm/ tree
LOCAL_TREE=$(git ls-tree -r HEAD -- pm/ 2>/dev/null | sort) || true
REMOTE_TREE=$(git ls-tree -r "origin/$BRANCH" -- pm/ 2>/dev/null | sort) || true

if [ "$LOCAL_TREE" = "$REMOTE_TREE" ]; then
  output_context "KB sync: already up to date."
  exit 0
fi

# Checkout pm/ from remote — only touches pm/ files
if git checkout "origin/$BRANCH" -- pm/ 2>/dev/null; then
  # Count how many files changed
  CHANGED=$(git diff --cached --name-only -- pm/ 2>/dev/null | wc -l | tr -d ' ')
  if [ "$CHANGED" -gt 0 ]; then
    # Reset the index so the checked-out files appear as working tree changes,
    # not staged changes (avoids polluting the user's index)
    git reset HEAD -- pm/ >/dev/null 2>&1 || true
    output_context "KB synced: ${CHANGED} files updated from remote."
  else
    output_context "KB sync: already up to date."
  fi
else
  output_context "KB sync: checkout failed. Using local copy."
fi

exit 0
