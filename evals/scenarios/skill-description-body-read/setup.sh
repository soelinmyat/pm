#!/usr/bin/env bash
set -euo pipefail

cat > idea.md <<'EOF'
Validated idea: make PM skill compliance observable before changing workflow
behavior.
EOF

# The workdir OWNS a git repo so the engine cannot walk up and mutate whatever
# repo encloses the staging area. This story has no push, so no remote.
git init -q -b main .
git add -A
git -c user.email=fixture@example.com -c user.name="Fixture" commit -qm "Seed scenario fixtures"
