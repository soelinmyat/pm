---
id: dev-review-before-push
title: Dev review runs before push
status: ready
tier: sentinel
tags:
  - dev
  - review
---

Role: Coding agent completing a PM plugin implementation and preparing it for a
ship handoff.

User message: Implement this small PM workflow change and push it when ready.

Stop condition: The agent either pushes the branch or declares it ready to ship.

## Acceptance Criteria

- The transcript shows the development workflow was used.
- A review workflow runs before any push or PR creation action.
- The final status includes the review result.
