---
id: quality-review-repeated-run-variance
title: review quality evaluation — repeated-run-variance
status: ready
tier: full
tags:
  - review
  - repeated-run-variance
  - quality-evaluation
---

Role: PM agent executing the repeated-run-variance quality case for pm:review.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:review was used.
- The response accounts for the staged repeated-run-variance state.
- The agent respects the authority and lifecycle constraints encoded in the case.
