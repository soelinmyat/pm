---
name: sync
description: "Manually pull or push knowledge base changes. Triggers on: 'sync push', 'sync pull', 'sync status', 'push to server', 'pull from server', 'sync my knowledge base', 'upload pm', 'download pm'."
---

# pm:sync

## Purpose

Push, pull, or inspect sync state for the project knowledge base. `pm:sync` runs the shared sync script and reports results clearly; it is not a manual file-copy workflow.

For server-backed status checks, route through `node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" status` instead of calling the sync API directly.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER TREAT SYNC AS RAW FILE COPY.** The sync script owns manifests, server communication, and status tracking. If you bypass it, you are no longer doing a safe PM sync.

**Workflow:** `sync` | **Telemetry steps:** `auth-check`, `push`, `pull`, `status`.

**When NOT to use:** When `pm/` doesn't exist yet (use start). Git operations on source code. When the user just wants to commit changes locally.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/sync/steps/` in numeric filename order. If `.pm/workflows/sync/` exists, same-named files there override defaults. Execute each step in order — steps that do not match the selected subcommand should skip cleanly.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I can just copy the `pm/` folder manually."** Manual copy loses manifests, server-side state, and sync status.
- **"Push and pull are basically the same."** They have different failure modes and different user guidance. Don’t blur them.
- **"Status is just reading a JSON file."** Status also includes server-side state when credentials and project config exist.
- **"If sync fails, I should retry blindly."** Repeated sync failures usually mean a real auth, config, or server problem. Surface the failure cleanly first.

## Escalation Paths

- **No PM workspace here yet:** "This project doesn’t look initialized for PM sync. Want to run `/pm:start` first?"
- **Missing auth credentials for push/pull:** "No PM auth token found. Run `/pm:setup` first, then retry sync."
- **Sync script or status payload fails:** "Sync didn’t complete cleanly. Want me to stop at the reported error, or investigate the sync script/config further?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just copy files manually" | Sync tracks manifests, handles conflicts, and updates status. Manual copy loses state. |
| "Nothing changed, skip sync" | The server might have changes from another session. Pull checks both directions. |
| "Push failed, I'll try again later" | Sync failures have a cause. Diagnose before retrying — repeated failures corrupt manifests. |

## Before Marking Done

- [ ] Sync completed successfully or the failure mode was reported clearly
- [ ] Results displayed to the user in readable text (not raw JSON)
- [ ] Push/pull auth requirements were enforced before any remote action
