---
name: Evaluate
order: 3
description: Run deterministic evidence checks and independent rubric reviews
---

## Goal

Produce evidence-cited, ownership-correct findings and six dimension scores without context bias.

## How

1. Run deterministic evidence checks before visual judgment. A stale route, missing capture, hash mismatch, structural artifact failure, overflow, inaccessible landmark, or missing print output is a finding or blocker—not something a reviewer may waive.
2. Evaluate the mode’s six scored dimensions from `evidence-contract.md`. Scores are anchored integers from 1 to 5 and require a short evidence-based rationale; do not score style preference as correctness.
3. Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-reviewer.md`. Run that Primary review with route context, acceptance criteria, captures, normalized accessibility/DOM audits, and project design principles. Record its exact structured input, execution identity, scores, and findings in `reviews.json`.
4. Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-fresh-eyes.md`. Run that Fresh Eyes review in a distinct context and invocation. It receives only the same subject/job brief, the same project design principles, and the same rendered capture IDs as Primary—never audits, acceptance criteria, prior findings, implementation rationale, or review history. A separate delegated context is preferred. A same-runtime fallback is valid only when the runtime creates a genuinely fresh context and invocation; continuing in the current conversation is blocked, not isolated. Bind the exact shipped reviewer instruction bytes through the perspective-specific prompt profile and hash.
5. Create exactly one Primary/Fresh Eyes pair for each review round. Their brief, principles, and captures match; their prompt, payload, context, invocation, and conditional result shapes remain distinct. Reused identities or one result relabeled as both perspectives cannot certify.
6. Reconcile every reviewer finding into exactly one final report finding. Deduplicate by subject, canonical region/rule, and overlapping route coverage; preserve priority, owner, or objective/craft disagreements explicitly. Final evidence is the union of reviewer evidence and any decision evidence, and final severity cannot be lower than the most severe source finding.
7. Assign each finding to `design-critique`, `qa`, or `review`. Keep non-design evidence for handoff, but do not use it to expand this gate’s pass criteria.
8. Use deterministic finding IDs from the contract. Each finding must cite capture/evidence IDs, state priority P0–P3, explain user impact, and give a concrete remediation.
9. Calibrate objective defects separately from subjective craft. An objective defect violates acceptance criteria, accessibility, interaction behavior, viewport fit, or an established product rule and may be P0/P1 when its demonstrated impact warrants it. A subjective craft concern is a reasoned judgment about composition, rhythm, tone, or polish; it defaults to P2/P3 and cannot block solely on taste. If missing product intent prevents classification, record the uncertainty or hand it to the owning gate instead of escalating severity.

## Done-when

- All applicable dimensions have anchored scores and evidence rationales.
- Primary and Fresh Eyes passes are complete and merged without hiding disagreements.
- `reviews.json` has one hash-bound pair per round, and Fresh Eyes has no prohibited context.
- Every finding has stable identity, evidence, priority, owner, impact, and remediation.
- Objective defects and subjective craft concerns have independently justified severity; preference alone created no blocking finding.

**Advance:** proceed to Step 4 (Resolve).
