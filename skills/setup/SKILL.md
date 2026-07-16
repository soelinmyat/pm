---
name: setup
description: "Use when the user wants to toggle integrations, enable or disable Linear or Ahrefs, configure integrations, link repos, or configure separate-repo mode with phrases such as 'setup enable linear', 'disable ahrefs', 'setup separate-repo', or 'link repos'."
---

# pm:setup

## Purpose

Configure PM integrations and repo linking for this project. Setup manages the config selected by the shared path resolver — toggling supported integrations (Linear and Ahrefs), configuring separate-repo mode, and managing auth credentials.

Setup is the control panel. Start is the entry point. Don't confuse them.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

**Workflow:** `setup` | **Telemetry steps:** `parse-args`, `update-config`, `confirm`

## Iron Law

**NEVER CHANGE UNREQUESTED CONFIG.**

## When NOT to use

- For quick config checks such as "is Linear enabled?", resolve paths and read the returned `configPath` without writing.
- When PM is not bootstrapped, use `pm:start` first.
- For writing style or terminology changes, edit `{pm_dir}/instructions.md` through the appropriate project workflow.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` in numeric filename order. If `.pm/workflows/setup/` exists, same-named files there override defaults.

## Hard rules

- Never hand-edit the resolved config when setup can do it — setup owns config shape, integration toggles, and separate-repo linkage; bypassing it creates silent drift other skills must recover from.
- Supported integrations are exact — Linear, Ahrefs, and separate-repo mode. If the subcommand or integration is ambiguous or unsupported, stop and show the supported options rather than guessing.
- On every config write, update only the requested field and preserve all others — never drop existing fields.
- Separate-repo mode changes how every skill resolves `pm_dir`, `pm_state_dir`, and `source_dir` — treat it as a controlled config change, not a raw path write.
- The explicit setup request supplies authority only for the named effect. Make writes idempotent, verify the resulting config, and stop with a recovery choice instead of retrying a partial change blindly.

## Red Flags — Self-Check

- **"I can normalize the rest of the config while I am here."** Stop and keep every unrelated field byte-for-byte equivalent.
- **"The intended integration is obvious."** Ask when the action or destination is ambiguous.
- **"A path that exists must be the right repo."** Check both repo identities before writing separate-repo pointers.
- **"Retrying the write will probably fix it."** Inspect the partial state and use the documented recovery path first.

## Escalation Paths

- **Project is not initialized:** "No PM config found here yet. Run `/pm:start` first, then come back to `/pm:setup`."
- **User asked for an unsupported integration:** "This setup flow currently supports Linear, Ahrefs, and separate-repo mode only. Want to change one of those, or should I leave config alone?"
- **Config is malformed or unreadable:** "`.pm/config.json` looks invalid. Want me to repair the config shape, or stop so you can inspect it first?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Cleaning adjacent fields makes config consistent." | Unrequested cleanup can erase forward-compatible or user-owned settings. |
| "Setup can infer the repo pair from cwd." | Worktrees and separate-repo layouts make path inference unsafe. |

## Before Marking Done

- [ ] The requested config artifact was saved in the owning repo and unrelated fields were preserved.
- [ ] The user confirmed any missing integration or repo-linking decision before its effect ran.
- [ ] Config parsing, path identity, write verification, and recovery gates passed.
