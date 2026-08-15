---
name: sync
description: "Use when the user wants to sync, push, pull, upload, download, connect, or inspect the PM knowledge base backed by git or productmemory.io. Bare /pm:sync is bidirectional; explicit /pm:sync pull, push, status, and setup are overrides. Triggers include 'sync my knowledge base', 'push kb', 'pull kb', 'upload pm', 'download pm', and 'sync to productmemory'."
---

# pm:sync

## Purpose

Sync the project knowledge base. Bare `/pm:sync` is always bidirectional — if no backend is configured it onboards the user, otherwise it pulls remote changes and then pushes local changes in one pass. Explicit subcommands (`pull`, `push`, `status`, `setup`) are available as one-way overrides.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `sync` | **Telemetry steps:** `parse-subcommand`, `setup`, `auth-check`, `pull`, `push`, `status`

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

## Backends

Two supported backends, selected by `sync.backend` in `.pm/config.json`:

- **`git`** — full-file sync of everything in `pm/` to a git remote. Owned by `kb-sync-git.js`.
- **`productmemory`** — record-level sync to productmemory.io. KB record files (`evidence/`, `insights/`, `backlog/`) map to productmemory records via the REST API with idempotent `sync_id` upserts; the dashboard at productmemory.io shows them as browsable records. Monthly note rollups (`evidence/notes/{YYYY-MM}.md`) sync push-only, one evidence record per dated entry — server-side edits to note entries do not flow back. Pushes are conditional on the last-seen server version (`if_updated_at`), so a record changed on the server since the last pull is reported as a conflict instead of silently overwritten — running `/pm:sync` pulls the server version first. Non-record files (`strategy.md`, `memory.md`, `product/`, `thinking/`, HTML artifacts) are not synced, and deletes are not propagated — choose git when full-file fidelity matters. Owned by `kb-sync-pm.js`.

## Hard rules

- Never run raw git inside `pm/` for KB operations — `kb-sync-git.js` owns staging, commit, push, pull, and status; bypassing it creates state drift. (Setup similarly runs the full flow — git init, `.gitignore`, initial commit, upstream tracking, config write — don't shortcut it.)
- Never call the productmemory REST or MCP API directly for sync operations — `kb-sync-pm.js` owns upserts, link ordering, conflict artifacts, and the local cache; ad-hoc writes bypass its `sync_id` bookkeeping and create duplicate records.
- Never write the productmemory token into `.pm/config.json` or any file inside `pm/` — it lives in `~/.pm/credentials` only.
- Bare `/pm:sync` is bidirectional (pull then push). Don't prompt for a push/pull choice unless the user explicitly asks for a one-way override.
- When no backend is configured, route through the setup step — it needs user input (repo name/URL); never configure silently.
- Report results as readable text, never raw JSON. On repeated failure, surface the real auth/config/remote cause rather than retrying blindly.
- A bare or explicit sync command grants authority only for that route. The helper must journal that action-specific grant, observe the target before retrying, and return a verified receipt or an explicit recovery state. Keep automatic rebase/retry behavior bounded to the helper.
- Git sync follows the current branch's configured upstream; remote and branch names are not assumed to be `origin` and `main`. Detached HEAD and missing-upstream states stop with repair guidance.
- If a missing-upstream checkout contains unrelated commits or dirty paths, do not set an upstream and do not absorb one session's files into another session's commit. Resume the owning session in its artifact worktree, or preserve and recover the mixed checkout manually before sync.
- Repository ownership is explicit. If `pm/` is tracked by the consumer project's parent repository, setup must not silently convert it into a nested repository. Keep parent ownership or configure a separate PM repository.

## Red Flags — Self-Check

- **"A force push would make this easy."** Stop and preserve remote history; surface the divergence instead.
- **"I can run raw git for one small sync fix."** Use the sync helper so status and recovery evidence stay aligned.
- **"Bare sync probably means push."** Use the documented pull-then-push route.
- **"The same retry might work this time."** Check auth, remote, and conflict evidence before another attempt.
- **"Every KB uses origin/main."** Use the attached branch's configured upstream; names are repository data, not defaults for established repos.

## Escalation Paths

- **No PM workspace here yet:** "This project doesn't look initialized for PM. Want to run `/pm:start` first?"
- **No sync backend configured:** Route to the setup step — don't tell the user to configure manually.
- **Git push/pull fails:** Surface the error. Common causes: no remote access, diverged branches, merge conflicts.
- **Detached branch or no upstream:** Stop and inspect branch ancestry plus dirty paths. Offer `--set-upstream` only for a clean, isolated branch owned by the current session. For mixed state, route to the owning session's artifact worktree; do not guess a target.
- **Parent repository owns `pm/`:** Keep same-repo ownership or offer `/pm:setup separate-repo`; never create a nested repository implicitly.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Local is newer, so remote can be replaced." | Recency does not prove remote knowledge is disposable. |
| "Raw JSON is more complete." | The user needs the outcome, conflict, and recovery action, not transport details. |

## Before Marking Done

- [ ] The sync-status artifact records the selected route, effect identity, exact outcome, verified receipt, and recovery action.
- [ ] The user confirmed setup/reconfiguration decisions before repo or remote effects ran.
- [ ] Backend, auth, remote, conflict, and bounded recovery gates passed or the precise blocker was reported.
