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

Verify current source/projections, the current quality result, and the tier-routed question review. For schema-v2 sessions, the `quick` tier must have completed its bounded Review phase; Approval never fabricates a substitute integrity row or moves a draft directly to reviewed. A resumed schema-v1 `quick` session is the one compatibility exception: honor its frozen route, which moves from Draft directly to Approval, and do not invent a Review phase or mutate its historical route. Regenerate projections and run `proposal-check.js --projections`; for schema v2, do not ask for approval while the canonical proposal remains `draft`. For a frozen schema-v1 direct-approval route, use its legacy integrity and approval checks against the exact draft bytes.

Ask one direct question: "Approve this proposal for technical design?" Silence, earlier enthusiasm, reviewer verdicts, tracker state, and authority to implement do not count. On approval, use this exact order: (1) run `groom-session.js approve --approved-by {identity}` against the current route-valid bytes, (2) transition only canonical `lifecycle` from `reviewed` to `approved` for schema v2 or from `draft` to `approved` for the frozen schema-v1 direct-approval route, without changing revision or semantic content, (3) run `approval-audit` so it binds the exact approved bytes and session decision, (4) regenerate projections, and (5) run `proposal-check.js --projections` with the session decision ID/hash. Never create the audit before the approved lifecycle bytes exist. On requested changes, run `revise`, return to the earliest affected phase, and invalidate old review/approval. On no decision, preserve `awaiting_approval` and stop cleanly.

## Done-when

Either a verified hash/revision-bound approval audit exists for the current proposal or the session is durably paused at `awaiting_approval` without a false approval claim.

**Advance:** after approval, proceed to Step 10 (Handoff).
