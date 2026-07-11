#!/usr/bin/env bash
# Compatibility shim for the v2 Node runtime adapter.
#
# This interface remains callable by legacy prompts for one release. Provider
# policy, model selection, structured output, and safe permissions live under
# scripts/dev-runtime/ rather than in shell-interpolated command strings.
#
# Prompt placeholders ${PM_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_ROOT}, and
# ${RESULT_FILE} are resolved to absolute paths here before dispatch — the
# subprocess cannot resolve them itself (no env var; the Read tool does not
# expand variables).

set -euo pipefail

usage() {
  cat <<EOF >&2
Usage: $0 --runtime <claude|codex> --worktree <path> --prompt-file <path> --result-file <path> [--log-file <path>]

Required:
  --runtime      claude | codex
  --worktree     directory the subprocess runs inside
  --prompt-file  file containing the full agent prompt (read from stdin by the runtime)
  --result-file  path the agent must write its structured result JSON to

Optional:
  --log-file     full subprocess stdout+stderr (default: <result-file>.log)

Exit codes:
  0  subprocess exited cleanly AND wrote a result file (orchestrator parses for merged/blocked)
  1  bad arguments
  2  missing inputs (prompt file or worktree)
  3  runtime CLI not found in PATH
  4  subprocess returned but did not write the result file
EOF
  exit 1
}

RUNTIME=""
WORKTREE=""
PROMPT_FILE=""
RESULT_FILE=""
LOG_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime)     RUNTIME="$2"; shift 2 ;;
    --worktree)    WORKTREE="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --result-file) RESULT_FILE="$2"; shift 2 ;;
    --log-file)    LOG_FILE="$2"; shift 2 ;;
    -h|--help)     usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -z "$RUNTIME" || -z "$WORKTREE" || -z "$PROMPT_FILE" || -z "$RESULT_FILE" ]] && usage
[[ -f "$PROMPT_FILE" ]] || { echo "prompt file not found: $PROMPT_FILE" >&2; exit 2; }
[[ -d "$WORKTREE"   ]] || { echo "worktree not found: $WORKTREE"   >&2; exit 2; }

# Derive the plugin root from this script's own location. A spawned subprocess
# has no plugin-root env var; export the runtime-neutral PM_PLUGIN_ROOT plus
# the legacy CLAUDE_PLUGIN_ROOT alias so plugin-relative shell paths resolve,
# and use both for prompt substitution below.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PM_PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_PLUGIN_ROOT="$PM_PLUGIN_ROOT"
export PM_PLUGIN_ROOT CLAUDE_PLUGIN_ROOT

LOG_FILE="${LOG_FILE:-${RESULT_FILE%.json}.log}"
mkdir -p "$(dirname "$RESULT_FILE")" "$(dirname "$LOG_FILE")"

# Resolve to absolute paths. The subprocess runs with its cwd inside the
# worktree, so a relative result/log path would resolve there — not here —
# and the agent would write result.json where the orchestrator never looks.
RESULT_FILE="$(cd "$(dirname "$RESULT_FILE")" && pwd)/$(basename "$RESULT_FILE")"
LOG_FILE="$(cd "$(dirname "$LOG_FILE")" && pwd)/$(basename "$LOG_FILE")"
WORKTREE="$(cd "$WORKTREE" && pwd)"

# Remove stale result so we can detect whether THIS run wrote one
rm -f "$RESULT_FILE"

# PID file for orchestrator liveness checks. The orchestrator's wait loop ORs
# `kill -0 $(cat dispatch.pid)` with result-file existence, so a dispatcher
# crash (or SIGKILL) breaks the loop instead of hanging it forever.
PID_FILE="$(dirname "$RESULT_FILE")/dispatch.pid"
printf '%s\n' "$$" > "$PID_FILE"

# Crash-safe result contract: orchestrator waits for [ -f result.json ]. If
# the subprocess exits without writing one (crashed, killed, OOM, etc.), this
# trap leaves a stub blocked result so the wait terminates and the
# orchestrator can surface the failure. SIGKILL bypasses traps — the PID
# liveness check above is the safety net for that case.
RESOLVED_PROMPT=""
cleanup() {
  if [[ ! -f "$RESULT_FILE" ]]; then
    cat > "$RESULT_FILE" <<EOF
{
  "status": "blocked",
  "reason": "subprocess exited without writing result file (dispatcher trap fired)",
  "log_file": "$LOG_FILE"
}
EOF
  fi
  [[ -n "$RESOLVED_PROMPT" ]] && rm -f "$RESOLVED_PROMPT"
  rm -f "$PID_FILE"
}
trap cleanup EXIT

# Resolve prompt placeholders the subprocess cannot resolve itself, then feed
# the rewritten prompt (not the original) to the runtime:
#   ${PM_PLUGIN_ROOT}     -> absolute plugin root, so reference files are readable
#   ${CLAUDE_PLUGIN_ROOT} -> same absolute plugin root, for legacy prompts
#   ${RESULT_FILE}        -> absolute result path, so the agent writes where we check
RESOLVED_PROMPT="$(mktemp)"
prompt_body="$(cat "$PROMPT_FILE")"
# shellcheck disable=SC2016 # Single quotes are intentional: we want the LITERAL
# string "${PM_PLUGIN_ROOT}" as the search pattern in ${var//pat/replacement},
# not its expansion. The replacement (right of the slash) is the expanded value.
prompt_body="${prompt_body//'${PM_PLUGIN_ROOT}'/$PM_PLUGIN_ROOT}"
# shellcheck disable=SC2016 # Single quotes are intentional: we want the LITERAL
# string "${CLAUDE_PLUGIN_ROOT}" as the search pattern in ${var//pat/replacement},
# not its expansion. The replacement (right of the slash) is the expanded value.
prompt_body="${prompt_body//'${CLAUDE_PLUGIN_ROOT}'/$PM_PLUGIN_ROOT}"
# shellcheck disable=SC2016
prompt_body="${prompt_body//'${RESULT_FILE}'/$RESULT_FILE}"
printf '%s\n' "$prompt_body" > "$RESOLVED_PROMPT"

case "$RUNTIME" in
  claude|codex) ;;

  *)
    echo "Unknown runtime: $RUNTIME (expected: claude | codex)" >&2
    exit 1
    ;;
esac

echo "warning: dispatch-issue.sh is a compatibility shim; use scripts/dev-runtime directly" >&2

# Preserve the old sandbox variable as an opt-in alias. Broad access still
# requires PM_DEV_ALLOW_BROAD_PERMISSIONS=1 and is never the default.
if [[ -n "${PM_CODEX_SANDBOX:-}" && -z "${PM_DEV_CODEX_SANDBOX:-}" ]]; then
  export PM_DEV_CODEX_SANDBOX="$PM_CODEX_SANDBOX"
fi

set +e
node "$SCRIPT_DIR/dev-runtime/dispatch.js" \
  --runtime "$RUNTIME" \
  --worktree "$WORKTREE" \
  --prompt-file "$RESOLVED_PROMPT" \
  --result-file "$RESULT_FILE" \
  --log-file "$LOG_FILE"
ADAPTER_STATUS=$?
set -e

if [[ "$ADAPTER_STATUS" -eq 3 ]]; then
  exit 3
fi

if [[ ! -f "$RESULT_FILE" ]]; then
  echo "Agent exited without writing result file: $RESULT_FILE" >&2
  echo "See log: $LOG_FILE" >&2
  exit 4
fi

cat "$RESULT_FILE"
