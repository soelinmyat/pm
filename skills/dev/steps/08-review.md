---
name: Review
order: 8
description: Run the routed code-review gate and fresh full verification against current HEAD
phase: review
requires:
  - worker-contract.md
gates:
  - review
  - verification
required_evidence:
  - review
  - test
requires_commit: true
allowed_modes:
  - inline
  - delegated
result_schema: phase-result-v1
---

## Goal

Complete the routed code review, fix verified findings, run fresh full verification, and leave machine-checkable evidence current for HEAD.

## How

1. Confirm the integrated diff, current HEAD, `session.routing.review_mode`, acceptance criteria, and existing Design Critique/QA gate rows. Use the recorded route; do not recompute it from kind or size. Contract drift invalidates any conditional lens skip.
2. For `session.routing.review_mode: full`, invoke `pm:review`; the six-lens invocation is mandatory. For `session.routing.review_mode: code-scan`, run a bounded bug, edge-case, reuse, quality, and efficiency scan. Never replace either path with an informal self-review.
3. Auto-fix verified high-confidence findings. Test after each fix. Surface product/design decisions instead of guessing, and cap repeated fix/review attempts at three.
4. Run the full project test suite fresh after the final mutating commit. Read the output and require zero failures. Earlier test output is not current verification evidence.
5. Write review and verification reports outside canonical JSON. Update the gate manifest with current `review` and `verification` rows, including the lenses that actually ran.
6. If earlier evidence must be recertified at the final commit, rerun the relevant check and write a phase-keyed evidence JSON file. Call `dev-session recertify --evidence <path>`; a bare commit or timestamp is never sufficient. If relevant files changed, rerun the gate instead of recertifying it.
7. Run `scripts/dev-gate-check.js` for current HEAD. Return a strict phase result containing current commit plus passing `review` and `test` evidence, then record it through the runner. Canonical `session.json` owns phase evidence; `gates.json` is the downstream checker manifest. Do not invent prose gate fields in either file.

## Done-when

- The routed review path completed and verified findings were resolved or explicitly blocked.
- The full suite passed after the last mutation.
- Review and verification evidence are current for HEAD, and the shared gate checker passes.

**Advance:** record the result and proceed to Step 09 (Ship), as selected by the runner.
