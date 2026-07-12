---
name: Resolve review blockers
order: 4
description: Apply safe fixes or explicit decisions and create a complete new review round after mutation
requires:
  - ../references/evidence-contract.md
---

## Goal

Resolve Review-owned blockers without guessing through disputes, broadening scope, or reusing stale evidence.

## How

1. Auto-fix only IDs in `auto_fix_eligible`: Review-owned, confidence 80+, `fix_kind: mechanical`, non-disputed, and not decision-required. Verify the cited code and evidence before editing.
2. For behavioral fixes, product/design decisions, disputed signals, or ambiguous remediation, stop automation. Record an explicit human decision when supplied; never manufacture approver identity or rationale.
3. Apply one coherent fix set, run each finding's verification command, then the relevant focused tests. Commit the source fix without bypassing hooks.
4. Any mutation invalidates the round. Generate a new target at the new HEAD with the same run ID, incremented round, and `--prior-report`; re-run every applicable logical lens across the whole diff.
5. Do not mark prior findings resolved by editing old results. Resolution is demonstrated by their absence or changed evidence in the complete next round, with the prior report retained.
6. Stop at round 3. Preserve a blocked report and ask for direction if Review-owned blockers or disagreement remain.

## Done-when

- No safe automatic fix remains unattempted without a recorded reason.
- Every mutation has current tests, a commit, and a complete new target/result wave.
- Disputes/decisions and round-cap outcomes are explicit and durable.

**Advance:** proceed to Step 5 (Publish report).

