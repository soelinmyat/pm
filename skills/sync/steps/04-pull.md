---
name: Pull
order: 4
description: Run knowledge base pull and summarize the persisted sync result
---

## Goal

Download remote knowledge base changes through the sync script and report the outcome clearly.

## How

Only run this step when the selected route is `pull`. Otherwise skip it.

1. Run the sync script:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" pull
   ```
2. After it completes, read `{pm_state_dir}/sync-status.json`.
3. Parse the JSON and display:

   **On success** (`ok: true`):
   > Sync complete (pull). {downloaded} files downloaded, {deleted} deleted.

   **On failure** (`ok: false`):
   > Sync failed (pull). Errors:
   > - {each error on its own line}

4. If `downloaded > 0`, add: "Run `/pm:refresh` to check for staleness in updated files."

Never display raw JSON to the user.

## Done-when

The pull result has been read from `sync-status.json` and shown clearly, including the refresh follow-up when relevant, or the step has stopped on a surfaced pull failure.
