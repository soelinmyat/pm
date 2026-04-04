#!/usr/bin/env bash
# PM telemetry logger — wraps the Node implementation for legacy and new callers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/pm-log.js" "$@"
