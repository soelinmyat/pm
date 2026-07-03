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
#   {"state":"done","result":{...}}  result.json is exactly one valid JSON doc
#   {"state":"crashed"}              dispatcher gone with no result, never
#                                    started, or the result is unparseable
#   {"state":"running"}              ceiling elapsed, subprocess still alive
#
# `running` means "re-invoke me" — the heartbeat. A long subprocess produces a
# handful of `running` returns before terminating in `done` or `crashed`.
#
# Failure modes this guards against (all covered by the test suite):
#   * empty / partial / multi-document result.json → fail closed as crashed,
#     with a single re-parse after a short delay so a genuine mid-write that
#     completes in a moment resolves to done instead of halting the epic
#   * dispatcher never started (bad args, CLI missing → exits before writing
#     the pid file): missing pid file after a full ceiling → crashed
#   * SIGKILL bypassing the dispatcher's EXIT trap: dead pid + no result → crashed
#   * a recycled PID handed to an unrelated process: identity-check the live
#     process against the dispatcher marker before trusting kill -0
#
# The pid/result contract is owned by dispatch-issue.sh; this script only reads
# it. It never writes result.json and never touches the EXIT trap.

set -euo pipefail

usage() {
  cat <<EOF >&2
Usage: $0 --result-file <path> [--pid-file <path>] [--timeout <s>] [--interval <s>] [--reparse-delay <s>] [--json-tool <auto|jq|node>]

Required:
  --result-file   path dispatch-issue.sh was told to write the result JSON to

Optional:
  --pid-file      dispatcher PID file (default: <result-file dir>/dispatch.pid)
  --timeout       hard per-invocation ceiling in seconds (default: 900)
  --interval      poll interval in seconds (default: 30)
  --reparse-delay seconds to wait before the single mid-write re-parse (default: 2)
  --json-tool     result-JSON validator: auto | jq | node (default: auto)

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
REPARSE_DELAY=2
JSON_TOOL=auto

# The pid file records dispatch-issue.sh's own PID. Before trusting `kill -0`,
# confirm the live process is still that script — a bare liveness check would be
# fooled by a recycled PID the OS handed to an unrelated program.
DISPATCHER_MARKER="dispatch-issue"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --result-file)   RESULT_FILE="$2"; shift 2 ;;
    --pid-file)      PID_FILE="$2"; shift 2 ;;
    --timeout)       TIMEOUT="$2"; shift 2 ;;
    --interval)      INTERVAL="$2"; shift 2 ;;
    --reparse-delay) REPARSE_DELAY="$2"; shift 2 ;;
    --json-tool)     JSON_TOOL="$2"; shift 2 ;;
    -h|--help)       usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -z "$RESULT_FILE" ]] && usage
[[ -n "$TIMEOUT"       ]] || TIMEOUT=900
[[ -n "$INTERVAL"      ]] || INTERVAL=30
[[ -n "$REPARSE_DELAY" ]] || REPARSE_DELAY=2
[[ -n "$JSON_TOOL"     ]] || JSON_TOOL=auto
# Default the PID file to the dispatcher's convention: beside result.json.
[[ -n "$PID_FILE" ]] || PID_FILE="$(dirname "$RESULT_FILE")/dispatch.pid"

# Classify the dispatcher's liveness → missing | unknown | alive | dead
#   missing  no pid file yet (not started, or already cleaned up)
#   unknown  pid file present but empty/partial (transient write) — indeterminate
#   alive    pid live AND still our dispatcher
#   dead     pid gone, OR live but recycled to an unrelated process
pid_status() {
  [[ -f "$PID_FILE" ]] || { printf 'missing'; return; }
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  pid="${pid//[[:space:]]/}"
  [[ -n "$pid" ]] || { printf 'unknown'; return; }
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'dead'
    return
  fi
  # Process exists — is it still our dispatcher, or a recycled PID?
  if ps -p "$pid" -o command= 2>/dev/null | grep -q "$DISPATCHER_MARKER"; then
    printf 'alive'
  else
    printf 'dead'
  fi
}

# Compact + validate result JSON. Prints the compacted single JSON document and
# exits 0 ONLY when the file is exactly one well-formed JSON value; prints
# nothing and exits non-zero otherwise (empty, partial, multiple docs, garbage)
# so the caller fails closed. Prefer jq; fall back to node (the plugin's
# guaranteed runtime). --json-tool forces one for testing / flaky-jq environments.
json_compact() {
  local file="$1" tool="$JSON_TOOL"
  if [[ "$tool" == auto ]]; then
    if command -v jq >/dev/null 2>&1; then
      tool=jq
    elif command -v node >/dev/null 2>&1; then
      tool=node
    else
      echo "dispatch-wait: need jq or node to validate result JSON" >&2
      return 2
    fi
  fi
  case "$tool" in
    # -s slurps every document into an array; requiring length == 1 rejects
    # empty (length 0) and multi-doc (length >= 2); -e exits non-zero on the
    # resulting `empty`. So empty/partial/multi all fail closed.
    jq) jq -ces 'if length == 1 then .[0] else empty end' "$file" 2>/dev/null ;;
    node)
      node -e 'const fs=require("fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(d));}catch(e){process.exit(1);}' "$file"
      ;;
    *)
      echo "dispatch-wait: unknown --json-tool '$tool' (expected auto|jq|node)" >&2
      return 2
      ;;
  esac
}

# Parse once. Echo the compacted single-line JSON on success (exit 0), nothing on
# failure (exit 1). The non-empty + single-line belt keeps a validator that ever
# emits blank or multi-line output from splicing garbage into the envelope.
try_parse() {
  local compact
  compact="$(json_compact "$1")" || return 1
  [[ -n "$compact" ]] || return 1
  [[ "$compact" != *$'\n'* ]] || return 1
  printf '%s' "$compact"
}

end=$(( $(date +%s) + TIMEOUT ))
until [[ -f "$RESULT_FILE" ]] || [[ "$(pid_status)" == dead ]] || [[ "$(date +%s)" -ge "$end" ]]; do
  sleep "$INTERVAL"
done

if [[ -f "$RESULT_FILE" ]]; then
  if compact="$(try_parse "$RESULT_FILE")"; then
    printf '{"state":"done","result":%s}\n' "$compact"
  else
    # A result caught mid-write parses as garbage now but may complete in a
    # moment. Wait once, re-parse, and only then fail closed — a mid-write that
    # completes must not halt the epic.
    sleep "$REPARSE_DELAY"
    if compact="$(try_parse "$RESULT_FILE")"; then
      printf '{"state":"done","result":%s}\n' "$compact"
    else
      printf '{"state":"crashed"}\n'
    fi
  fi
else
  case "$(pid_status)" in
    dead)    printf '{"state":"crashed"}\n' ;; # SIGKILL/trap-bypass or recycled PID
    missing) printf '{"state":"crashed"}\n' ;; # dispatcher never started (bad args, CLI missing)
    *)       printf '{"state":"running"}\n' ;; # alive, or indeterminate (empty pid) — keep waiting
  esac
fi
