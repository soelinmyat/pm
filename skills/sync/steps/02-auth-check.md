---
name: Auth Check
order: 2
description: Verify credentials before any push or pull operation
---

## Goal

Block remote sync actions from running without the credentials they require.

## How

Only run this step for `push` and `pull`. If the selected route is `status`, skip this step.

Before running push or pull, check for credentials:

1. Use the shell to test whether `~/.pm/credentials` exists:
   ```bash
   test -f ~/.pm/credentials && echo "EXISTS" || echo "MISSING"
   ```
2. If `MISSING`: tell the user "No auth token found. Run `/pm:setup` to log in first." and stop.
3. If `EXISTS`: proceed to the selected subcommand step.

## Done-when

Either credentials are confirmed for a remote sync action, the route has been skipped because this is `status`, or the skill has stopped on missing auth.
