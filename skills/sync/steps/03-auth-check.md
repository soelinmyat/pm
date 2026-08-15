---
name: Auth Check
order: 3
description: Verify sync backend is configured before any push or pull operation
---

## Goal

Block sync actions from running without the backend they require.

## How

Only run this step for `sync`, `push`, `pull`, and `status`. If the selected route is `setup`, skip this step.

### Check sync backend

Read `.pm/config.json` and check `sync.backend`:

```bash
node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('.pm/config.json','utf8'));
    const b = (c.sync || {}).backend || 'none';
    process.stdout.write(b);
  } catch { process.stdout.write('none'); }
"
```

**If backend is `"none"` or missing:** Tell the user "No sync backend configured. Run `/pm:sync setup` first." and stop.

**If backend is `"git"`:** Ask the effect-free sync helper to verify repository,
attached-branch, remote, and upstream state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" status
```

If it reports no repository or remote: "pm/ is not set up as an independent KB
repo. Run `/pm:sync setup` to configure." and stop.

If it reports detached HEAD, stop and relay the instruction to check out a
branch. If it reports no upstream, stop and relay the `git push --set-upstream
<remote> <branch>` or `/pm:sync setup` remediation. Never substitute
`origin/main`.

If `ok: true`: proceed to the selected subcommand step.

**If backend is `"productmemory"`:** Verify config and token:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-pm.js" status
```

If the output has `"ok": false`, surface its `error` field (missing project, missing token, etc.) and tell the user to run `/pm:sync setup`. Then stop. Otherwise proceed to the selected subcommand step.

## Done-when

The selected data route has a configured backend, or execution has stopped with
the helper's exact repair guidance. For the Git backend that means an attached
branch and reachable configured upstream; for productmemory it means project
config plus a resolvable token.

**Advance:** proceed to Step 4 (Pull / Sync); route-specific steps skip cleanly.
