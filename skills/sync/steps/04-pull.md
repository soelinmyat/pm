---
name: Pull / Sync
order: 4
description: Pull knowledge base changes, or run the default bidirectional sync route
---

## Goal

Download remote knowledge base changes, or run default bidirectional sync, and report the outcome clearly.

## How

Run this step when the selected route is `pull` or `sync`. Otherwise skip it.

### Git backend

For explicit `pull`, run the sync script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" pull
```

For default bidirectional `sync`, run the sync script once:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" sync
```

The selected command is the action-specific authority grant (`pull_knowledge_base`
or `sync_knowledge_base`). After it completes, read
`{pm_state_dir}/sync-status.json`. Treat the operation as successful only when
`effect_state` is `verified` and `verified_receipt` is present. For `blocked` or
`ambiguous`, show `recovery` and do not retry blindly.

Parse the JSON and display:

**On success** (`ok: true`):

If route is `pull` and `downloaded > 0`:
> Pulled {downloaded} files.

If route is `pull` and `downloaded === 0`:
> Already up to date. Nothing to pull.

If route is `sync`:
- If `downloaded > 0`, display: `Pulled {downloaded} files.`
- If `uploaded > 0`, display: `Pushed {uploaded} files.`
- If both are `0`, display: `All synced. Nothing to pull or push.`

**On failure** (`ok: false`):
- If route is `pull`, display: `Pull failed. Error: {error message}`
- If route is `sync`, display: `Sync failed. Error: {error message}`

If the route is `sync`, this step already attempted the full bidirectional operation. Step 5 must skip.

Never display raw JSON to the user.

## Done-when

Pull or bidirectional sync has one durable effect identity and verified receipt
or recovery state, and partial uploaded/downloaded counts are visible without raw JSON.

**Advance:** proceed to Step 5 (Push); it skips for pull and completed bidirectional routes.
