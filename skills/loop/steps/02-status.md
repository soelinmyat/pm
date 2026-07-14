---
name: Status
order: 2
description: Render the git-backed loop board without mutating state
---

## Goal

Show the current loop board derived from durable PM files so the user can see what a scheduler would consider.

## How

Run this from the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-board.js --project-dir "$PWD" --format summary
```

Use `--format json` only when the user explicitly asks for raw JSON. Add `--include-local` only when the user asks to see local session context; local rows must be labeled as local-only and must not be described as claimable cross-machine work.

Render the board as the script reports it, including any blockers and active leases. Do not manually scan `.pm/` to infer eligibility. If no rows are present, tell the user there is no loop-eligible work yet and point them to `/pm:task`, `/pm:bug`, `/pm:groom`, or `/pm:dev` depending on what they are trying to do.

## Done-when

The board summary reflects the canonical classifier, distinguishes durable from local-only rows, and explains blockers or the empty state without mutation.

Offer `/pm:board` for a richer live view or the owning capture/design/dev skill for the next action.
