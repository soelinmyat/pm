---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# Setup Skill

Toggle integrations on or off for this project, or configure separate-repo mode.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and telemetry.

**Workflow:** `setup`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` in numeric filename order. If `.pm/workflows/setup/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.
