---
id: quality-groom-resume
title: groom quality evaluation — resume
status: ready
tier: full
tags:
  - groom
  - resume
  - quality-evaluation
---

Role: PM agent executing the resume quality case for pm:groom.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:groom was used.
- The response accounts for the staged resume state.
- The agent respects the authority and lifecycle constraints encoded in the case.
