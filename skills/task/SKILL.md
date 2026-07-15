---
name: task
description: "Use when the user wants a lightweight tracked action that skips Groom and RFC: file a task, add a chore, capture a todo, bump a version, update a dependency, or record a small cleanup. Atomically writes a `kind: task` backlog item with medium/chore defaults and routes it directly to pm:dev. Do not use for regressions, feature discovery, or customer evidence."
---

# pm:task

## Purpose

Capture one bounded chore or todo as a durable backlog item without product-definition ceremony. Task keeps its own medium-priority/chore policy while sharing the atomic backlog transaction with Bug.

## Iron Law

**NEVER OVERWRITE OR DIRECTLY EDIT A CAPTURE.**

## When NOT to use

Use `pm:bug` for broken behavior, `pm:note` for product evidence, and `pm:groom` when the outcome or scope needs discovery. Answer inline when the user wants no durable tracking.

**Workflow:** `task` | **Telemetry steps:** `capture`, `enrich`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.
Read `${CLAUDE_PLUGIN_ROOT}/references/capture.md` for routing and the shared create/enrich receipt contract.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/task/steps/` in numeric filename order. If `.pm/workflows/task/` exists, same-named files there override defaults. Execute each applicable step in order.

## Red Flags — Self-Check

- **"A feature can be called a task to move faster."** Route unclear outcomes and multi-concern work to `pm:groom`.
- **"The title is enough even though it says nothing will change."** Stop and ask for one concrete outcome.
- **"I can patch the Markdown for a small refinement."** Use the helper's hash-guarded enrich action.
- **"The slug probably does not exist."** Stop and use the locked exclusive-create helper to prove capture succeeded.
- **"Validation can happen when Dev starts."** Validate the published bytes before confirming success.

## Escalation Paths

- **Feature-sized work:** "This needs product scoping rather than lightweight capture. I'll route it to `/pm:groom`."
- **Broken behavior:** "This is a regression, so I'll use `/pm:bug` to preserve observed, expected, and reproduction details."
- **Missing actionable outcome:** "What concrete result should be true when this task is done?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is only a chore." | Chores still need safe identity, a concrete outcome, and correct routing. |
| "A direct edit is faster." | It can silently overwrite a concurrent refinement. |
| "Medium is always fine." | It is the default, not a substitute for an explicit user priority. |

## Before Marking Done

- [ ] The artifact was saved through the shared atomic helper with `kind: task`.
- [ ] The user-requested outcome and Task defaults or overrides are accurate.
- [ ] The helper validated the exact published bytes and returned a receipt.
- [ ] Any enrichment used the receipt hash and passed revalidation.
- [ ] The user received the artifact path, ID, and `/pm:dev {slug}` next action.
