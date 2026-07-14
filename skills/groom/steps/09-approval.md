---
name: Approval
order: 9
description: Record explicit product approval against exact reviewed proposal bytes
phase: approval
applies_to: [quick, standard, full, agent]
required_evidence: [approval]
result_schema: groom-phase-result-v1
---

## Goal

Obtain and record an explicit human product decision for the exact current proposal.

## How

Verify current source/projections, the current quality result, and any tier-routed question review. Quick still requires its schema/handoff/quality integrity checks, but does not invent a full review panel. Ask one direct question: "Approve this proposal for technical design?" Silence, earlier enthusiasm, reviewer verdicts, tracker state, and authority to implement do not count.

On approval, run `groom-session.js approve --approved-by {identity}` and `approval-audit` for the current proposal. Regenerate lifecycle projections and re-run `proposal-check.js`. On requested changes, run `revise`, return to the earliest affected phase, and invalidate old review/approval. On no decision, preserve `awaiting_approval` and stop cleanly.

## Done-when

Either a verified hash/revision-bound approval audit exists for the current proposal or the session is durably paused at `awaiting_approval` without a false approval claim.

**Advance:** after approval, proceed to Step 10 (Handoff).
