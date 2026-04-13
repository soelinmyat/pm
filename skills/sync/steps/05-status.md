---
name: Status
order: 5
description: Show the last sync result and, when possible, current server-side sync stats
---

## Goal

Show the user both the last local sync outcome and the current server-side sync status when the required credentials and project config exist.

## How

Only run this step when the selected route is `status`. Otherwise skip it.

1. Read `{pm_state_dir}/sync-status.json`.
2. If the file does not exist: tell the user "No sync has been run yet. Use `/pm:sync push` or `/pm:sync pull`." and stop.
3. Parse the JSON and display a formatted summary:

   ```text
   Last sync: {lastSync, formatted as readable date/time}
   Mode: {mode}
   Uploaded: {uploaded}
   Downloaded: {downloaded}
   Deleted: {deleted}
   Status: {ok ? "OK" : "Failed"}
   ```

   If `errors` is non-empty, append:
   ```text
   Errors:
   - {each error}
   ```

4. Query server-side stats through the sync script when both of these are true:
   - `~/.pm/credentials` exists and contains a `token` field
   - `.pm/config.json` contains a `projectId` field

   Run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" status
   ```

   If the response contains valid `fileCount`, `totalBytes`, and `lastUpdated`, append:
   ```text
   Server: {fileCount} files, {totalBytes formatted} synced
   Last updated: {lastUpdated formatted as readable date/time}
   ```

   On any failure, append:
   ```text
   Server unreachable — showing local data only.
   ```

Never show raw JSON to the user.

## Done-when

The user has a readable sync status report from the local status payload, plus server-side stats or a clear fallback note when server data is unavailable.
