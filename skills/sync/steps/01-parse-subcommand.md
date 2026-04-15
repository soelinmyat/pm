---
name: Parse Subcommand
order: 1
description: Resolve whether the user wants setup, push, pull, status, or usage help
---

## Goal

Determine which sync action should run. If no backend is configured and the user didn't ask for setup, route them to setup automatically.

## How

Parse the user's argument after `/pm:sync`. Extract the first word as the subcommand.

| Argument | Action |
|---|---|
| `setup` | Run setup flow |
| `push` | Run push flow |
| `pull` | Run pull flow |
| `status` | Run status flow |
| _(empty or unrecognized)_ | Check backend config, then route |

### When no subcommand is given

Read `.pm/config.json` and check `sync.backend`:

- **If `sync.backend` is not set or is `"none"`:** Tell the user no sync is configured and route directly to the setup step (Step 2).
- **If `sync.backend` is `"git"`:** Show usage:

  ```
  /pm:sync push    — push KB changes to remote
  /pm:sync pull    — pull KB changes from remote
  /pm:sync status  — show sync state
  /pm:sync setup   — reconfigure sync
  ```

### When push/pull/status is requested but no backend is configured

If the user asked for `push`, `pull`, or `status` but `sync.backend` is not set or is `"none"`:

> No sync backend configured yet. Let me set that up first.

Then route to Step 2 (Setup).

Persist the selected route in the working context so later steps can skip cleanly when they are not the active action.

## Done-when

One concrete route (`setup`, `push`, `pull`, or `status`) has been selected, or the skill has stopped after showing usage.

**Advance:** proceed to Step 2 (Setup).
