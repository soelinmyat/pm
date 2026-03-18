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
PM plugin is not configured for this project. Run /pm:setup to bootstrap
the knowledge base and configure integrations (Linear, Ahrefs).
Skip this if you only need /pm:view (read-only over committed files).
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Update check (at most once per day)
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

# ---------------------------------------------------------------------------
# Sync marketplace clone so /plugin sees the correct latest version.
# Claude Code reads version from this local clone but never git-pulls it,
# causing /plugin to report "already at latest" on stale clones.
# ---------------------------------------------------------------------------
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/pm"
if [ -d "$MARKETPLACE_DIR/.git" ]; then
  git -C "$MARKETPLACE_DIR" pull --ff-only origin main >/dev/null 2>&1 &
  PULL_PID=$!
  for j in 1 2 3 4 5; do
    if ! kill -0 "$PULL_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  kill "$PULL_PID" 2>/dev/null
  wait "$PULL_PID" 2>/dev/null
fi

if [ -z "$LATEST_TAG" ]; then
  exit 0
fi

# Strip leading 'v' for comparison
LATEST_VERSION="${LATEST_TAG#v}"

if [ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]; then
  echo "PM plugin update available: v${INSTALLED_VERSION} → v${LATEST_VERSION}. Run /plugin to update."
fi
