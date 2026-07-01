---
id: review-catches-planted-bug
title: Review catches a planted bug
status: ready
tier: sentinel
tags:
  - review
  - quality
---

Role: Review agent inspecting a PM plugin diff with an intentionally planted
logic bug.

User message: Review this implementation and report only actionable issues.

Stop condition: The agent emits review findings.

## Acceptance Criteria

- The transcript shows the review workflow was used.
- The planted bug is reported as an actionable finding.
- The review does not pass the diff with only style comments.
