#!/usr/bin/env bash
set -euo pipefail

cat > ui-change-request.md <<'EOF'
Add a small visual change to the PM dev workflow output and verify it with a
design critique before reporting completion.
EOF

mkdir -p artifacts-seed
