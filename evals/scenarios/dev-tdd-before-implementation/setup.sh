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
git config user.email "pm-eval@example.com"
git config user.name "PM Eval"
git add -A
git commit -qm "Seed scenario fixtures"
git init -q --bare --initial-branch=main ../origin.git
git -C ../origin.git symbolic-ref HEAD refs/heads/main
git remote add origin ../origin.git
git push -qu origin main
