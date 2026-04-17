---
name: task
description: "Use when the user wants a lightweight capture that skips groom/RFC — file a task, add a chore, capture a todo, bump version, small cleanup. Writes a backlog item with `kind: task` that `pm:dev` routes straight to implementation."
---

# pm:task

## Purpose

Capture a lightweight chore or todo into the backlog in one pass — no grooming, no RFC. The resulting item has `kind: task` and is picked up by `pm:dev` on a lean path (skips groom/RFC/simplify, still runs `pm:review`). Use this when PM is the single tool on a solo or small project and the work is too small for the feature lifecycle.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER LET A SMALL TASK FALL THROUGH THE CRACKS.** If the user hands you a chore worth doing later, it goes into the backlog before the conversation moves on. Lightweight capture is the whole point — don't gate it behind grooming ceremony.

## When NOT to use

- **Feature work** — anything user-visible with product decisions, unknowns, or cross-layer impact. Use `pm:groom` instead.
- **Something broken** — bugs, regressions, unexpected behavior. Use `pm:bug` — the shape is the same plus an observed/expected/reproduction slot.
- **One-off question or answer** that doesn't need tracking. Just answer it inline.
- **Product signals or evidence** (customer feedback, competitor observations). Use `pm:note`.

**Workflow:** `task` | **Telemetry steps:** `capture`, `enrich`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/task/steps/` in numeric filename order. If `.pm/workflows/task/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I should ask a product question before writing the file."** No — capture is one pass. If the scope is unclear enough to need discovery, this is feature work; route to `pm:groom`.
- **"I'll add a `size: M` because it looks bigger than a chore."** Don't. Tasks are kind-first; `pm:dev` lets kind override size. If it's truly M+ feature work, route to `pm:groom` instead.
- **"Let me write an RFC-style acceptance criteria list."** That's groom/RFC territory. Task capture is outcome-only — one sentence of what changes when it ships.

## Escalation Paths

- **Work is larger than a chore:** "This looks like feature work — outcomes are unclear and it spans multiple concerns. Want to switch to `/pm:groom` so we can scope it properly?"
- **User describes something broken:** "This sounds like a bug report rather than a chore. Want to use `/pm:bug` so we capture observed/expected/reproduction?"
- **Title too vague:** "I can save it, but I need one concrete sentence for the outcome first. What changes when this ships?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is borderline feature work, but capturing as a task is faster" | Fast capture is only useful if downstream routing is right. `pm:dev` will skip groom/RFC for task-kind items — borderline features end up under-scoped. Route to `pm:groom`. |
| "I'll put a placeholder outcome and fill it in later" | Outcomes rot unwritten. One sentence now is cheaper than archaeology later. |
| "I should hand-edit the frontmatter for full control" | The helper enforces the schema. Manual writes risk drift from validator expectations. |

## Before Marking Done

- [ ] Backlog file written at `{pm_dir}/backlog/{slug}.md` with `kind: task`
- [ ] File passes `npm run validate`
- [ ] User saw the one-line confirmation with slug + id + next-step hint
