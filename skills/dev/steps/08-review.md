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

1. Confirm the integrated diff, current HEAD, `session.routing.review_mode`, acceptance criteria, and existing Design Critique/QA gate rows. Use the recorded route; do not recompute it from kind or size. The delivery gate independently binds the Review target mode and exact completed lens coverage back to this routing decision; contract drift invalidates the report.
2. Invoke `pm:review` with the recorded mode. `full` targets all six logical lenses; `code-scan` targets bug, edge, reuse, quality, and efficiency. Physical reviewer count adapts, but applicable logical coverage and structured verdicts are mandatory. Never replace either path with an informal self-review.
3. Follow the canonical report's policy. Auto-fix only `auto_fix_eligible` findings after verifying the code. Surface disputes and product/design decisions instead of guessing, and cap complete fix/review rounds at three.
4. Run the full project test suite fresh after the final mutating commit. Read the output and require zero failures. Earlier test output is not current verification evidence.
5. Keep Review's checked `review/report.json` and `review/report.html` as the review evidence; write full-suite verification separately. Update the gate manifest with current `review` and `verification` rows, including applicable logical lenses and the HTML report artifact.
6. If earlier evidence must be recertified at the final commit, rerun the relevant check and write a phase-keyed evidence JSON file. Call `dev-session recertify --evidence <path>`; a bare commit or timestamp is never sufficient. If relevant files changed, rerun the gate instead of recertifying it.
7. Re-run `scripts/review-check.js --from-report --report <review/report.json>` and `scripts/dev-gate-check.js` for current HEAD. Return a strict phase result containing current commit plus passing `review` and `test` evidence, then record it through the runner. Canonical `session.json` owns phase evidence; `gates.json` is the downstream checker manifest. Do not invent prose gate fields in either file.

## Done-when

- The routed review path completed and verified findings were resolved or explicitly blocked.
- The full suite passed after the last mutation.
- Review and verification evidence are current for HEAD, and the shared gate checker passes.

**Advance:** record the result and proceed to Step 09 (Ship), as selected by the runner.
