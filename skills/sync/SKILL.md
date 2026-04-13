---
name: sync
description: "Manually pull or push knowledge base changes. Triggers on: 'sync push', 'sync pull', 'sync status', 'push to server', 'pull from server', 'sync my knowledge base', 'upload pm', 'download pm'."
---

# pm:sync

Manually push, pull, or check sync status for the project knowledge base.

## Usage

```
/pm:sync push     — Upload local pm/ changes to the server
/pm:sync pull     — Download server changes to local pm/
/pm:sync status   — Show last sync result
/pm:sync          — Show usage
```

---

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution.

**Workflow:** `sync` | **Telemetry steps:** `auth-check`, `push`, `pull`, `status`.

**When NOT to use:** When `pm/` doesn't exist yet (use start). Git operations on source code. When the user just wants to commit changes locally.

---

## Subcommand Routing

Parse the user's argument after `/pm:sync`. Extract the first word as the subcommand.

| Argument | Action |
|---|---|
| `push` | Run push flow |
| `pull` | Run pull flow |
| `status` | Run status flow |
| _(empty or unrecognized)_ | Show usage: "`/pm:sync push` | `pull` | `status`" and stop |

---

## Auth Check (push and pull only)

Before running push or pull, check for credentials:

1. Use the Bash tool to test if `~/.pm/credentials` exists:
   ```bash
   test -f ~/.pm/credentials && echo "EXISTS" || echo "MISSING"
   ```
2. If `MISSING`: tell the user "No auth token found. Run `/pm:setup` to log in first." and **stop**.
3. If `EXISTS`: proceed to the subcommand.

---

## Push Flow

1. Run the sync script via the Bash tool:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" push
   ```
2. After the script completes, read `{pm_state_dir}/sync-status.json` using the Read tool.
3. Parse the JSON and display results:

   **On success** (`ok: true`):
   > Sync complete (push). {uploaded} files uploaded, {deleted} deleted.

   **On failure** (`ok: false`):
   > Sync failed (push). Errors:
   > - {each error on its own line}

---

## Pull Flow

1. Run the sync script via the Bash tool:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" pull
   ```
2. After the script completes, read `{pm_state_dir}/sync-status.json` using the Read tool.
3. Parse the JSON and display results:

   **On success** (`ok: true`):
   > Sync complete (pull). {downloaded} files downloaded, {deleted} deleted.

   **On failure** (`ok: false`):
   > Sync failed (pull). Errors:
   > - {each error on its own line}

4. If `downloaded > 0`, add: "Run `/pm:refresh` to check for staleness in updated files."

---

## Status Flow

1. Read `{pm_state_dir}/sync-status.json` using the Read tool.
2. If the file does not exist: "No sync has been run yet. Use `/pm:sync push` or `/pm:sync pull`." and stop.
3. Parse the JSON and display a formatted summary:

   ```
   Last sync: {lastSync, formatted as readable date/time}
   Mode: {mode}
   Uploaded: {uploaded}
   Downloaded: {downloaded}
   Deleted: {deleted}
   Status: {ok ? "OK" : "Failed"}
   ```

   If `errors` is non-empty, append:
   ```
   Errors:
   - {each error}
   ```

4. Query server-side stats through the sync script (if credentials are configured):

   **Pre-conditions:**
   - `~/.pm/credentials` exists and contains a `token` field
   - `.pm/config.json` contains a `projectId` field
   - `.pm/config.json` contains a `serverUrl` field (or default to `https://api.productmemory.io`)

   If either `credentials` or `projectId` is missing, skip this step — show local stats only.

   **Execution:**

   Run via the Bash tool:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js" status
   ```

   `kb-sync.js` owns auth, headers, API versioning, and endpoint details. Read the script output or its persisted status payload — do not duplicate transport logic in this skill.

   **On success** (valid JSON response with `fileCount`, `totalBytes`, `lastUpdated`):

   Append server-side stats below the local summary:

   ```
   Server: {fileCount} files, {totalBytes formatted} synced
   Last updated: {lastUpdated formatted as readable date/time}
   ```

   Format `totalBytes` as human-readable: bytes for < 1 KB, KB with one decimal for < 1 MB, MB with one decimal otherwise.

   **On failure** (network error, invalid JSON, missing fields, or credentials/project config missing):

   Append a fallback note:

   ```
   Server unreachable — showing local data only.
   ```

   Do not show raw error details to the user.

---

## Constraints

- This skill only runs the sync script and reports results. It does not modify pm/ files directly.
- The `kb-sync.js` script handles all server communication, manifest diffing, and file writes, including server-side status lookups.
- Never display raw JSON to the user. Always format the output as readable text.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just copy files manually" | Sync tracks manifests, handles conflicts, and updates status. Manual copy loses state. |
| "Nothing changed, skip sync" | The server might have changes from another session. Pull checks both directions. |
| "Push failed, I'll try again later" | Sync failures have a cause. Diagnose before retrying — repeated failures corrupt manifests. |

## Before Marking Done

- [ ] Sync completed successfully (ok: true in status)
- [ ] Results displayed to user (files uploaded/downloaded/deleted)
- [ ] Errors surfaced if any occurred
