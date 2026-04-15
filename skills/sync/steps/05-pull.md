---
name: Pull
order: 5
description: Pull knowledge base changes from the remote and report the outcome
---

## Goal

Download remote knowledge base changes and report the outcome clearly.

## How

Only run this step when the selected route is `pull`. Otherwise skip it.

### Git backend

Run the sync script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" pull
```

After it completes, read `{pm_state_dir}/sync-status.json`.

Parse the JSON and display:

**On success** (`ok: true`):

If `downloaded > 0`:
> Sync complete (pull). {downloaded} files updated.
>
> Run `/pm:refresh` to check for staleness in updated files.

If `downloaded === 0`:
> Already up to date. Nothing to pull.

**On failure** (`ok: false`):
> Sync failed (pull). Error: {error message}

Never display raw JSON to the user.

## Done-when

The pull result has been read from `sync-status.json` and shown clearly, including the refresh follow-up when relevant, or the step has stopped on a surfaced failure.

**Advance:** proceed to Step 6 (Status).
