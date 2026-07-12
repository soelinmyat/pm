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
3. Run a primary design review with route context, acceptance criteria, captures, accessibility evidence, audits, and project design principles.
4. Run a Fresh Eyes review without prior findings or implementation rationale. It receives only the subject/job description, project design principles, and rendered evidence. When delegation is unavailable, isolate this as a second pass before rereading the primary findings.
5. Merge inline: deduplicate by subject, region, rule, and evidence identity; preserve disagreements; prefer deterministic evidence over unsupported visual inference.
6. Assign each finding to `design-critique`, `qa`, or `review`. Keep non-design evidence for handoff, but do not use it to expand this gate’s pass criteria.
7. Use deterministic finding IDs from the contract. Each finding must cite capture/evidence IDs, state priority P0–P3, explain user impact, and give a concrete remediation.

## Done-when

- All applicable dimensions have anchored scores and evidence rationales.
- Primary and Fresh Eyes passes are complete and merged without hiding disagreements.
- Every finding has stable identity, evidence, priority, owner, impact, and remediation.

**Advance:** proceed to Step 4 (Resolve).
