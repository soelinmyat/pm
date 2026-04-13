---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose

The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

**Workflow:** `strategy` | **Telemetry steps:** `prerequisite-detection`, `interview`, `write-strategy`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/strategy/steps/` in numeric filename order. If `.pm/workflows/strategy/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**When NOT to use:** Quick strategic questions ("who's our ICP?") — just read `{pm_dir}/strategy.md`. Feature-level scoping (use groom). Market research without strategy framing (use research).

## Resume

Before starting, check if `{pm_dir}/strategy.md` exists.

If it exists, read it and say:
> "Found existing strategy (last updated: {date}). Update it, or start fresh?"

If starting fresh, confirm before overwriting.

## Interaction Pacing

- **Prefer multiple-choice** when there is a natural set of options.
- **Accept short answers.** Do not interrogate — if the user gives a brief answer, move on.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Strategy is obvious, skip the interview" | "Obvious" strategies have unexamined assumptions. The interview takes 10 minutes and catches blind spots every time. |
| "We already have a strategy doc" | Strategy docs drift. If it hasn't been reviewed in 30 days, it's a historical document, not a strategy. |
| "Market hasn't changed" | Markets change quarterly. Your awareness of changes lags by months. Check. |
| "Non-goals slow us down" | Non-goals are the fastest decisions you'll make. They prevent weeks of wasted grooming on out-of-scope ideas. |

## Before Marking Done

- [ ] `{pm_dir}/strategy.md` written or updated with current date
- [ ] ICP, value prop, and priorities all present
- [ ] Non-goals explicitly listed
- [ ] User confirmed the strategy captures their positioning
