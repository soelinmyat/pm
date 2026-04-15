---
name: Parse Subcommand
order: 1
description: Resolve the sync action — auto-sync by default, explicit subcommands as overrides
---

## Goal

Determine which sync action should run. Bare `/pm:sync` should just work — set up if needed, sync if ready.

## How

Parse the user's argument after `/pm:sync`. Extract the first word as the subcommand.

| Argument | Action |
|---|---|
| `setup` | Run setup flow |
| `push` | Run push flow only |
| `pull` | Run pull flow only |
| `status` | Run status flow |
| _(empty or unrecognized)_ | Auto-detect (see below) |

### When no subcommand is given (default)

Read `.pm/config.json` and check `sync.backend`:

- **If `sync.backend` is not set or is `"none"`:** Route to the setup step (Step 2). No message needed — setup will handle onboarding.
- **If `sync.backend` is `"git"`:** Route to `auto`. This will pull then push in one pass.

### When push/pull/status is requested but no backend is configured

If the user asked for `push`, `pull`, or `status` but `sync.backend` is not set or is `"none"`:

> No sync backend configured yet. Let me set that up first.

Then route to Step 2 (Setup).

Persist the selected route (`auto`, `setup`, `push`, `pull`, or `status`) in the working context so later steps can skip cleanly.

## Done-when

One concrete route has been selected, or the skill has routed to setup for onboarding.

**Advance:** proceed to Step 2 (Setup).
