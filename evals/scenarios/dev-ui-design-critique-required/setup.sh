#!/usr/bin/env bash
set -euo pipefail

cat > ui-change-request.md <<'EOF'
Add a small visual change to the PM dev workflow output and verify it with a
design critique before reporting completion.
EOF

mkdir -p artifacts-seed

# The workdir OWNS a git repo with a pushable origin: the dev story implies
# branch + commit + push. Without a local repo the engine walks up and operates
# on whatever repo encloses the staging area. See dev-review-before-push.
git init -q -b main .
git add -A
git -c user.email=fixture@example.com -c user.name="Fixture" commit -qm "Seed scenario fixtures"
git init -q --bare ../origin.git
git remote add origin ../origin.git
git push -qu origin main
