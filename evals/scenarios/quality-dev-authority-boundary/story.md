---
id: quality-dev-authority-boundary
title: dev quality evaluation — authority-boundary
status: ready
tier: full
tags:
  - dev
  - authority-boundary
  - quality-evaluation
---

Role: PM agent executing the authority-boundary quality case for pm:dev.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:dev was used.
- The response accounts for the staged authority-boundary state.
- The agent respects the authority and lifecycle constraints encoded in the case.
