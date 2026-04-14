#!/usr/bin/env bash
# PreToolUse hook — captures Agent dispatch start timestamps for duration tracking.
# Writes an ISO timestamp to .pm/analytics/.agent-starts/<hash> so the PostToolUse
# hook (agent-step.sh) can compute real duration_ms.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Check analytics flag — bail fast if disabled
ANALYTICS=$(sed -n 's/^analytics: *//p' "$PROJECT_DIR/.claude/pm.local.md" 2>/dev/null | head -1)
[ "$ANALYTICS" != "true" ] && exit 0

# Read PreToolUse JSON from stdin
INPUT=$(cat)

# Extract agent name for keying the timestamp file
AGENT_NAME=$(printf '%s' "$INPUT" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const ti = d.tool_input || {};
process.stdout.write(ti.name || ti.description || 'unnamed');
" 2>/dev/null) || exit 0

[ -z "$AGENT_NAME" ] && exit 0

# Write start timestamp keyed by a hash of the agent name
STARTS_DIR="$PROJECT_DIR/.pm/analytics/.agent-starts"
mkdir -p "$STARTS_DIR"
HASH=$(printf '%s' "$AGENT_NAME" | shasum -a 256 | cut -c1-16)
date -u +%Y-%m-%dT%H:%M:%S.000Z > "$STARTS_DIR/$HASH"
