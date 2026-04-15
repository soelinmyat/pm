---
name: Auth Check
order: 3
description: Verify sync backend is configured before any push or pull operation
---

## Goal

Block sync actions from running without the backend they require.

## How

Only run this step for `push`, `pull`, `status`, and `auto`. If the selected route is `setup`, skip this step.

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

**If backend is `"git"`:** Verify `pm/` is a git repo with a remote:

```bash
test -d pm/.git && git -C pm remote get-url origin 2>/dev/null && echo "OK" || echo "MISSING"
```

If `MISSING`: "pm/ is not set up as a git repo. Run `/pm:sync setup` to configure." and stop.

If `OK`: proceed to the selected subcommand step.

## Done-when

Either the backend is confirmed ready, or the skill has stopped with a clear setup instruction.
