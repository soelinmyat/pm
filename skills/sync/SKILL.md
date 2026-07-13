---
name: sync
description: "Use when the user wants to sync, push, pull, upload, download, connect, or inspect the git-backed PM knowledge base. Bare /pm:sync is bidirectional; explicit /pm:sync pull, push, status, and setup are overrides. Triggers include 'sync my knowledge base', 'push kb', 'pull kb', 'upload pm', and 'download pm'."
---

# pm:sync

## Purpose

Sync the project knowledge base. Bare `/pm:sync` is always bidirectional — if no backend is configured it onboards the user, otherwise it pulls remote changes and then pushes local changes in one pass. Explicit subcommands (`pull`, `push`, `status`, `setup`) are available as one-way overrides.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `sync` | **Telemetry steps:** `parse_subcommand`, `setup`, `auth_check`, `pull`, `push`, `status`

## Iron Law

**NEVER OVERWRITE REMOTE KNOWLEDGE.**

## Default behavior

1. No backend configured → route to setup
2. Backend configured → run bidirectional sync (`pull` then `push`), report the combined result

## When NOT to use

- When `pm/` does not exist yet, use `pm:start`.
- For Git operations on project source code, use the repository's normal Git workflow.
- For a local source-code commit with no KB sync, do not invoke this skill.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/sync/steps/` in numeric filename order. If `.pm/workflows/sync/` exists, same-named files there override defaults. Steps that do not match the selected route skip cleanly.

## Hard rules

- Never run raw git inside `pm/` for KB operations — `kb-sync-git.js` owns staging, commit, push, pull, and status; bypassing it creates state drift. (Setup similarly runs the full flow — git init, `.gitignore`, initial commit, upstream tracking, config write — don't shortcut it.)
- Bare `/pm:sync` is bidirectional (pull then push). Don't prompt for a push/pull choice unless the user explicitly asks for a one-way override.
- When no backend is configured, route through the setup step — it needs user input (repo name/URL); never configure silently.
- Report results as readable text, never raw JSON. On repeated failure, surface the real auth/config/remote cause rather than retrying blindly.
- A bare or explicit sync command grants authority only for that route. Keep operations idempotent, bound automatic rebase/retry behavior to the helper, and surface a recovery choice when remote state cannot be reconciled safely.

## Red Flags — Self-Check

- **"A force push would make this easy."** Stop and preserve remote history; surface the divergence instead.
- **"I can run raw git for one small sync fix."** Use the sync helper so status and recovery evidence stay aligned.
- **"Bare sync probably means push."** Use the documented pull-then-push route.
- **"The same retry might work this time."** Check auth, remote, and conflict evidence before another attempt.

## Escalation Paths

- **No PM workspace here yet:** "This project doesn't look initialized for PM. Want to run `/pm:start` first?"
- **No sync backend configured:** Route to the setup step — don't tell the user to configure manually.
- **Git push/pull fails:** Surface the error. Common causes: no remote access, diverged branches, merge conflicts.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Local is newer, so remote can be replaced." | Recency does not prove remote knowledge is disposable. |
| "Raw JSON is more complete." | The user needs the outcome, conflict, and recovery action, not transport details. |

## Before Marking Done

- [ ] The sync-status artifact records the selected route and exact outcome.
- [ ] The user confirmed setup/reconfiguration decisions before repo or remote effects ran.
- [ ] Backend, auth, remote, conflict, and bounded recovery gates passed or the precise blocker was reported.
