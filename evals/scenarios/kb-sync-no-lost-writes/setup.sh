#!/usr/bin/env bash
set -euo pipefail

mkdir -p kb/pm/insights
git -C kb init --quiet
git -C kb config user.email "pm-eval@example.com"
git -C kb config user.name "PM Eval"

cat > kb/pm/insights/checkout-drop-off.md <<'EOF'
---
title: Checkout drop-off
origin: user
---

USER-AUTHORED-LINE-keep-me: field interviews show drop-off at the payment step.
EOF
git -C kb add -A
git -C kb commit --quiet -m "Add user-authored insight"

cat >> kb/pm/insights/checkout-drop-off.md <<'EOF'

LOCAL-UNCOMMITTED-EDIT-keep-me: follow-up call notes not yet committed.
EOF
