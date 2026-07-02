#!/usr/bin/env bash
# shellcheck shell=bash

__PM_EVAL_PHASE=""
__PM_EVAL_NONCE=""
__PM_EVAL_FRAME_PREFIX="::pm-eval-check::"

__pm_eval_init() {
  __PM_EVAL_PHASE="$1"
  __PM_EVAL_NONCE="$2"
  export -n PM_EVAL_CHECK_NONCE PM_EVAL_CHECK_FRAME_PREFIX PM_EVAL_PHASE 2>/dev/null || true
}

__pm_eval_emit() {
  local helper="$1"
  local status="$2"
  local reason="${3:-}"
  local payload

  payload="$(
    node -e '
      const [phase, helper, status, reason] = process.argv.slice(1);
      const record = { phase, helper, status };
      if (reason) record.reason = reason;
      process.stdout.write(Buffer.from(JSON.stringify(record), "utf8").toString("base64url"));
    ' "$__PM_EVAL_PHASE" "$helper" "$status" "$reason"
  )"

  printf '%s%s::%s\n' "$__PM_EVAL_FRAME_PREFIX" "$__PM_EVAL_NONCE" "$payload"
}

__pm_eval_escape_output() {
  awk -v prefix="$__PM_EVAL_FRAME_PREFIX" 'index($0, prefix) == 1 { print "\\" $0; next } { print }'
}

file-exists() {
  local target="$1"
  if [ -e "$target" ]; then
    __pm_eval_emit "file-exists" "pass"
  else
    __pm_eval_emit "file-exists" "fail" "missing file: $target"
  fi
  return 0
}

file-contains() {
  local target="$1"
  local needle="$2"
  if [ ! -f "$target" ]; then
    __pm_eval_emit "file-contains" "fail" "missing file: $target"
  elif grep -Fq -- "$needle" "$target"; then
    __pm_eval_emit "file-contains" "pass"
  else
    __pm_eval_emit "file-contains" "fail" "missing text in $target"
  fi
  return 0
}

artifact-exists() {
  local name="$1"
  local artifacts_dir="${PM_EVAL_ARTIFACTS_DIR:-../artifacts}"
  local target="$artifacts_dir/$name"

  if [ -f "$target" ]; then
    __pm_eval_emit "artifact-exists" "pass"
  else
    __pm_eval_emit "artifact-exists" "fail" "missing artifact: $name"
  fi
  return 0
}

artifact-contains() {
  local name="$1"
  local needle="$2"
  local artifacts_dir="${PM_EVAL_ARTIFACTS_DIR:-../artifacts}"
  local target="$artifacts_dir/$name"

  if [ ! -f "$target" ]; then
    __pm_eval_emit "artifact-contains" "fail" "missing artifact: $name"
  elif grep -Fq -- "$needle" "$target"; then
    __pm_eval_emit "artifact-contains" "pass"
  else
    __pm_eval_emit "artifact-contains" "fail" "missing text in artifact: $name"
  fi
  return 0
}

command-succeeds() {
  local command="$1"
  local output

  if output="$(env -u PM_EVAL_CHECK_NONCE -u PM_EVAL_CHECK_FRAME_PREFIX -u PM_EVAL_PHASE bash -c "$command" 2>&1)"; then
    printf '%s\n' "$output" | __pm_eval_escape_output
    __pm_eval_emit "command-succeeds" "pass"
  else
    local status=$?
    printf '%s\n' "$output" | __pm_eval_escape_output
    __pm_eval_emit "command-succeeds" "fail" "command failed: exit $status"
  fi
  return 0
}

command-fails() {
  local command="$1"
  local output

  if output="$(env -u PM_EVAL_CHECK_NONCE -u PM_EVAL_CHECK_FRAME_PREFIX -u PM_EVAL_PHASE bash -c "$command" 2>&1)"; then
    printf '%s\n' "$output" | __pm_eval_escape_output
    __pm_eval_emit "command-fails" "fail" "command unexpectedly passed"
  else
    printf '%s\n' "$output" | __pm_eval_escape_output
    __pm_eval_emit "command-fails" "pass"
  fi
  return 0
}

git-branch() {
  local expected="$1"
  local actual

  if actual="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" && [ "$actual" = "$expected" ]; then
    __pm_eval_emit "git-branch" "pass"
  else
    __pm_eval_emit "git-branch" "fail" "expected branch: $expected"
  fi
  return 0
}

check-transcript() {
  local command="$1"
  shift

  local transcript="${PM_EVAL_TRANSCRIPT:-../metadata/transcript.normalized.jsonl}"
  local module="${PM_EVAL_TRANSCRIPT_MODULE:-../runtime/pm/scripts/evals/transcript.js}"

  if [ ! -f "$transcript" ]; then
    __pm_eval_emit "check-transcript" "indeterminate" "empty-transcript"
    return 0
  fi

  local result
  if ! result="$(
    node - "$module" "$transcript" "$command" "$@" <<'NODE'
const fs = require("node:fs");

const [modulePath, transcriptPath, command, ...args] = process.argv.slice(2);
const { parseJsonl, checkTranscript } = require(modulePath);
const parsed = parseJsonl(fs.readFileSync(transcriptPath, "utf8"));
const checked =
  parsed.status === "pass"
    ? checkTranscript(parsed.events, command, ...args)
    : { status: "indeterminate", reason: parsed.reason };

process.stdout.write(`${checked.status}\t${checked.reason || ""}`);
NODE
  )"; then
    __pm_eval_emit "check-transcript" "indeterminate" "transcript-check-error"
    return 0
  fi

  local status="${result%%$'\t'*}"
  local reason="${result#*$'\t'}"
  if [ "$reason" = "$status" ]; then
    reason=""
  fi
  __pm_eval_emit "check-transcript" "$status" "$reason"
  return 0
}
