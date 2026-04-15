---
name: Push
order: 5
description: Push knowledge base changes to the remote and report the outcome
---

## Goal

Upload local knowledge base changes and report the outcome in user-facing terms.

## How

Run this step when the selected route is `push` or `auto`. Otherwise skip it.

### Git backend

Run the sync script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" push
```

After it completes, read `{pm_state_dir}/sync-status.json`.

Parse the JSON and display:

**On success** (`ok: true`):

If `uploaded > 0`:
> Pushed {uploaded} files.

If `uploaded === 0` **and route is `push`** (explicit):
> Already up to date. Nothing to push.

If `uploaded === 0` **and route is `auto`**: skip this message.

**On failure** (`ok: false`):
> Push failed. Error: {error message}

### Auto-mode combined report

When the route is `auto` and both pull and push succeeded with nothing to transfer in either direction, display a single line:

> All synced. Nothing to push or pull.

When the route is `auto` and at least one direction transferred files, the individual pull/push messages (from steps 4 and 5) are sufficient — no extra summary needed.

Never display raw JSON to the user.

## Done-when

The push result has been read from `sync-status.json` and shown clearly, or the combined auto-sync result has been reported.

**Advance:** proceed to Step 6 (Status).
