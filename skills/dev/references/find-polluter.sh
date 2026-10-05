#!/usr/bin/env bash
# Sequential test isolation; this is not a bisection algorithm.
# Usage: ./find-polluter.sh <file_or_dir> <find_path_pattern> -- <runner> [args...]
# Example: ./find-polluter.sh 'unwanted' 'tests/*.test.js' -- node --test
# Exit: 0 = no pollution observed; 1 = pollution observed; 2 = inconclusive.
set -eu

if [ "$#" -lt 4 ] || [ "$3" != "--" ]; then
  echo "Usage: $0 <file_or_dir> <find_path_pattern> -- <runner> [args...]"
  echo "Use the repository's single-file runner; the selected path is appended as one argument."
  exit 2
fi
POLLUTION_CHECK="$1"
TEST_PATTERN="$2"
shift 3
# Name/skip filters can return zero after executing no selected cases. Do not
# call that a clean isolation run. Opaque wrapper configuration remains a limit.
for RUNNER_ARG in "$@"; do
  case "$RUNNER_ARG" in
    --test-name-pattern*|--test-skip-pattern*|--grep*|--exclude*|--testNamePattern*|-t|-g)
      echo "INCONCLUSIVE: filtered runners do not establish case execution: $RUNNER_ARG"
      exit 2 ;;
  esac
done
case "$TEST_PATTERN" in
  ./*) ;;
  /*) echo "Test pattern must be relative to the current directory"; exit 2 ;;
  *) TEST_PATTERN="./$TEST_PATTERN" ;;
esac

pollution_exists() { [ -e "$POLLUTION_CHECK" ] || [ -L "$POLLUTION_CHECK" ]; }
if pollution_exists; then
  echo "INCONCLUSIVE: pollution already exists before isolation: $POLLUTION_CHECK"
  exit 2
fi

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
if ! find . -type f -path "$TEST_PATTERN" -print0 > "$SCRATCH/files"; then
  echo "INCONCLUSIVE: test discovery failed"
  exit 2
fi
TEST_FILES=()
while IFS= read -r -d '' TEST_FILE; do
  TEST_FILES+=("$TEST_FILE")
done < "$SCRATCH/files"
TOTAL=${#TEST_FILES[@]}
if [ "$TOTAL" -eq 0 ]; then
  echo "INCONCLUSIVE: No matching test files: $TEST_PATTERN"
  exit 2
fi

COUNT=0
for TEST_FILE in "${TEST_FILES[@]}"; do
  COUNT=$((COUNT + 1))
  if pollution_exists; then
    echo "INCONCLUSIVE: pollution appeared before test execution: $TEST_FILE"
    exit 2
  fi
  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"
  STATUS=0
  "$@" "$TEST_FILE" > "$SCRATCH/output" 2>&1 || STATUS=$?
  if pollution_exists; then
    echo "FOUND POLLUTER: $TEST_FILE created $POLLUTION_CHECK (runner exit $STATUS)"
    cat "$SCRATCH/output"
    echo "Reproduce with the same runner and inspect the test before assigning root cause."
    exit 1
  fi
  if [ "$STATUS" -ne 0 ]; then
    echo "INCONCLUSIVE: runner failed for $TEST_FILE (exit $STATUS)"
    cat "$SCRATCH/output"
    exit 2
  fi
done

echo "No pollution observed after $COUNT successful single-file runner invocations."
echo "Exit zero proves runner completion, not that every case ran; verify the runner has no hidden filters or skipped suites."
echo "This excludes only the supplied path under isolated execution; order-dependent pollution remains untested."
exit 0
