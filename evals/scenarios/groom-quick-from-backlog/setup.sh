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
