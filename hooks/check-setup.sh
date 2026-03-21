#!/usr/bin/env bash
# Merged SessionStart hook for pm plugin.
# Execution order:
#   1. Advisory checks (CLAUDE.md, AGENTS.md, .gitignore) — never exit early
#   2. First-run detection (.pm/config.json absent → advisory only)
#   3. Daily update check (git ls-remote + marketplace sync)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Wait up to $2 seconds for background PID $1 to finish, then kill it.
wait_or_kill() {
  local pid=$1 max=${2:-5}
  local n=0
  while [ "$n" -lt "$max" ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
    n=$(( n + 1 ))
  done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

WARNINGS=""

# ---------------------------------------------------------------------------
# 1. Advisory checks — never exit early
# ---------------------------------------------------------------------------

# Check for CLAUDE.md
if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
  WARNINGS="${WARNINGS}No CLAUDE.md found. Review agents will have limited product context.\n"
else
  LINE_COUNT=$(wc -l < "$PROJECT_DIR/CLAUDE.md" 2>/dev/null | tr -d ' ')
  if [ "$LINE_COUNT" -lt 20 ]; then
    WARNINGS="${WARNINGS}CLAUDE.md is minimal (${LINE_COUNT} lines). Review agents work best with user personas, scale expectations, and design principles documented.\n"
  fi
fi

# Check for AGENTS.md
if [ ! -f "$PROJECT_DIR/AGENTS.md" ]; then
  WARNINGS="${WARNINGS}No AGENTS.md found. Will fall back to convention-based detection for test/build commands.\n"
fi

# Check for .gitignore coverage of state files
if [ -f "$PROJECT_DIR/.gitignore" ]; then
  MISSING_IGNORES=""
  grep -q '\.dev-state-\*\.md' "$PROJECT_DIR/.gitignore" 2>/dev/null || MISSING_IGNORES="${MISSING_IGNORES}.dev-state-*.md "
  grep -q '\.dev-epic-state-\*\.md' "$PROJECT_DIR/.gitignore" 2>/dev/null || MISSING_IGNORES="${MISSING_IGNORES}.dev-epic-state-*.md "
  grep -q 'dev/instructions\.local\.md' "$PROJECT_DIR/.gitignore" 2>/dev/null || MISSING_IGNORES="${MISSING_IGNORES}dev/instructions.local.md "
  if [ -n "$MISSING_IGNORES" ]; then
    WARNINGS="${WARNINGS}Consider adding to .gitignore: ${MISSING_IGNORES}\n"
  fi
fi

# ---------------------------------------------------------------------------
# 2. First-run detection — advisory only, no early exit
# ---------------------------------------------------------------------------

if [ ! -f "$PROJECT_DIR/.pm/config.json" ]; then
  WARNINGS="${WARNINGS}Hint: /pm:setup is available to configure integrations (Linear, Ahrefs) — this is optional. You can start right away with /pm:groom or /pm:research.\n"
fi

# Print accumulated warnings
if [ -n "$WARNINGS" ]; then
  printf "Plugin advisory:\n${WARNINGS}"
fi

# ---------------------------------------------------------------------------
# 3. Update check (at most once per day)
# ---------------------------------------------------------------------------

STAMP_FILE="$PROJECT_DIR/.pm/.update_check"
NOW=$(date +%s)
CHECK_INTERVAL=86400  # 24 hours

# Skip if checked recently
if [ -f "$STAMP_FILE" ]; then
  LAST_CHECK=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
  ELAPSED=$(( NOW - LAST_CHECK ))
  if [ "$ELAPSED" -lt "$CHECK_INTERVAL" ]; then
    exit 0
  fi
fi

# Read installed version from plugin.json
INSTALLED_VERSION=""
if [ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
  INSTALLED_VERSION=$(grep '"version"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$INSTALLED_VERSION" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Start both network operations concurrently to minimize wall-clock time.
# Each gets up to 5 seconds before being killed.
# ---------------------------------------------------------------------------

REPO_URL="https://github.com/soelinmyat/pm.git"

# 1. Fetch latest tag from remote
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
git ls-remote --tags --sort=-v:refname "$REPO_URL" > "$TMPFILE" 2>/dev/null &
GIT_PID=$!

# 2. Sync marketplace clone so /plugin sees the correct latest version.
#    Claude Code reads version from this local clone but never git-pulls it,
#    causing /plugin to report "already at latest" on stale clones.
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/pm"
PULL_PID=""
if [ -d "$MARKETPLACE_DIR/.git" ]; then
  git -C "$MARKETPLACE_DIR" pull --ff-only origin main >/dev/null 2>&1 &
  PULL_PID=$!
fi

# Wait for both (pull runs in parallel while we wait for ls-remote)
wait_or_kill "$GIT_PID" 5
[ -n "$PULL_PID" ] && [ "$PULL_PID" -gt 0 ] 2>/dev/null && wait_or_kill "$PULL_PID" 5

# Process ls-remote result
LATEST_TAG=""
if [ -s "$TMPFILE" ]; then
  LATEST_TAG=$(head -1 "$TMPFILE" | sed 's/.*refs\/tags\///' | sed 's/\^{}//')
fi
rm -f "$TMPFILE"

# Write timestamp regardless of result (don't re-check on failure)
mkdir -p "$PROJECT_DIR/.pm"
echo "$NOW" > "$STAMP_FILE"

if [ -z "$LATEST_TAG" ]; then
  exit 0
fi

# Strip leading 'v' for comparison
LATEST_VERSION="${LATEST_TAG#v}"

if [ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]; then
  echo "PM plugin update available: v${INSTALLED_VERSION} → v${LATEST_VERSION}. Run /plugin to update."
fi
