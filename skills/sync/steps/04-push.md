---
name: Push
order: 4
description: Push knowledge base changes to the remote and report the outcome
---

## Goal

Upload local knowledge base changes and report the outcome in user-facing terms.

## How

Only run this step when the selected route is `push`. Otherwise skip it.

### Git backend

Run the sync script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" push
```

After it completes, read `{pm_state_dir}/sync-status.json`.

Parse the JSON and display:

**On success** (`ok: true`):

If `uploaded > 0`:
> Sync complete (push). {uploaded} files pushed.

If `uploaded === 0`:
> Already up to date. Nothing to push.

**On failure** (`ok: false`):
> Sync failed (push). Error: {error message}

Never display raw JSON to the user.

## Done-when

The push result has been read from `sync-status.json` and shown clearly, or the step has stopped on a surfaced failure.

**Advance:** proceed to Step 5 (Pull).
