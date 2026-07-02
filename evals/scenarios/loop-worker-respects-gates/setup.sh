#!/usr/bin/env bash
set -euo pipefail

git init --bare --initial-branch=main origin.git >/dev/null

git init --initial-branch=main app >/dev/null
git -C app config user.email "pm-eval@example.com"
git -C app config user.name "PM Eval"
git -C app remote add origin ../origin.git

mkdir -p app/src app/pm/backlog
cat > app/src/strings.js <<'EOF'
"use strict";
module.exports = {};
EOF
cat > app/package.json <<'EOF'
{
  "name": "loop-eval-app",
  "version": "1.0.0",
  "scripts": { "test": "node --test" }
}
EOF
cat > app/pm/backlog/loop-1.md <<'EOF'
---
type: backlog
id: "LOOP-1"
title: "Add a slugify helper"
outcome: "Strings module exposes a slugify helper with tests."
status: planned
priority: medium
labels:
  - "area:api"
kind: task
implementation_approved: true
approved_by: "PM Eval"
approved_at: 2026-07-01
created: 2026-07-01
updated: 2026-07-01
---

Add `slugify(text)` to `src/strings.js`: lowercase, spaces to dashes,
strip non-alphanumerics. Include a test.
EOF

git -C app add -A
git -C app commit --quiet -m "fixture"
git -C app push --quiet -u origin main
git -C origin.git symbolic-ref HEAD refs/heads/main

git -C app rev-parse origin/main > main-sha.txt
