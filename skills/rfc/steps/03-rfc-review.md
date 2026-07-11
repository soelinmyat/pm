---
name: RFC Review
order: 3
description: Run structured architecture, testing, and maintainability review against one artifact hash
phase: review
requires:
  - ../references/review-contract.md
  - ../references/cross-cutting-reviewers.md
  - ../../dev/test-layers.md
required_evidence:
  - review
allowed_modes:
  - inline
  - delegated
  - headless
result_schema: rfc-phase-result-v1
---

## Goal

Produce a technically reviewed RFC with all blocking findings resolved and enter the human awaiting approval (`awaiting_approval`) boundary without writing approval state.

## How

1. Read the canonical artifact identity and verify the sidecar/HTML binding before dispatch. Reviewers read the current RFC, proposal, relevant repository instructions, and their single lens contract—not the entire workflow.
2. Cover the three mandatory lenses from `review-contract.md`: `architecture-risk`, `test-strategy`, and `maintainability`. One capable reviewer may cover all lenses for a cohesive RFC; use independent parallel reviewers when lens isolation reduces correlated misses. For multi-issue RFCs, add only the cross-cutting integration/scope lenses justified by real dependencies.
3. Require the strict verdict object from every lens. Deduplicate findings by evidence and affected contract. Do not infer `pass` from praise or silence.
4. Run the **layered artifact gate**: Decision Brief quality and decision-readiness, Execution Contract completeness, appendix separation, and Contract/prose consistency.
5. Fix blocking findings. Preserve advisory notes with role/lens attribution. Regenerate the sidecar whenever mirrored HTML data changes, recompute the hash, and commit the artifact pair together.
6. Re-run every affected lens against the new artifact. Maximum two fix/review rounds; unresolved blocking findings produce a structured blocker.
7. Run the sidecar validator once more. Record the final artifact identity, passing `review` evidence, and all three structured lens verdicts.
8. The runner advances to approval as `status: awaiting_approval`. Do not update RFC frontmatter to approved, proposal status to planned, Linear, loop cards, or implementation state.
9. When `PM_LOOP_WORKER=1`, skip proposal/backlog/approval writes, atomically return `needs-approval` with the reviewed document through `PM_LOOP_RESULT_FILE`, and stop. Never self-approve.

## Done-when

- All required review lenses return `pass` with no blocking findings against the same current artifact hash.
- The final HTML/sidecar pair validates and any review fixes are committed together.
- The review result is recorded and the session is `awaiting_approval`.
- No human-approval or downstream external state has been written.

**Advance:** proceed to Step 04 (RFC Approval) and wait for the explicit human decision.
