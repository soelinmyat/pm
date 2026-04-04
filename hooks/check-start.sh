#!/usr/bin/env bash
# SessionStart hook for pm plugin.
# 1. Advisory message if .pm/config.json is missing (first-run detection).
# 2. Once-per-day update check via git ls-remote --tags.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"

# ---------------------------------------------------------------------------
# First-run detection
# ---------------------------------------------------------------------------

if [ ! -f "$PROJECT_DIR/.pm/config.json" ]; then
  cat <<'EOF'
PM plugin is not initialized for this project. Run /pm:start to create
the PM workspace and choose your first workflow.
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Update check (at most once per day)
# ---------------------------------------------------------------------------

STAMP_FILE="$PROJECT_DIR/.pm/.update_check"
STATUS_FILE="$PROJECT_DIR/.pm/.update_status"
NOW=$(date +%s)
CHECK_INTERVAL=86400  # 24 hours

# Read installed version from plugin.json
INSTALLED_VERSION=""
if [ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
  INSTALLED_VERSION=$(grep '"version"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$INSTALLED_VERSION" ]; then
  exit 0
fi

print_cached_update_notice() {
  [ -f "$STATUS_FILE" ] || return 0

  local cached_installed=""
  local cached_latest=""
  cached_installed=$(sed -n 's/^installed=//p' "$STATUS_FILE" | head -1)
  cached_latest=$(sed -n 's/^latest=//p' "$STATUS_FILE" | head -1)

  [ -n "$cached_installed" ] || return 0
  [ -n "$cached_latest" ] || return 0

  if [ "$cached_installed" != "$INSTALLED_VERSION" ]; then
    rm -f "$STATUS_FILE"
    return 0
  fi

  if [ "$cached_installed" != "$cached_latest" ]; then
    echo "PM plugin update available: v${cached_installed} → v${cached_latest}. Update PM in your client. On Claude Code, run /plugin."
  fi
}

# Skip if checked recently, but still show any cached update notice
if [ -f "$STAMP_FILE" ]; then
  LAST_CHECK=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
  ELAPSED=$(( NOW - LAST_CHECK ))
  if [ "$ELAPSED" -lt "$CHECK_INTERVAL" ]; then
    print_cached_update_notice
    exit 0
  fi
fi

# Fetch latest tag from remote (background + kill to avoid blocking on macOS)
REPO_URL="https://github.com/soelinmyat/pm.git"
LATEST_TAG=""
TMPFILE=$(mktemp)
git ls-remote --tags --sort=-v:refname "$REPO_URL" > "$TMPFILE" 2>/dev/null &
GIT_PID=$!
sleep 0 # yield
for i in 1 2 3 4 5; do
  if ! kill -0 "$GIT_PID" 2>/dev/null; then break; fi
  sleep 1
done
kill "$GIT_PID" 2>/dev/null
wait "$GIT_PID" 2>/dev/null
if [ -s "$TMPFILE" ]; then
  LATEST_TAG=$(head -1 "$TMPFILE" | sed 's/.*refs\/tags\///' | sed 's/\^{}//')
fi
rm -f "$TMPFILE"

# Write timestamp regardless of result (don't re-check on failure)
mkdir -p "$PROJECT_DIR/.pm"
echo "$NOW" > "$STAMP_FILE"

if [ -z "$LATEST_TAG" ]; then
  print_cached_update_notice
  exit 0
fi

# Strip leading 'v' for comparison
LATEST_VERSION="${LATEST_TAG#v}"

cat > "$STATUS_FILE" <<EOF
installed=$INSTALLED_VERSION
latest=$LATEST_VERSION
EOF

if [ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]; then
  echo "PM plugin update available: v${INSTALLED_VERSION} → v${LATEST_VERSION}. Update PM in your client. On Claude Code, run /plugin."
fi
