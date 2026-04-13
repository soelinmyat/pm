---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# pm:setup

## Purpose

Configure PM integrations and repo linking for this project. Setup manages `.pm/config.json` — toggling supported integrations (Linear and Ahrefs), configuring separate-repo mode, and managing auth credentials.

Setup is the control panel. Start is the entry point. Don't confuse them.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and telemetry.

## Iron Law

**NEVER HAND-EDIT PM CONFIG WHEN SETUP CAN DO IT.** `pm:setup` owns config shape, integration toggles, and separate-repo linkage. Bypassing it creates silent drift that other skills have to recover from later.

**Workflow:** `setup` | **Telemetry steps:** `parse-args`, `update-config`, `confirm`.

**When NOT to use:** Quick config checks ("is Linear enabled?") — just read `.pm/config.json`. When PM isn't bootstrapped yet — use `pm:start` first. When the user wants to change writing style or terminology — edit `{pm_dir}/instructions.md` directly.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` in numeric filename order. If `.pm/workflows/setup/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I'll just edit `.pm/config.json` directly."** Setup owns validation and field semantics. Direct edits create shape drift that other skills have to debug later.
- **"The user mentioned Sentry, so setup must support it."** Support is defined by the implemented step flows, not by an aspirational integration list.
- **"I can guess the integration name from context."** Integration toggles are exact. If the subcommand or integration is ambiguous, stop and show the supported options.
- **"Separate-repo mode is just a path write."** It changes how every other skill resolves `pm_dir`, `pm_state_dir`, and `source_dir`. Treat it as a controlled config change.

## Escalation Paths

- **Project is not initialized:** "No PM config found here yet. Run `/pm:start` first, then come back to `/pm:setup`."
- **User asked for an unsupported integration:** "This setup flow currently supports Linear, Ahrefs, and separate-repo mode only. Want to change one of those, or should I leave config alone?"
- **Config is malformed or unreadable:** "`.pm/config.json` looks invalid. Want me to repair the config shape, or stop so you can inspect it first?"

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
