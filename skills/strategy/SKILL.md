---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose

The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

## Iron Law

**NEVER WRITE STRATEGY FROM THIN AIR.** Strategy must be grounded in explicit answers, existing evidence, or both. If key inputs are missing, surface the gap instead of inventing certainty.

**Workflow:** `strategy` | **Telemetry steps:** `prereq-check`, `detect-existing`, `interview`, `write-strategy`.

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

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I already know the positioning, I can draft the rest myself."** Strategy only works when assumptions are explicit and confirmed.
- **"Landscape context is optional, so I don’t need to mention the gap."** Optional does not mean irrelevant. Missing market context should be surfaced, not silently ignored.
- **"The existing strategy file is probably still fine."** Existing docs drift. Reuse them selectively, but verify what changed before carrying them forward.
- **"Short answers mean the user doesn’t care about strategy depth."** Short answers are still inputs. Accept them and write clearly instead of trying to interrogate the user into verbosity.

## Escalation Paths

- **User wants feature scoping, not product direction:** "This sounds like feature discovery rather than strategy. Want to switch to `/pm:groom` instead?"
- **User has no answers yet and wants to think first:** "We can pause strategy writing and use `/pm:think` to pressure-test the core idea before locking positioning."
- **Landscape context is missing and the user wants evidence first:** "Want to run `/pm:research landscape` before we finish the strategy so the positioning answers are grounded in market context?"

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
