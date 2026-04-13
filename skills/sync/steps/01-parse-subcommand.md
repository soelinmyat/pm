---
name: Parse Subcommand
order: 1
description: Resolve whether the user wants push, pull, status, or usage help
---

## Goal

Determine which sync action should run and stop early with usage guidance when the request is incomplete or invalid.

## How

Parse the user's argument after `/pm:sync`. Extract the first word as the subcommand.

| Argument | Action |
|---|---|
| `push` | Run push flow |
| `pull` | Run pull flow |
| `status` | Run status flow |
| _(empty or unrecognized)_ | Show usage: "`/pm:sync push` | `pull` | `status`" and stop |

Persist the selected route in the working context so later steps can skip cleanly when they are not the active action.

## Done-when

One concrete route (`push`, `pull`, or `status`) has been selected, or the skill has stopped after showing usage.
