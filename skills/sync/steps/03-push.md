---
name: Push
order: 3
description: Run knowledge base push and summarize the persisted sync result
---

## Goal

Upload local knowledge base changes through the sync script and report the outcome in user-facing terms.

## How

Only run this step when the selected route is `push`. Otherwise skip it.

1. Run the sync script:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" push
   ```
2. After it completes, read `{pm_state_dir}/sync-status.json`.
3. Parse the JSON and display:

   **On success** (`ok: true`):
   > Sync complete (push). {uploaded} files uploaded, {deleted} deleted.

   **On failure** (`ok: false`):
   > Sync failed (push). Errors:
   > - {each error on its own line}

Never display raw JSON to the user.

## Done-when

The push result has been read from `sync-status.json` and shown clearly, or the step has stopped on a surfaced push failure.

**Advance:** proceed to Step 4 (Pull).
