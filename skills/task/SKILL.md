---
name: task
description: "Use when the user wants a lightweight capture that skips groom/RFC — file a task, add a chore, capture a todo, bump version, small cleanup. Writes a backlog item with `kind: task` that `pm:dev` routes straight to implementation."
---

# pm:task

## Purpose

Capture a lightweight chore or todo into the backlog in one pass — no grooming, no RFC. The item gets `kind: task` and `pm:dev` picks it up on a lean path (skips groom/RFC, still runs `pm:review`). Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions, and `${CLAUDE_PLUGIN_ROOT}/references/capture.md` for the `capture-backlog.js` contract and task-vs-bug-vs-groom routing. Extract the title (ask if missing) and a one-sentence outcome (fall back to the title if the user declines), run the helper with `--kind task`, confirm with slug + id + a `/pm:dev {slug}` hint, then offer optional priority/label enrichment.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER OVERWRITE AN EXISTING CAPTURE.**

## When NOT to use

Do not use for regressions (`pm:bug`), product evidence (`pm:note`), or feature discovery (`pm:groom`).

**Workflow:** `task` | **Telemetry steps:** `capture`, `validate`

## Hard rules

- Capture is one pass — if the scope needs discovery it is feature work; route to `pm:groom`. Something broken routes to `pm:bug`; a product signal routes to `pm:note`.
- Write through `capture-backlog.js` — it enforces the schema and refuses to overwrite an existing slug. Don't hand-edit frontmatter or add fields like `size`; `pm:dev` lets `kind` override size.
- The written file must pass `node scripts/validate.js` (`npm run validate`).

## Escalation Paths

- **Work is larger than a chore:** "This looks like feature work — outcomes are unclear and it spans multiple concerns. Want to switch to `/pm:groom` so we can scope it properly?"
- **User describes something broken:** "This sounds like a bug report rather than a chore. Want to use `/pm:bug` so we capture observed/expected/reproduction?"
- **Title too vague:** "I can save it, but I need one concrete sentence for the outcome first. What changes when this ships?"

## Red Flags — Self-Check

- **"I can hand-edit the frontmatter."** Stop and use `capture-backlog.js` for atomic collision-safe writing.
- **"This feature can be called a task."** Route unclear outcomes or multi-concern work to `pm:groom`.
- **"The title is a sufficient outcome."** Include the requested change in one testable sentence.
- **"Validation can happen later."** Validate the saved artifact before confirming capture.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is only a chore." | A chore still needs stable identity, kind, and outcome. |
| "The slug probably does not exist." | The helper must prove there is no collision. |

## Before Marking Done

- [ ] The backlog artifact was saved atomically with `kind: task`.
- [ ] The user-requested outcome and routing are accurate.
- [ ] Schema validation and overwrite protection passed.
