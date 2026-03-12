#!/bin/bash
# Build and run the SWE-bench Docker environment.
#
# Usage:
#   ./docker-run.sh              # Build image + start container
#   ./docker-run.sh --resume     # Re-enter existing container
#
# Inside the container:
#   python setup-task.py --list                    # See all 300 tasks
#   python setup-task.py astropy__astropy-12907    # Checkout a task
#   cd /repos/astropy__astropy                     # Enter the repo
#   claude                                         # Interactive (subscription)
#   claude --bare                                  # Vanilla (no plugins)
#   claude --plugin-dir /plugins/pm                # With PM plugin

set -euo pipefail
cd "$(dirname "$0")"

IMAGE_NAME="swe-bench-claude"
CONTAINER_NAME="swe-bench-env"

# Resolve paths
CLAUDE_AUTH="$HOME/.claude"
PM_PLUGIN="$(cd ../../.claude-plugin && pwd)"

if [ "${1:-}" = "--resume" ]; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Resuming container ${CONTAINER_NAME}..."
    docker start -ai "$CONTAINER_NAME"
  else
    echo "No existing container found. Run without --resume first."
    exit 1
  fi
  exit 0
fi

# Build image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

# Stop existing container if running
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo ""
echo "Starting container..."
echo "  Auth:   $CLAUDE_AUTH -> /root/.claude (read-only)"
echo "  PM:     $PM_PLUGIN -> /plugins/pm (read-only)"
echo "  Repos:  persisted in container at /repos"
echo ""

docker run -it \
  --name "$CONTAINER_NAME" \
  -v "$CLAUDE_AUTH:/root/.claude:ro" \
  -v "$PM_PLUGIN:/plugins/pm:ro" \
  -v "$(pwd)/setup-task.py:/workspace/setup-task.py:ro" \
  -v "$(pwd)/requirements.txt:/workspace/requirements.txt:ro" \
  -e "HF_HUB_DISABLE_PROGRESS_BARS=1" \
  "$IMAGE_NAME" \
  bash -c '
    pip install -q datasets 2>/dev/null
    echo ""
    echo "=================================="
    echo " SWE-bench Claude Code Benchmark"
    echo "=================================="
    echo ""
    echo "Commands:"
    echo "  python setup-task.py --list                  # List tasks"
    echo "  python setup-task.py <instance_id>           # Checkout a task"
    echo "  python setup-task.py --random                # Random task"
    echo ""
    echo "Claude configs:"
    echo "  claude                         # Default (subscription)"
    echo "  claude --bare                  # Vanilla (no plugins)"
    echo "  claude --bare --plugin-dir /plugins/pm   # PM only"
    echo ""
    exec bash
  '
