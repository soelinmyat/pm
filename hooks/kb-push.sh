#!/usr/bin/env bash
# PostToolUse hook — stages, commits, and pushes pm/ changes.
# Uses a lockfile to prevent concurrent operations.
# Always exits 0 — sync failure must never block the session.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
SKILL=""
MANUAL=false

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --skill) SKILL="$2"; shift 2 ;;
    --manual) MANUAL=true; shift ;;
    *) shift ;;
  esac
done

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || exit 0

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

# Acquire lock (portable: uses mkdir which is atomic on all POSIX systems)
LOCK_DIR="$PROJECT_DIR/.pm/.sync-lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Lock held by another process — skip
  exit 0
fi

# Ensure lock is released on exit
cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_lock EXIT

# Check for pm/ changes (modified, staged, and untracked)
CHANGES=$(git status --porcelain pm/ 2>/dev/null) || exit 0
[ -z "$CHANGES" ] && exit 0

# Determine skill name for commit message
if [ -z "$SKILL" ]; then
  # Try reading from .current-skill file (written by analytics-log.sh)
  if [ -f ".pm/analytics/.current-skill" ]; then
    SKILL=$(cat ".pm/analytics/.current-skill" 2>/dev/null) || true
  fi
  # Default to "manual" if still empty
  [ -z "$SKILL" ] && SKILL="manual"
fi

# Unstage everything first to avoid sweeping previously staged non-pm/ files
# into the auto-commit, then stage only pm/ files.
git reset HEAD >/dev/null 2>&1 || true
git add pm/ 2>/dev/null || exit 0

# Commit with --no-verify to bypass consumer repo hooks
git commit --no-verify -m "chore(pm): sync ${SKILL} changes" >/dev/null 2>&1 || exit 0

# Push — write failure marker if push fails
if ! git push 2>/dev/null; then
  mkdir -p ".pm" 2>/dev/null || true
  printf '%s push failed' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > ".pm/.sync-push-failed" 2>/dev/null || true
fi

exit 0
