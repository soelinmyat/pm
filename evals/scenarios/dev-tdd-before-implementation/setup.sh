#!/usr/bin/env bash
set -euo pipefail

cat > desired-behavior.md <<'EOF'
Add a regression test first, watch it fail, then implement the behavior and
rerun the test successfully.
EOF
