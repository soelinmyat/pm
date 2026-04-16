---
type: backlog
id: PM-44
title: Skill step flow guidance
outcome: Every skill guides the user forward at every step transition and ends with a summary — no manual "continue" prompts needed
status: done
prs:
  - "#270"
priority: high
labels:
  - ux
  - infrastructure
prd: backlog/skill-step-flow-guidance.md
rfc: rfcs/skill-step-flow-guidance.html
linear_id: PM-44
thinking: null
research_refs: []
created: 2026-04-14
updated: 2026-04-14
---

## Outcome

After this ships, every skill automatically advances between steps without stalling. The user never needs to type "continue" to keep a workflow moving. When a skill finishes, it shows what was accomplished and offers the logical next action.

## Problem & Context

> Users experience dead air between steps in multi-step skills, forcing manual "continue" prompts to keep the workflow moving.

- The plugin has 15 skills with 65 step files
- 6-8 skills already offer next-step guidance in their final steps, but inconsistently
- Mid-step transitions have no convention — some steps auto-advance, others stall
- Final steps vary: some show summaries, some just stop
- This is basic wizard/stepper UX that users expect to work without friction

## Scope

In-scope:
- Mid-step flow guidance: every step file explicitly advances to the next step
- Final-step completion pattern: every skill's last step shows a summary + next action
- Convention in `skill-runtime.md`: codify the step-transition and completion patterns

Out-of-scope:
- Step loader/execution engine changes: not needed — this is content/convention, not infrastructure
- Interactive choice menus at mid-step transitions: overkill — mid-steps should auto-advance
- Rewriting existing step logic: only adding flow guidance, not refactoring what steps do

10x filter result: table-stakes

## User Flows

No visual artifacts — workflow feature (convention changes across step files).

## Wireframes

No wireframes — feature is non-visual.

## Competitive Context

No direct competitors handle "skill step flow" the same way. The closest analogue is wizard/stepper UX in product tools (Stripe onboarding, Vercel deploy flows), where every step ends with a clear "Next" action and completion shows a summary.

| Capability | Wizard/stepper UX norm | Current plugin behavior |
|---|---|---|
| Mid-step auto-advance | Always advances automatically | Inconsistent — some stall |
| Final summary | Shows what was done | 6-8 of 15 skills do this |
| Next action offer | Clear CTA at completion | Inconsistent format and presence |

**Handling decision:** Table-stakes. Users expect guided flows to auto-advance. Not building this is a bug, not a strategy choice.

## Technical Feasibility

Feasible. The codebase already has partial patterns in 6-8 skills. The change is additive — add flow guidance text to existing step files and codify the convention in `skill-runtime.md`. No architectural changes needed.

- **Build on:** Existing `Done-when` sections in all 65 step files; existing next-step patterns in groom, rfc, dev, think, strategy, ingest, ideate
- **Build new:** Convention section in `skill-runtime.md`; standardized flow guidance in step files that lack it
- **Risks:** None significant — purely additive content changes

## Review Summary

- Intake: completed (from-scratch entry, codebase available)
- Strategy check: skipped (quick tier)
- Research: inline assessment (no prior art, table-stakes pattern)
- Scope: confirmed (3 in-scope items, 3 out-of-scope items)

## Resolved Questions

None — scope is straightforward.

## Next Steps

Ready for engineering? Run `pm:dev skill-step-flow-guidance` to generate the RFC and begin implementation.
