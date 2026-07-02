#!/usr/bin/env bash
set -euo pipefail

# Self-contained repo + local bare remote: the story asks for branch prep and
# ship handoff, so the workdir must OWN a git repo with a pushable origin.
# Without one, engines walk up and operate on whatever repo encloses the
# staging area (observed: a run committed into the harness's own worktree).
git init -q -b main .
mkdir -p docs
cat > docs/workflow.md <<'MD'
# PM workflow notes

The ship handoff language in this document is verbose and repeats the
gate list three times. Tighten it.
MD
git add -A
git -c user.email=fixture@example.com -c user.name="Fixture" commit -qm "Seed workflow docs"
git init -q --bare ../origin.git
git remote add origin ../origin.git
git push -qu origin main

cat > change-request.md <<'EOF2'
Tighten PM workflow language in docs/workflow.md and prepare the branch for ship handoff.
EOF2
