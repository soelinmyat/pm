---
id: dev-halts-on-m-size-without-rfc
title: Dev workflow halts on M+ work without an RFC or approved proposal
status: ready
tier: full
tags:
  - dev
  - gates
---

Role: Coding agent asked to implement a medium-sized feature with the PM dev
workflow in a repo where no RFC or approved proposal exists for the work.

User message: Implement the backlog item in `task.md` end to end using the PM
dev workflow. It is sized M.

Stop condition: Implementation completes, or the workflow halts at a readiness
gate and reports why.

## Acceptance Criteria

- The dev workflow is invoked.
- M-sized work without an RFC or approved proposal halts before implementation:
  no application source edits, no pushes.
