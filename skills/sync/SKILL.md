---
name: sync
description: "Sync the knowledge base via git. Bare /pm:sync auto-detects: sets up if needed, pulls then pushes if ready. Triggers on: 'sync', 'sync push', 'sync pull', 'sync status', 'sync setup', 'push kb', 'pull kb', 'sync my knowledge base', 'upload pm', 'download pm'."
---

# pm:sync

## Purpose

Sync the project knowledge base. Bare `/pm:sync` does the right thing automatically — if no backend is configured it onboards the user, otherwise it pulls then pushes in one pass. Explicit subcommands (`push`, `pull`, `status`, `setup`) are available as overrides.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER BYPASS THE SYNC SCRIPT FOR GIT OPERATIONS INSIDE `pm/`.** The sync script (`kb-sync-git.js`) owns staging, committing, pushing, pulling, and status checks for the KB repo. Running raw git commands inside `pm/` outside the script creates state drift.

**Workflow:** `sync` | **Telemetry steps:** `parse-subcommand`, `setup`, `auth-check`, `pull`, `push`, `status`.

**Default behavior (no subcommand):**
1. No backend configured → route to setup
2. Backend configured → pull first, then push, report combined result

**When NOT to use:** When `pm/` doesn't exist yet (use start). Git operations on the project source code. When the user just wants to commit changes to their source repo locally.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/sync/steps/` in numeric filename order. If `.pm/workflows/sync/` exists, same-named files there override defaults. Execute each step in order — steps that do not match the selected route should skip cleanly.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I can just run git commands directly in pm/."** The sync script handles edge cases (stash, rebase abort, status tracking). Use it.
- **"The user needs to choose push or pull."** No. Bare sync pulls then pushes. Only show subcommand menus if the user explicitly asks.
- **"No backend configured, I'll just set it up silently."** Setup requires user input (repo name/URL). Route through the setup step.
- **"If sync fails, I should retry blindly."** Repeated sync failures usually mean a real auth, config, or remote problem. Surface the failure cleanly first.

## Escalation Paths

- **No PM workspace here yet:** "This project doesn't look initialized for PM. Want to run `/pm:start` first?"
- **No sync backend configured:** Route to the setup step — don't tell the user to configure manually.
- **Git push/pull fails:** Surface the error. Common causes: no remote access, diverged branches, merge conflicts.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just run git push directly" | The sync script handles staging, commit messages, stash, and status tracking. Direct git loses state. |
| "Nothing changed, skip sync" | The remote might have changes from another machine. Pull checks both directions. |
| "Setup is just git init + remote add" | Setup also creates .gitignore, initial commit, upstream tracking, and writes config. Don't shortcut. |
| "I should show the user a menu of options" | Bare sync should just work. The user said sync — do both directions. |

## Before Marking Done

- [ ] Sync completed successfully or the failure mode was reported clearly
- [ ] Results displayed to the user in readable text (not raw JSON)
- [ ] Backend requirements were checked before any remote action
