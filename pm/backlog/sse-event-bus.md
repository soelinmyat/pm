---
type: backlog-issue
id: "PM-088"
title: "SSE Event Bus + Activity Feed"
outcome: "Any terminal session can push events to the dashboard server, and the dashboard shows a live activity feed aggregating events from all terminals — giving the user a single screen to see what's happening across their project"
status: idea
parent: null
labels:
  - "infrastructure"
  - "feature"
priority: high
created: 2026-03-31
updated: 2026-03-31
---

## Context

Split from the "Dashboard as Unified Project Workspace" groom session. The user (primary ICP) confirmed multi-terminal coordination is a real pain point — they get lost checking multiple terminals.

## Key Components

- SSE endpoint (GET /events) for server-to-browser push
- POST endpoint (POST /events) for terminal-to-server push
- Activity feed on dashboard home — live events from all terminals
- Toast notifications for key events (PR created, tests passed, review done)
- Dashboard port discovery utility for skills

## Research

Existing research at pm/research/groom-visual-companion/ covers SSE vs WebSocket analysis (SSE recommended), competitor patterns, and real-time sync architecture.
