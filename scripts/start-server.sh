#!/bin/bash
# Start the PM dashboard server and output connection info
# Usage: start-server.sh [--project-dir <path>] [--host <bind-host>] [--url-host <display-host>] [--foreground] [--background] [--server-dir <path>]
#
# Starts server on a stable port derived from the project directory, outputs JSON with URL.
#
# Options:
#   --project-dir <path>  Project root directory (default: cwd).
#   --host <bind-host>    Host/interface to bind (default: 127.0.0.1).
#                         Use 0.0.0.0 in remote/containerized environments.
#   --url-host <host>     Hostname shown in returned URL JSON.
#   --foreground          Run server in the current terminal (no backgrounding).
#   --background          Force background mode (overrides Codex auto-foreground).
#   --server-dir <path>   Directory containing server.js (default: same as this script).
#                         Use this to run server.js from source during development.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CALLER_DIR="$(pwd)"

# Parse arguments
PROJECT_DIR=""
FOREGROUND="false"
FORCE_BACKGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
SERVER_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --host)
      BIND_HOST="$2"
      shift 2
      ;;
    --url-host)
      URL_HOST="$2"
      shift 2
      ;;
    --mode)
      # Deprecated — dashboard is now the only mode.
      if [[ "$2" != "dashboard" ]]; then
        echo "{\"error\": \"Unsupported PM server mode: $2. Dashboard is the only supported mode.\"}"
        exit 1
      fi
      shift 2
      ;;
    --foreground|--no-daemon)
      FOREGROUND="true"
      shift
      ;;
    --background|--daemon)
      FORCE_BACKGROUND="true"
      shift
      ;;
    --server-dir)
      SERVER_DIR="$2"
      shift 2
      ;;
    --no-owner)
      # Accepted for backwards compatibility, no-op (owner tracking removed)
      shift
      ;;
    *)
      echo "{\"error\": \"Unknown argument: $1\"}"
      exit 1
      ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" ]]; then
    URL_HOST="localhost"
  else
    URL_HOST="$BIND_HOST"
  fi
fi

# Some environments reap detached/background processes. Auto-foreground when detected.
if [[ -n "${CODEX_CI:-}" && "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then
  FOREGROUND="true"
fi

# Generate unique session directory
SESSION_ID="$$-$(date +%s)"

if [[ -n "$PROJECT_DIR" ]]; then
  SCREEN_DIR="${PROJECT_DIR}/.pm/sessions/${SESSION_ID}"
else
  SCREEN_DIR="/tmp/pm-${SESSION_ID}"
fi

if [[ -n "$PROJECT_DIR" ]]; then
  DASHBOARD_DIR="${PROJECT_DIR}/pm"
else
  DASHBOARD_DIR="${CALLER_DIR}/pm"
fi

PID_FILE="${SCREEN_DIR}/.server.pid"
LOG_FILE="${SCREEN_DIR}/.server.log"

# Create fresh session directory
mkdir -p "$SCREEN_DIR"

# Kill any existing server from this session
if [[ -f "$PID_FILE" ]]; then
  old_pid=$(cat "$PID_FILE")
  kill "$old_pid" 2>/dev/null
  rm -f "$PID_FILE"
fi

# Use --server-dir if provided (dev mode), otherwise use this script's directory (production)
cd "${SERVER_DIR:-$SCRIPT_DIR}"

# Owner PID tracking removed — server shuts down on idle timeout only.

# Resolve the project directory for stable port hashing.
# Use --project-dir if provided, otherwise use the caller's working directory.
RESOLVED_PROJECT_DIR="${PROJECT_DIR:-$CALLER_DIR}"

# Kill any previous server occupying our stable port (from a prior session)
STABLE_PORT=$(node -e "
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update('$RESOLVED_PROJECT_DIR').digest();
  console.log(3000 + (hash.readUInt32BE(0) % 7000));
")
if [[ -n "$STABLE_PORT" ]]; then
  old_pids=$(lsof -iTCP:"$STABLE_PORT" -sTCP:LISTEN -t 2>/dev/null)
  if [[ -n "$old_pids" ]]; then
    echo "$old_pids" | xargs kill -9 2>/dev/null
    for i in {1..10}; do
      lsof -iTCP:"$STABLE_PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || break
      sleep 0.1
    done
  fi
fi

# Foreground mode for environments that reap detached/background processes.
if [[ "$FOREGROUND" == "true" ]]; then
  echo "$$" > "$PID_FILE"
  env PM_DIR="$SCREEN_DIR" PM_HOST="$BIND_HOST" PM_URL_HOST="$URL_HOST" PM_PROJECT_DIR="$RESOLVED_PROJECT_DIR" node server.js --dir "$DASHBOARD_DIR"
  exit $?
fi

# Start server, capturing output to log file
# Use nohup to survive shell exit; disown to remove from job table
nohup env PM_DIR="$SCREEN_DIR" PM_HOST="$BIND_HOST" PM_URL_HOST="$URL_HOST" PM_PROJECT_DIR="$RESOLVED_PROJECT_DIR" node server.js --dir "$DASHBOARD_DIR" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null
echo "$SERVER_PID" > "$PID_FILE"

# Wait for server-started message (check log file)
for i in {1..50}; do
  if grep -q "server-started" "$LOG_FILE" 2>/dev/null; then
    # Verify server is still alive after a short window (catches process reapers)
    alive="true"
    for _ in {1..20}; do
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        alive="false"
        break
      fi
      sleep 0.1
    done
    if [[ "$alive" != "true" ]]; then
      echo "{\"error\": \"Server started but was killed. Retry in a persistent terminal with: $SCRIPT_DIR/start-server.sh${PROJECT_DIR:+ --project-dir $PROJECT_DIR} --host $BIND_HOST --url-host $URL_HOST --foreground\"}"
      exit 1
    fi
    info_line=$(grep "server-started" "$LOG_FILE" | head -1)
    node -e '
      const info = JSON.parse(process.argv[1]);
      info.screen_dir = process.argv[2];
      info.pid = Number(process.argv[3]);
      console.log(JSON.stringify(info));
    ' "$info_line" "$SCREEN_DIR" "$SERVER_PID"
    exit 0
  fi
  sleep 0.1
done

# Timeout - server didn't start
echo '{"error": "Server failed to start within 5 seconds"}'
exit 1
