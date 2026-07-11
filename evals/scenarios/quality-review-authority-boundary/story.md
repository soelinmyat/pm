---
id: quality-review-authority-boundary
title: review quality evaluation — authority-boundary
status: ready
tier: full
tags:
  - review
  - authority-boundary
  - quality-evaluation
---

Role: PM agent executing the authority-boundary quality case for pm:review.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:review was used.
- The response accounts for the staged authority-boundary state.
- The agent respects the authority and lifecycle constraints encoded in the case.
