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

1. Check `review_round` against `iteration_cap` before any edit. At the cap, preserve the blocked report, do not mutate source, and ask the user for direction. Otherwise, auto-fix only IDs in `auto_fix_eligible`: Review-owned, confidence 80+, `fix_kind: mechanical`, non-disputed, and not decision-required. Verify the cited code and evidence before editing.
2. For behavioral fixes, product/design decisions, disputed signals, or ambiguous remediation, stop automation. Record an explicit human decision when supplied; never manufacture approver identity or rationale. Regenerate the mutable draft after a decision, but do not finalize the round yet.
3. After all same-round decisions are recorded, finalize, render, and validate the current non-passing `round-{N}/report.json` and `report.html` while its target still matches HEAD. These files become immutable evidence for the next round.
4. Apply one coherent fix set, run each finding's verification command, then the relevant focused tests. Commit the source fix without bypassing hooks.
5. Any mutation invalidates the round. Generate a new target in a new `round-{N}/` directory at the new HEAD with the same run ID, incremented round, and `--prior-report` pointing to immutable `round-{N-1}/report.json`; re-run every applicable logical lens across the whole diff.
6. Do not overwrite prior round files or mark findings resolved by editing old results. Resolution is demonstrated by their absence or changed evidence in the complete next round.
7. Stop at round 3. Preserve a blocked report and ask for direction if Review-owned blockers or disagreement remain.

## Done-when

- No safe automatic fix remains unattempted without a recorded reason.
- Every mutation has current tests, a commit, and a complete new target/result wave.
- Disputes/decisions and round-cap outcomes are explicit and durable.

**Advance:** proceed to Step 5 (Publish report).
