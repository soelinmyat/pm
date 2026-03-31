#!/usr/bin/env bash
# find-dashboard-port.sh — Discover the dashboard server port for a project directory.
#
# Usage: find-dashboard-port.sh <project-directory>
#
# Outputs the port where the dashboard server is listening (exit 0).
# Outputs nothing and exits 1 if no server is running on that port.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: find-dashboard-port.sh <project-directory>" >&2
  exit 1
fi

PROJECT_DIR="$1"

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || {
  exit 1
}

# Compute stable port using same hash as start-server.sh (lines 119-123)
PORT=$(PM_HASH_DIR="$PROJECT_DIR" node -e "
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(process.env.PM_HASH_DIR).digest();
  console.log(3000 + (hash.readUInt32BE(0) % 7000));
")

# Check if something is listening on that port
if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "$PORT"
  exit 0
else
  exit 1
fi
