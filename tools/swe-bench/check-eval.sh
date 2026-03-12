#!/bin/bash
# Quick check on evaluation progress
# Usage: ./check-eval.sh

LOG="results/pm/logs/eval.log"

if [ ! -f "$LOG" ]; then
  echo "No eval log found. Is the evaluation running?"
  exit 1
fi

# Show latest progress line
echo "=== Progress ==="
grep -o 'Evaluation:.*' "$LOG" | tail -1

# Show if process is still running
if pgrep -f "run_evaluation.*--run_id pm" > /dev/null; then
  echo "Status: RUNNING (PID $(pgrep -f 'run_evaluation.*--run_id pm'))"
else
  echo "Status: FINISHED"
  # Show final report if available
  if ls results/pm/logs/pm.*.json 2>/dev/null | head -1 > /dev/null; then
    echo ""
    echo "=== Results ==="
    python3 -c "
import json, glob
files = glob.glob('results/pm/logs/pm.*.json')
if files:
    with open(sorted(files)[-1]) as f:
        report = json.load(f)
    resolved = report.get('resolved_ids', report.get('resolved', []))
    total = report.get('total_instances', 300)
    print(f'Resolved: {len(resolved)}/{total} ({len(resolved)/total*100:.1f}%)')
"
  fi
fi
