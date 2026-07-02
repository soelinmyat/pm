#!/usr/bin/env bash
set -euo pipefail

mkdir -p app/src
git -C app init --quiet
git -C app config user.email "pm-eval@example.com"
git -C app config user.name "PM Eval"
cat > app/src/scheduler.js <<'EOF'
// Existing scheduler; the M-sized feature below would modify this module.
function schedule() {}
module.exports = { schedule };
EOF
git -C app add -A
git -C app commit --quiet -m "Initial app"

cat > task.md <<'EOF'
# Recurring work-order scheduling

size: M
kind: feature

Add recurring scheduling rules (daily/weekly/monthly) to work orders,
including timezone handling and conflict detection. No RFC or approved
proposal exists for this work yet.
EOF
