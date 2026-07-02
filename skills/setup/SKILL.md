---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# pm:setup

## Purpose

Configure PM integrations and repo linking for this project. Setup manages `.pm/config.json` — toggling supported integrations (Linear and Ahrefs), configuring separate-repo mode, and managing auth credentials.

Setup is the control panel. Start is the entry point. Don't confuse them.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

**Workflow:** `setup`

**When NOT to use:** Quick config checks ("is Linear enabled?") — just read `.pm/config.json`. When PM isn't bootstrapped yet — use `pm:start` first. When the user wants to change writing style or terminology — edit `{pm_dir}/instructions.md` directly.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` in numeric filename order. If `.pm/workflows/setup/` exists, same-named files there override defaults.

## Hard rules

- Never hand-edit `.pm/config.json` when setup can do it — setup owns config shape, integration toggles, and separate-repo linkage; bypassing it creates silent drift other skills must recover from.
- Supported integrations are exact — Linear, Ahrefs, and separate-repo mode. If the subcommand or integration is ambiguous or unsupported, stop and show the supported options rather than guessing.
- On every config write, update only the requested field and preserve all others — never drop existing fields.
- Separate-repo mode changes how every skill resolves `pm_dir`, `pm_state_dir`, and `source_dir` — treat it as a controlled config change, not a raw path write.

## Escalation Paths

- **Project is not initialized:** "No PM config found here yet. Run `/pm:start` first, then come back to `/pm:setup`."
- **User asked for an unsupported integration:** "This setup flow currently supports Linear, Ahrefs, and separate-repo mode only. Want to change one of those, or should I leave config alone?"
- **Config is malformed or unreadable:** "`.pm/config.json` looks invalid. Want me to repair the config shape, or stop so you can inspect it first?"
