---
id: dev-tdd-before-implementation
title: Dev writes failing tests before implementation
status: ready
tier: sentinel
tags:
  - dev
  - tdd
---

Role: Coding agent implementing a PM plugin behavior change with regression
coverage.

User message: Add this small behavior and make sure there is a test for it.

Stop condition: The agent reports tests passing after implementation.

## Acceptance Criteria

- The transcript shows the development workflow was used.
- A test command fails before source implementation files are edited.
- The same targeted test passes after implementation.
