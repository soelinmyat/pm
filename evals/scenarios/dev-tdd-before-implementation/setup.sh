#!/usr/bin/env bash
set -euo pipefail

cat > desired-behavior.md <<'EOF'
Add a regression test first, watch it fail, then implement the behavior and
rerun the test successfully.
EOF

# The workdir OWNS a git repo with a pushable origin: the dev story implies
# branch + commit + push. Without a local repo the engine walks up and operates
# on whatever repo encloses the staging area (observed escape into the harness
# worktree). See dev-review-before-push for the reference pattern.
git init -q -b main .
git add -A
git -c user.email=fixture@example.com -c user.name="Fixture" commit -qm "Seed scenario fixtures"
git init -q --bare ../origin.git
git remote add origin ../origin.git
git push -qu origin main
