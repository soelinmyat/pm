---
name: Push
order: 5
description: Push knowledge base changes to the remote and report the outcome
---

## Goal

Upload local knowledge base changes and report the outcome in user-facing terms.

## How

Run this step only when the selected route is `push`. Otherwise skip it. The default `sync` route already pulled and pushed in Step 4.

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

If `uploaded === 0`:
> Already up to date. Nothing to push.

**On failure** (`ok: false`):
> Push failed. Error: {error message}

Never display raw JSON to the user.
