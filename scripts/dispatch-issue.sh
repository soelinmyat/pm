#!/usr/bin/env bash
# Subprocess dispatch for full-lifecycle issue execution.
#
# Spawns a top-level agent subprocess (claude -p or codex exec) to execute
# one issue end-to-end (implement → simplify → review → ship → merge).
# The subprocess is a top-level run with no parent, so it has no implicit
# "return to orchestrator" pressure that causes early bailing on long phases
# like CI watches and review-comment loops.
#
# The dispatched agent MUST write a structured result JSON file before
# exiting. The orchestrator reads that file after the subprocess returns
# to determine success/blocked and advance the plan.

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

LOG_FILE="${LOG_FILE:-${RESULT_FILE%.json}.log}"
mkdir -p "$(dirname "$RESULT_FILE")" "$(dirname "$LOG_FILE")"

# Remove stale result so we can detect whether THIS run wrote one
rm -f "$RESULT_FILE"

case "$RUNTIME" in
  claude)
    command -v claude >/dev/null 2>&1 || { echo "claude CLI not in PATH" >&2; exit 3; }
    (
      cd "$WORKTREE"
      claude -p \
        --dangerously-skip-permissions \
        < "$PROMPT_FILE"
    ) > "$LOG_FILE" 2>&1
    ;;

  codex)
    command -v codex >/dev/null 2>&1 || { echo "codex CLI not in PATH" >&2; exit 3; }
    codex exec \
      --full-auto \
      -C "$WORKTREE" \
      -o "${LOG_FILE%.log}.last-message.txt" \
      - \
      < "$PROMPT_FILE" \
      > "$LOG_FILE" 2>&1
    ;;

  *)
    echo "Unknown runtime: $RUNTIME (expected: claude | codex)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$RESULT_FILE" ]]; then
  echo "Agent exited without writing result file: $RESULT_FILE" >&2
  echo "See log: $LOG_FILE" >&2
  exit 4
fi

cat "$RESULT_FILE"
