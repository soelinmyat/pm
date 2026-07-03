#!/usr/bin/env bash
set -euo pipefail

mkdir -p pm/backlog

cat > pm/backlog/csv-export.md <<'MD'
---
title: CSV export for cleaning logs
status: idea
outcome: Facility managers can export any date range of cleaning logs as CSV for auditors.
---

Auditors keep asking for spreadsheets. Two customers requested raw exports
last month. No competitor context captured yet.
MD

# The workdir OWNS a git repo so the engine cannot walk up and mutate whatever
# repo encloses the staging area. The groom story has no push, so no remote.
git init -q -b main .
git config user.email "pm-eval@example.com"
git config user.name "PM Eval"
git add -A
git commit -qm "Seed scenario fixtures"
