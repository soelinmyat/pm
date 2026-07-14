---
name: Intake
order: 1
description: First sample step
---

## Intake

### Goal

Determine the exact sample record and routing kind that this fixture run must capture.

### How

Read the request, normalize it to one bounded record, choose the matching routing kind, and check whether the target name already exists before writing anything.

### Done-when

The sample content, routing kind, and collision-safe destination are explicit and ready for the final capture step.

**Advance:** proceed to Step 2 (Done).
