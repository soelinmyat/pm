#!/usr/bin/env bash
# PM activity logger — appends structured JSONL to .pm/analytics/activity.jsonl
# Usage: pm-log.sh <skill> <event> [detail]
# Example: pm-log.sh dev started "size=M"
# Example: pm-log.sh groom design_review_passed "score=B+"
#
# Requires PM_ANALYTICS=1 to be set (checked by caller).
# This script does NOT check the flag — the caller is responsible.

set -euo pipefail

SKILL="${1:-unknown}"
EVENT="${2:-unknown}"
DETAIL="${3:-}"

# Determine project root (git root or cwd)
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PROJECT_NAME=$(basename "$PROJECT_ROOT")
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Log to project-level .pm/analytics/
LOG_DIR="${PROJECT_ROOT}/.pm/analytics"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/activity.jsonl"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Build JSON — use printf for portability (no jq dependency)
if [ -n "$DETAIL" ]; then
  printf '{"skill":"%s","event":"%s","ts":"%s","project":"%s","branch":"%s","detail":"%s"}\n' \
    "$SKILL" "$EVENT" "$TS" "$PROJECT_NAME" "$BRANCH" "$DETAIL" >> "$LOG_FILE"
else
  printf '{"skill":"%s","event":"%s","ts":"%s","project":"%s","branch":"%s"}\n' \
    "$SKILL" "$EVENT" "$TS" "$PROJECT_NAME" "$BRANCH" >> "$LOG_FILE"
fi
