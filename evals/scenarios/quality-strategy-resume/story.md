---
id: quality-strategy-resume
title: strategy quality evaluation — resume
status: ready
tier: full
tags:
  - strategy
  - resume
  - quality-evaluation
---

Role: PM agent executing the resume quality case for pm:strategy.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:strategy was used.
- The response accounts for the staged resume state.
- The agent respects the authority and lifecycle constraints encoded in the case.
