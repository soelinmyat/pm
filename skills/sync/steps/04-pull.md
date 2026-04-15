---
name: Pull
order: 4
description: Pull knowledge base changes from the remote and report the outcome
---

## Goal

Download remote knowledge base changes and report the outcome clearly.

## How

Run this step when the selected route is `pull` or `auto`. Otherwise skip it.

### Git backend

Run the sync script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" pull
```

After it completes, read `{pm_state_dir}/sync-status.json`.

Parse the JSON and display:

**On success** (`ok: true`):

If `downloaded > 0`:
> Pulled {downloaded} files.

If `downloaded === 0` **and route is `pull`** (explicit):
> Already up to date. Nothing to pull.

If `downloaded === 0` **and route is `auto`**: say nothing — push step will report the combined result.

**On failure** (`ok: false`):
> Pull failed. Error: {error message}

If the route is `auto` and pull fails, stop — do not proceed to push.

Never display raw JSON to the user.

## Done-when

The pull result has been read from `sync-status.json` and shown clearly (or suppressed in auto mode when nothing changed), or the step has stopped on a surfaced failure.

**Advance:** proceed to Step 5 (Push).
