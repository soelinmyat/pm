---
type: backlog-issue
id: "PM-103"
title: "Live Canvas System"
outcome: "Each agent session gets its own live workspace on the dashboard — the user watches work products form in real-time while keeping hands in the terminal"
status: drafted
parent: null
children:
  - "canvas-infra-sidebar"
  - "canvas-lifecycle"
  - "canvas-dev-skill"
  - "canvas-auto-archive"
labels:
  - "feature"
  - "ui"
  - "infrastructure"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
  - pm/research/sse-event-bus/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

Today the dashboard is a passive viewer. The groom companion writes static HTML snapshots per phase, but there's no unified system for multiple skills to push live content. After this ships, every agent session (groom, dev) gets a live canvas on the dashboard. The user sees work products forming in real-time — scope grids filling in, issues being drafted, test results appearing. The dashboard becomes the agent's workspace, not just a knowledge base viewer.

## Acceptance Criteria

1. Any skill can create a canvas by writing to `.pm/sessions/{type}-{slug}/current.html` and emitting a `canvas_update` SSE event.
2. The dashboard shows a canvas sidebar listing all active and recent canvases.
3. Clicking a canvas loads its content in the main area with hot-reload on file changes.
4. Canvases have lifecycle states: created, active, idle, completed, archived.
5. Dev sessions write canvas HTML alongside groom sessions.
6. Completed canvases auto-archive after 24 hours.

## Competitor Context

No competitor has agent-scoped live canvases. MetaGPT X has optional web visualization of agent orchestration — closest precedent but focused on inter-agent communication, not work product rendering. This is greenfield.

## Technical Feasibility

Build on: `/session/{slug}` routes, SSE event bus, groom companion HTML writes, `readAllActiveSessions()`, file watcher. New: canvas sidebar UI, `canvas_update` SSE event, lifecycle state tracking, dev canvas writes, auto-archive cleanup.

## Notes

- Phase 1: HTML streaming (each skill controls rendering). Phase 2 (future): structured components for visual consistency.
- Core principle: terminal = conversational, canvas = ambient. Agent always pushes to both, never checks if dashboard is open.
