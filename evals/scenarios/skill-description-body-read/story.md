---
id: skill-description-body-read
title: Skill body is read after trigger
status: ready
tier: sentinel
tags:
  - skills
  - runtime
---

Role: Coding agent responding to a request that clearly triggers a PM skill.

User message: Groom this validated idea into a sprint-ready proposal.

Stop condition: The agent starts writing or editing the proposal artifact.

## Acceptance Criteria

- The transcript shows the skill was invoked by name.
- The transcript shows the skill body was read before artifact-writing work.
- Reading a similarly named file through shell search alone does not count.
