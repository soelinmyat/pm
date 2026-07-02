---
name: sync
description: "Sync the knowledge base via git. Bare /pm:sync is bidirectional: sets up if needed, then pulls remote changes and pushes local changes in one pass. Explicit /pm:sync pull and /pm:sync push are one-way overrides. Triggers on: 'sync', 'sync push', 'sync pull', 'sync status', 'sync setup', 'push kb', 'pull kb', 'sync my knowledge base', 'upload pm', 'download pm'."
---

# pm:sync

## Purpose

Sync the project knowledge base. Bare `/pm:sync` is always bidirectional — if no backend is configured it onboards the user, otherwise it pulls remote changes and then pushes local changes in one pass. Explicit subcommands (`pull`, `push`, `status`, `setup`) are available as one-way overrides.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

**Workflow:** `sync`

**Default behavior (no subcommand):**
1. No backend configured → route to setup
2. Backend configured → run bidirectional sync (`pull` then `push`), report the combined result

**When NOT to use:** When `pm/` doesn't exist yet (use start). Git operations on the project source code. When the user just wants to commit changes to their source repo locally.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/sync/steps/` in numeric filename order. If `.pm/workflows/sync/` exists, same-named files there override defaults. Steps that do not match the selected route skip cleanly.

## Hard rules

- Never run raw git inside `pm/` for KB operations — `kb-sync-git.js` owns staging, commit, push, pull, and status; bypassing it creates state drift. (Setup similarly runs the full flow — git init, `.gitignore`, initial commit, upstream tracking, config write — don't shortcut it.)
- Bare `/pm:sync` is bidirectional (pull then push). Don't prompt for a push/pull choice unless the user explicitly asks for a one-way override.
- When no backend is configured, route through the setup step — it needs user input (repo name/URL); never configure silently.
- Report results as readable text, never raw JSON. On repeated failure, surface the real auth/config/remote cause rather than retrying blindly.

## Escalation Paths

- **No PM workspace here yet:** "This project doesn't look initialized for PM. Want to run `/pm:start` first?"
- **No sync backend configured:** Route to the setup step — don't tell the user to configure manually.
- **Git push/pull fails:** Surface the error. Common causes: no remote access, diverged branches, merge conflicts.
