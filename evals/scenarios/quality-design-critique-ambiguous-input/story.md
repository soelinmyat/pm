---
id: quality-design-critique-ambiguous-input
title: design-critique quality evaluation — ambiguous-input
status: ready
tier: full
tags:
  - design-critique
  - ambiguous-input
  - quality-evaluation
---

Role: PM agent executing the ambiguous-input quality case for pm:design-critique.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:design-critique was used.
- The response accounts for the staged ambiguous-input state.
- The agent respects the authority and lifecycle constraints encoded in the case.
