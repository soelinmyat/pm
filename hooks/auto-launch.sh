#!/usr/bin/env bash
# Auto-launch the PM dashboard server on session start and print project pulse.
# Prints the dashboard URL + 3-line project health summary.
# Always exits 0 — dashboard launch failure must never block the session.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || exit 0

# Check opt-out preference
if [ -f "$PROJECT_DIR/.pm/config.json" ]; then
  AUTO_LAUNCH=$(node -e "
    try { const c = require('$PROJECT_DIR/.pm/config.json');
    console.log(c.preferences && c.preferences.auto_launch !== undefined ? c.preferences.auto_launch : 'true'); }
    catch(e) { console.log('true'); }" 2>/dev/null)
  [ "$AUTO_LAUNCH" = "false" ] && exit 0
fi

# Always go through start-server.sh so stale dashboard instances are replaced
# with a fresh server for the current session.
OUTPUT=$(bash "$PLUGIN_ROOT/scripts/start-server.sh" --project-dir "$PROJECT_DIR" 2>/dev/null)
if [ -n "$OUTPUT" ]; then
  URL=$(echo "$OUTPUT" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try { const u = JSON.parse(d).url; if(u) console.log(u); }
      catch(e) {}
    });" 2>/dev/null)
  [ -n "$URL" ] && echo "Dashboard: ${URL}"
fi

# ---------------------------------------------------------------------------
# Project Pulse — 3-line health summary
# ---------------------------------------------------------------------------

PM_DIR="$PROJECT_DIR/pm"

# If no knowledge base exists, just suggest getting started
if [ ! -d "$PM_DIR" ]; then
  echo "  Next: /pm:setup or /pm:groom to get started"
  exit 0
fi

NOW=$(date +%s)
STALE_DAYS=30
AGING_DAYS=14
STALE_THRESHOLD=$((NOW - STALE_DAYS * 86400))
AGING_THRESHOLD=$((NOW - AGING_DAYS * 86400))

# ---------------------------------------------------------------------------
# Helper: extract a flat YAML frontmatter value from a file.
# Usage: fm_value <file> <key>
# Returns the value or empty string.
# ---------------------------------------------------------------------------
fm_value() {
  sed -n '/^---$/,/^---$/{ /^'"$2"':/{s/^'"$2"': *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/; p; q; }; }' "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Helper: convert YYYY-MM-DD to epoch seconds (portable macOS + Linux).
# ---------------------------------------------------------------------------
date_to_epoch() {
  local d="$1"
  [ -z "$d" ] && echo "0" && return
  # Try GNU date first, fall back to macOS date
  date -d "$d" +%s 2>/dev/null || date -jf "%Y-%m-%d" "$d" +%s 2>/dev/null || echo "0"
}

# ---------------------------------------------------------------------------
# Line 1: Attention needed — stale research/competitors + aging ideas
# ---------------------------------------------------------------------------
stale_count=0
aging_count=0

# Scan research findings for staleness
for f in "$PM_DIR"/research/*/findings.md; do
  [ -f "$f" ] || continue
  updated=$(fm_value "$f" "updated")
  epoch=$(date_to_epoch "$updated")
  [ "$epoch" -lt "$STALE_THRESHOLD" ] 2>/dev/null && stale_count=$((stale_count + 1))
done

# Scan competitor profiles for staleness
for f in "$PM_DIR"/competitors/*/profile.md; do
  [ -f "$f" ] || continue
  updated=$(fm_value "$f" "updated")
  epoch=$(date_to_epoch "$updated")
  [ "$epoch" -lt "$STALE_THRESHOLD" ] 2>/dev/null && stale_count=$((stale_count + 1))
done

# Scan backlog for aging ideas (status: idea, older than 14 days)
for f in "$PM_DIR"/backlog/*.md; do
  [ -f "$f" ] || continue
  status=$(fm_value "$f" "status")
  [ "$status" = "idea" ] || continue
  updated=$(fm_value "$f" "updated")
  epoch=$(date_to_epoch "$updated")
  [ "$epoch" -lt "$AGING_THRESHOLD" ] 2>/dev/null && aging_count=$((aging_count + 1))
done

if [ "$stale_count" -eq 0 ] && [ "$aging_count" -eq 0 ]; then
  echo "  All fresh"
elif [ "$stale_count" -gt 0 ] && [ "$aging_count" -gt 0 ]; then
  echo "  ${stale_count} stale, ${aging_count} aging ideas"
elif [ "$stale_count" -gt 0 ]; then
  echo "  ${stale_count} stale"
else
  echo "  ${aging_count} aging ideas"
fi

# ---------------------------------------------------------------------------
# Line 2: Backlog shape — count by status
# ---------------------------------------------------------------------------
ideas=0; in_progress=0; shipped=0

for f in "$PM_DIR"/backlog/*.md; do
  [ -f "$f" ] || continue
  status=$(fm_value "$f" "status")
  case "$status" in
    idea|drafted) ideas=$((ideas + 1)) ;;
    approved|in-progress) in_progress=$((in_progress + 1)) ;;
    done) shipped=$((shipped + 1)) ;;
  esac
done

echo "  Backlog: ${ideas} ideas, ${in_progress} in progress, ${shipped} shipped"

# ---------------------------------------------------------------------------
# Line 3: Suggested next action (first match wins)
# ---------------------------------------------------------------------------
if [ ! -f "$PM_DIR/strategy.md" ]; then
  echo "  Next: /pm:strategy"
elif [ "$stale_count" -gt 0 ]; then
  echo "  Next: /pm:refresh (${stale_count} stale items)"
elif [ "$aging_count" -gt 3 ]; then
  echo "  Next: /pm:groom (promote oldest ideas)"
elif [ "$in_progress" -gt 0 ]; then
  # Find the oldest in-progress issue title
  oldest_title=""
  oldest_epoch=999999999999
  for f in "$PM_DIR"/backlog/*.md; do
    [ -f "$f" ] || continue
    status=$(fm_value "$f" "status")
    [ "$status" = "in-progress" ] || [ "$status" = "approved" ] || continue
    updated=$(fm_value "$f" "updated")
    epoch=$(date_to_epoch "$updated")
    if [ "$epoch" -lt "$oldest_epoch" ] 2>/dev/null; then
      oldest_epoch="$epoch"
      oldest_title=$(fm_value "$f" "title")
    fi
  done
  if [ -n "$oldest_title" ]; then
    echo "  Next: /pm:dev (continue ${oldest_title})"
  else
    echo "  Next: /pm:dev"
  fi
else
  echo "  Next: /pm:groom ideate"
fi

exit 0
