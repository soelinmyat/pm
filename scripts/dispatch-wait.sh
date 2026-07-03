#!/usr/bin/env bash
# Crash-safe wait for a dispatched issue subprocess.
#
# Companion to dispatch-issue.sh. That script spawns a top-level agent
# subprocess and, via its pid/result contract, leaves two files next to each
# other:
#   result.json   — the agent's structured result (or the EXIT-trap stub)
#   dispatch.pid  — the dispatcher's PID, for SIGKILL liveness checks
#
# This script runs the wait loop that used to live as hand-copied prose in
# 05-implementation.md and agent-runtime.md: an until-loop that polls the
# result file and the dispatcher's liveness, bounded by a hard per-invocation
# ceiling, and prints EXACTLY ONE JSON line the orchestrator branches on:
#
#   {"state":"done","result":{...}}  result.json exists and parses
#   {"state":"crashed"}              pid dead with no result, OR malformed result
#   {"state":"running"}              ceiling elapsed, subprocess still alive
#
# `running` means "re-invoke me" — the heartbeat. A long subprocess produces a
# handful of `running` returns before terminating in `done` or `crashed`.
#
# The pid/result contract is owned by dispatch-issue.sh; this script only reads
# it. It never writes result.json and never touches the EXIT trap.

set -euo pipefail

usage() {
  cat <<EOF >&2
Usage: $0 --result-file <path> [--pid-file <path>] [--timeout <seconds>] [--interval <seconds>]

Required:
  --result-file  path dispatch-issue.sh was told to write the result JSON to

Optional:
  --pid-file     dispatcher PID file (default: <result-file dir>/dispatch.pid)
  --timeout      hard per-invocation ceiling in seconds (default: 900)
  --interval     poll interval in seconds (default: 30)

Prints exactly one JSON line to stdout:
  {"state":"done","result":{...}} | {"state":"crashed"} | {"state":"running"}

Exit codes:
  0  a state was classified and printed (done | crashed | running)
  1  bad arguments
EOF
  exit 1
}

RESULT_FILE=""
PID_FILE=""
TIMEOUT=900
INTERVAL=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --result-file) RESULT_FILE="$2"; shift 2 ;;
    --pid-file)    PID_FILE="$2"; shift 2 ;;
    --timeout)     TIMEOUT="$2"; shift 2 ;;
    --interval)    INTERVAL="$2"; shift 2 ;;
    -h|--help)     usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -z "$RESULT_FILE" ]] && usage
[[ -n "$TIMEOUT"  ]] || TIMEOUT=900
[[ -n "$INTERVAL" ]] || INTERVAL=30
# Default the PID file to the dispatcher's convention: beside result.json.
[[ -n "$PID_FILE" ]] || PID_FILE="$(dirname "$RESULT_FILE")/dispatch.pid"

# The dispatcher wrote dispatch.pid before backgrounding, so a MISSING pid file
# means "not started yet", not "dead" — treat that as still-alive and keep
# waiting. Only a present pid file whose process is gone counts as dead. SIGKILL
# bypasses the dispatcher's EXIT trap, so "dead pid + no result" is the crash
# signature this guards against.
pid_dead() {
  [[ -f "$PID_FILE" ]] && ! kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

# Compact + validate result JSON. Exit non-zero (and print nothing) if the file
# is not well-formed JSON, so the caller can fail closed. Prefer jq; fall back
# to node (the plugin's guaranteed runtime) when jq is absent.
json_compact() {
  if command -v jq >/dev/null 2>&1; then
    jq -c . "$1" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs");try{process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))));}catch(e){process.exit(1);}' "$1"
  else
    echo "dispatch-wait: need jq or node to validate result JSON" >&2
    return 2
  fi
}

end=$(( $(date +%s) + TIMEOUT ))
until [[ -f "$RESULT_FILE" ]] || pid_dead || [[ "$(date +%s)" -ge "$end" ]]; do
  sleep "$INTERVAL"
done

if [[ -f "$RESULT_FILE" ]]; then
  # Result present: done if it parses, crashed (fail closed) if it is garbage.
  if compact="$(json_compact "$RESULT_FILE")"; then
    printf '{"state":"done","result":%s}\n' "$compact"
  else
    printf '{"state":"crashed"}\n'
  fi
elif pid_dead; then
  # Dispatcher gone, no result, no EXIT-trap stub: SIGKILL bypassed the trap.
  printf '{"state":"crashed"}\n'
else
  # Ceiling elapsed with the subprocess still alive: re-invoke to keep waiting.
  printf '{"state":"running"}\n'
fi
