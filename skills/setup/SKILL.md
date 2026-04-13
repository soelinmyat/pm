---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# pm:setup

## Purpose

Configure PM integrations and repo linking for this project. Setup manages `.pm/config.json` — toggling integrations (Linear, Ahrefs, Sentry), configuring separate-repo mode, and managing auth credentials.

Setup is the control panel. Start is the entry point. Don't confuse them.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and telemetry.

**Workflow:** `setup` | **Telemetry steps:** `parse-args`, `update-config`, `confirm`.

**When NOT to use:** Quick config checks ("is Linear enabled?") — just read `.pm/config.json`. When PM isn't bootstrapped yet — use `pm:start` first. When the user wants to change writing style or terminology — edit `{pm_dir}/instructions.md` directly.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` in numeric filename order. If `.pm/workflows/setup/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just edit config.json directly" | Config has validation rules and integration dependencies. Setup handles them. Direct edits break things silently. |
| "Integration is already configured" | Toggling requires cleanup — API keys, state files, config entries. Setup handles all three. |
| "Setup is overkill for one toggle" | One toggle is exactly what setup is for. It takes 30 seconds. |

## Before Marking Done

- [ ] `.pm/config.json` updated with correct values
- [ ] Integration toggled (enabled/disabled) as requested
- [ ] Confirmation shown with current config state
