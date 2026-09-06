---
id: quality-think-happy-path
title: think quality evaluation — happy-path
status: ready
tier: full
tags:
  - think
  - happy-path
  - quality-evaluation
---

Role: PM agent executing the happy-path quality case for pm:think.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:think was used.
- The response accounts for the staged happy-path state.
- The agent respects the authority and lifecycle constraints encoded in the case.
