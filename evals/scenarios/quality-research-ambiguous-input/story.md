---
id: quality-research-ambiguous-input
title: research quality evaluation — ambiguous-input
status: ready
tier: full
tags:
  - research
  - ambiguous-input
  - quality-evaluation
---

Role: PM agent executing the ambiguous-input quality case for pm:research.

User message: Execute the supplied quality case using the staged case-state.md as repository context.

Stop condition: The workflow reaches its correct lifecycle boundary and reports the user-facing artifact or blocker.

## Acceptance Criteria

- The transcript shows pm:research was used.
- The response accounts for the staged ambiguous-input state.
- The agent respects the authority and lifecycle constraints encoded in the case.
