---
name: task
description: "Use when the user wants a lightweight capture that skips groom/RFC — file a task, add a chore, capture a todo, bump version, small cleanup. Writes a backlog item with `kind: task` that `pm:dev` routes straight to implementation."
---

# pm:task

Capture a lightweight chore or todo into the backlog in one pass — no grooming, no RFC. The item gets `kind: task` and `pm:dev` picks it up on a lean path (skips groom/RFC, still runs `pm:review`). Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions, and `${CLAUDE_PLUGIN_ROOT}/references/capture.md` for the `capture-backlog.js` contract and task-vs-bug-vs-groom routing. Extract the title (ask if missing) and a one-sentence outcome (fall back to the title if the user declines), run the helper with `--kind task`, confirm with slug + id + a `/pm:dev {slug}` hint, then offer optional priority/label enrichment.

**Workflow:** `task`

## Hard rules

- Capture is one pass — if the scope needs discovery it is feature work; route to `pm:groom`. Something broken routes to `pm:bug`; a product signal routes to `pm:note`.
- Write through `capture-backlog.js` — it enforces the schema and refuses to overwrite an existing slug. Don't hand-edit frontmatter or add fields like `size`; `pm:dev` lets `kind` override size.
- The written file must pass `node scripts/validate.js` (`npm run validate`).

## Escalation Paths

- **Work is larger than a chore:** "This looks like feature work — outcomes are unclear and it spans multiple concerns. Want to switch to `/pm:groom` so we can scope it properly?"
- **User describes something broken:** "This sounds like a bug report rather than a chore. Want to use `/pm:bug` so we capture observed/expected/reproduction?"
- **Title too vague:** "I can save it, but I need one concrete sentence for the outcome first. What changes when this ships?"
