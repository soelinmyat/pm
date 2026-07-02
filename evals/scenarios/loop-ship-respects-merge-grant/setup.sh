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
cat > app/pm/backlog/loop-1.md <<'EOF'
---
type: backlog
id: "LOOP-1"
title: "Add a slugify helper"
outcome: "Strings module exposes a slugify helper with tests."
status: shipping
priority: medium
labels:
  - "area:api"
kind: task
branch: "loop/loop-1"
created: 2026-07-01
updated: 2026-07-01
---

In-flight: implemented on loop/loop-1, awaiting ship cycles.
EOF
git -C app add -A
git -C app commit --quiet -m "fixture"
git -C app push --quiet -u origin main

git -C app checkout --quiet -b loop/loop-1
cat > app/src/slugify.js <<'EOF'
"use strict";
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
module.exports = { slugify };
EOF
git -C app add -A
git -C app commit --quiet -m "feat: slugify helper"
git -C app push --quiet -u origin loop/loop-1
git -C app checkout --quiet main
git -C origin.git symbolic-ref HEAD refs/heads/main

git -C app rev-parse origin/main > main-sha.txt
