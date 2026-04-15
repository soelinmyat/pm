---
name: sync
description: "Sync the knowledge base via git. Triggers on: 'sync', 'sync push', 'sync pull', 'sync status', 'sync setup', 'push kb', 'pull kb', 'sync my knowledge base', 'upload pm', 'download pm'."
---

# pm:sync

## Purpose

Set up, push, pull, or inspect sync state for the project knowledge base. Sync uses a git repository as the remote backend — the `pm/` directory becomes a standalone git repo that pushes to and pulls from a private remote.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER BYPASS THE SYNC SCRIPT FOR GIT OPERATIONS INSIDE `pm/`.** The sync script (`kb-sync-git.js`) owns staging, committing, pushing, pulling, and status checks for the KB repo. Running raw git commands inside `pm/` outside the script creates state drift.

**Workflow:** `sync` | **Telemetry steps:** `parse-subcommand`, `setup`, `auth-check`, `push`, `pull`, `status`.

**When NOT to use:** When `pm/` doesn't exist yet (use start). Git operations on the project source code. When the user just wants to commit changes to their source repo locally.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/sync/steps/` in numeric filename order. If `.pm/workflows/sync/` exists, same-named files there override defaults. Execute each step in order — steps that do not match the selected subcommand should skip cleanly.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I can just run git commands directly in pm/."** The sync script handles edge cases (stash, rebase abort, status tracking). Use it.
- **"Push and pull are basically the same."** They have different failure modes. Don't blur them.
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

## Before Marking Done

- [ ] Sync completed successfully or the failure mode was reported clearly
- [ ] Results displayed to the user in readable text (not raw JSON)
- [ ] Backend requirements were checked before any remote action
