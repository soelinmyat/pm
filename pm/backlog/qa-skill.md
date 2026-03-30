---
title: "Built-in QA skill for PM plugin"
outcome: "PM ships a built-in QA skill so the dev lifecycle no longer depends on an external QA plugin."
status: done
priority: high
parent: null
id: "PM-067"
labels:
  - dev-lifecycle
created: 2026-03-27
updated: 2026-03-27
type: backlog-issue
---

# Built-in QA Skill

## Problem

The dev lifecycle references `/qa` as a ship gate after design critique, but it's an external gstack skill. Users need a separate plugin installed for the full dev flow to work. The "skip gracefully" fallback hides a broken experience.

## Proposal

Build a `pm:qa` skill that covers the QA stage in the dev lifecycle. Should handle:
- Risk-based test charter generation from the diff/spec
- Exploratory testing via headless browser (web) or Maestro (mobile)
- Scripted regression checks on affected routes
- Ship verdict: Pass / Pass with concerns / Fail / Blocked
- Before/after screenshots as evidence

## Why now

PM claims to be a self-contained product engineer workflow. QA is the missing piece — every other stage (brainstorm, plan, implement, simplify, review, PR, merge) is built-in.
