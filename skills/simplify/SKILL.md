---
name: simplify
description: "Use when the user invokes deprecated pm:simplify or asks for the former simplify gate; redirect exactly to pm:review, whose reuse, quality, and efficiency lenses replace it."
---

# pm:simplify (deprecated)

## Purpose

Preserve the deprecated `pm:simplify` command as a thin, unambiguous redirect to `pm:review` without copying its workflow.

## Iron Law

**NEVER DUPLICATE THE REVIEW WORKFLOW.**

## When NOT to use

Do not use this redirect for new review requests; invoke `pm:review` directly. Do not use it for implementation or shipping; route those to `pm:dev` or `pm:ship`.

**Workflow:** `simplify-redirect` | **Telemetry steps:** `redirect`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Redirect

`pm:simplify` was absorbed into `pm:review` in v1.9. Read `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md` and follow it exactly. Its logical lenses include reuse, quality, and efficiency while adapting physical reviewer count. Write the `review` gate row, never a `simplify` row.

## Red Flags — Self-Check

- **"I can restate the old simplify procedure."** Stop and use the current `pm:review` skill instead.
- **"A simplify gate row is harmless."** Use only the canonical `review` gate row.
- **"I should run just three legacy lenses."** Route to Review's complete adaptive lens plan.
- **"The redirect destination is obvious."** Check that both command and skill point to `skills/review/SKILL.md`.

## Escalation Paths

- If the user wants source review, switch to `pm:review` immediately.
- If the user wants code changed, stop and route to `pm:dev`.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The legacy flow is shorter." | A copied flow drifts from Review's evidence contract. |
| "One old gate row preserves compatibility." | Downstream delivery recognizes the Review gate, not a resurrected simplify gate. |

## Before Marking Done

- [ ] The redirect loaded `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`.
- [ ] No legacy workflow or `simplify` gate evidence was produced.
- [ ] The user received Review's actual result and next action.
