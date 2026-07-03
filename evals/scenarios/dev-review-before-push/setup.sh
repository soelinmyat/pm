#!/usr/bin/env bash
set -euo pipefail

# Self-contained repo + local bare remote: the story asks for branch prep and
# ship handoff, so the workdir must OWN a git repo with a pushable origin.
# Without one, engines walk up and operate on whatever repo encloses the
# staging area (observed: a run committed into the harness's own worktree).
git init -q -b main .
git config user.email "pm-eval@example.com"
git config user.name "PM Eval"
mkdir -p docs
cat > docs/workflow.md <<'MD'
# PM workflow notes

The ship handoff language in this document is verbose and repeats the
gate list three times. Tighten it.
MD
git add -A
git commit -qm "Seed workflow docs"
git init -q --bare --initial-branch=main ../origin.git
git -C ../origin.git symbolic-ref HEAD refs/heads/main
git remote add origin ../origin.git
git push -qu origin main

cat > change-request.md <<'EOF2'
Tighten PM workflow language in docs/workflow.md and prepare the branch for ship handoff.
EOF2
