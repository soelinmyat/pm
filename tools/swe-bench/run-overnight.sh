#!/bin/bash
# Overnight SWE-bench run: PM plugin, all 300 tasks
#
# Uses your Claude Code subscription (no API cost)
# Resume-safe: re-run this script to continue from where it stopped
#
# Usage:
#   ./run-overnight.sh           # Run PM on all 300 tasks
#   ./run-overnight.sh --status  # Check progress without running

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "Setting up virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -q -r requirements.txt
else
  source venv/bin/activate
fi

# Status check
if [ "${1:-}" = "--status" ]; then
  echo "=== Progress ==="
  for config in pm; do
    if [ -f "results/${config}/predictions.jsonl" ]; then
      total=$(wc -l < "results/${config}/predictions.jsonl" | tr -d ' ')
      patches=$(python3 -c "
import json
count = 0
with open('results/${config}/predictions.jsonl') as f:
    for line in f:
        if json.loads(line).get('model_patch','').strip(): count += 1
print(count)
")
      echo "  ${config}: ${total}/300 tasks done, ${patches} with patches"
    else
      echo "  ${config}: not started"
    fi
  done
  exit 0
fi

echo "============================================"
echo " SWE-bench Lite — PM Plugin (300 tasks)"
echo "============================================"
echo ""
echo " Auth:     Subscription (no API cost)"
echo " Model:    Sonnet"
echo " Budget:   \$3.00/task (rate limit only)"
echo " Timeout:  10 min/task"
echo " Resume:   yes (skips completed tasks)"
echo " Est time: ~15-20 hours"
echo ""
echo " Progress: ./run-overnight.sh --status"
echo " Logs:     results/pm/predictions.jsonl"
echo ""
echo " Starting in 5 seconds... (Ctrl+C to cancel)"
sleep 5

python generate.py \
  --configs pm \
  --budget 3.00 \
  --timeout 600 \
  --resume

echo ""
echo "============================================"
echo " Generation complete!"
echo "============================================"

./run-overnight.sh --status

echo ""
echo "Next: evaluate results"
echo "  Local:  python evaluate.py --configs pm"
echo "  Cloud:  SWEBENCH_API_KEY=\$SWEBENCH_API_KEY sb-cli submit swe-bench_lite test --predictions_path results/pm/predictions.jsonl --run_id pm-full"
