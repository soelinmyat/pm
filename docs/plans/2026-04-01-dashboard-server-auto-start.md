# Plan: PM-098 — Auto-launch dashboard server on session start

## Summary

Add `hooks/auto-launch.sh` to the SessionStart hook chain. It checks if a dashboard server is already running (via `find-dashboard-port.sh`), starts one if not (via `start-server.sh`), and prints a single line with the URL.

## Tasks

### Task 1: Create hooks/auto-launch.sh

New file `hooks/auto-launch.sh` (~35 lines):

```bash
#!/usr/bin/env bash
# Auto-launch dashboard server on session start

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Check opt-out preference
if [ -f "$PROJECT_DIR/.pm/config.json" ]; then
  AUTO_LAUNCH=$(node -e "
    try { const c = require('$PROJECT_DIR/.pm/config.json');
    console.log(c.preferences?.auto_launch ?? 'true'); }
    catch { console.log('true'); }" 2>/dev/null)
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
URL=$(echo "$OUTPUT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{try{console.log(JSON.parse(d).url)}catch{}})" 2>/dev/null)

[ -n "$URL" ] && echo "Dashboard: ${URL}"
exit 0
```

Key points:
- Always exits 0 (never blocks session)
- Checks `find-dashboard-port.sh` first (idempotent)
- Reads `.pm/config.json` → `preferences.auto_launch` for opt-out
- Prints exactly 1 line: `Dashboard: {url}`

### Task 2: Register in hooks/hooks.json

Add `auto-launch.sh` to SessionStart chain after `session-start`, as `async: true`:

```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/auto-launch.sh",
  "async": true
}
```

Position: after `session-start` (skill injection), before `reconcile-merged.sh`.

### Task 3: Test

- Run `node --test tests/server.test.js` to verify no regressions
- Manual test: start a session, verify dashboard URL appears in greeting

## Files Changed

| File | Change |
|------|--------|
| `hooks/auto-launch.sh` | New file |
| `hooks/hooks.json` | Add auto-launch.sh to SessionStart chain |

## Risks

- `start-server.sh` kills existing servers on the port — safe because `find-dashboard-port.sh` check comes first
- Node dependency for JSON parsing — already required by all other hooks
