---
type: backlog-issue
id: "PM-089"
title: "Dev Passive Status on Dashboard"
outcome: "During dev sessions, the dashboard shows current issue, phase, and test results without the user needing to switch to the dev terminal"
status: idea
parent: null
labels:
  - "feature"
priority: medium
created: 2026-03-31
updated: 2026-03-31
---

## Context

Split from the "Dashboard as Unified Project Workspace" groom session. Depends on PM-088 (SSE Event Bus) for the event delivery mechanism.

## Key Components

- Dev skill emits phase events (started, TDD, building, review, PR, merged)
- Dashboard home session banner updates in real-time via SSE
- Current issue + phase shown non-intrusively

## Dependencies

- PM-088 (SSE Event Bus + Activity Feed) must ship first
