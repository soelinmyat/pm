---
id: quality-dev-low-quality-schema-valid
title: dev quality evaluation — low-quality-schema-valid
status: ready
tier: full
tags:
  - dev
  - low-quality-schema-valid
  - quality-evaluation
---

Role: PM agent executing the low-quality-schema-valid quality case for pm:dev.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:dev was used.
- The response accounts for the staged low-quality-schema-valid state.
- The agent respects the authority and lifecycle constraints encoded in the case.
