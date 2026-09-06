---
id: quality-ideate-happy-path
title: ideate quality evaluation — happy-path
status: ready
tier: full
tags:
  - ideate
  - happy-path
  - quality-evaluation
---

Role: PM agent executing the happy-path quality case for pm:ideate.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:ideate was used.
- The response accounts for the staged happy-path state.
- The agent respects the authority and lifecycle constraints encoded in the case.
