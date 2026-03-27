#!/bin/bash
# Quick-start script for SWE-bench comparison
#
# Usage:
#   ./run.sh                    # Full run: all 4 configs, all 300 tasks
#   ./run.sh --quick            # Quick test: 5 tasks, vanilla + pm only
#   ./run.sh --generate-only    # Generate patches without evaluating
#   ./run.sh --evaluate-only    # Evaluate existing predictions

set -euo pipefail
cd "$(dirname "$0")"

QUICK=false
GENERATE_ONLY=false
EVALUATE_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --generate-only) GENERATE_ONLY=true ;;
    --evaluate-only) EVALUATE_ONLY=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Setup
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -q -r requirements.txt
else
  source venv/bin/activate
fi

# Generate
if [ "$EVALUATE_ONLY" = false ]; then
  if [ "$QUICK" = true ]; then
    echo "Quick mode: 5 tasks, vanilla + pm"
    python generate.py --configs vanilla pm --limit 5
  else
    echo "Full run: all configs, all tasks"
    python generate.py --resume
  fi
fi

# Evaluate
if [ "$GENERATE_ONLY" = false ]; then
  echo ""
  echo "Evaluating..."
  if command -v docker &>/dev/null; then
    python evaluate.py
  elif command -v sb-cli &>/dev/null; then
    echo "Docker not found, using cloud evaluation..."
    python evaluate.py --cloud
  else
    echo "Neither Docker nor sb-cli found. Install one to evaluate."
    echo "Showing prediction counts instead:"
    python evaluate.py --compare
  fi
fi
