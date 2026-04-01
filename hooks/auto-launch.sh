#!/usr/bin/env bash
# Auto-launch the PM dashboard server on session start.
# Prints the dashboard URL if a server is running or successfully started.
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

# Check if server already running on stable port
PORT=$("$PLUGIN_ROOT/scripts/find-dashboard-port.sh" "$PROJECT_DIR" 2>/dev/null)
if [ -n "$PORT" ]; then
  echo "Dashboard: http://localhost:${PORT}"
  exit 0
fi

# Start server in background
OUTPUT=$(bash "$PLUGIN_ROOT/scripts/start-server.sh" --project-dir "$PROJECT_DIR" --mode dashboard 2>/dev/null)
if [ -z "$OUTPUT" ]; then
  exit 0
fi

URL=$(echo "$OUTPUT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try { const u = JSON.parse(d).url; if(u) console.log(u); }
    catch(e) {}
  });" 2>/dev/null)

[ -n "$URL" ] && echo "Dashboard: ${URL}"
exit 0
