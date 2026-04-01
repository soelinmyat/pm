---
type: backlog-issue
id: "PM-105"
title: "Canvas lifecycle states"
outcome: "Each canvas shows whether its agent is actively working, idle, or done — the user knows at a glance which canvases need attention"
status: done
parent: "live-canvas-system"
children: []
labels:
  - "feature"
  - "ui"
priority: medium
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, canvas tabs show a visual state indicator. Active canvases pulse (agent is working). Idle canvases show a pause indicator (waiting for input). Completed canvases show a check mark and become read-only. The user scans the tab bar and knows instantly: "groom is waiting for me, dev is still running, research is done."

## Acceptance Criteria

1. Canvas directories contain a `.state` file with one of: `active`, `idle`, `completed`. If missing, default to `active`.
2. Skills write the `.state` file at lifecycle transitions: session start → `active`, waiting for user input → `idle`, user responds → `active`, session complete → `completed`.
3. Canvas tabs show a state indicator dot: green pulsing for active, yellow static for idle, gray check for completed.
4. A `canvas_state` SSE event type is added. Payload: `{ type: "canvas_state", slug: "{slug}", state: "active|idle|completed" }`. Dashboard updates the tab indicator on receipt.
5. Completed canvases move to a "Recent" section below active tabs after 5 minutes. Still clickable but visually separated.
6. The groom skill emits `canvas_state` events at phase transitions (already writes companion HTML — add state file write alongside).
7. The dev skill emits `canvas_state` events at stage transitions.

## User Flows

N/A — visual indicator enhancement on existing tab bar.

## Wireframes

N/A — dot indicators on tabs, too small for wireframe.

## Technical Feasibility

- **Build on:** PM-104's tab bar and SSE listener. Groom companion already writes per-phase HTML.
- **Build new:** `.state` file writes in skill phases (~1 line each), `canvas_state` SSE event, tab indicator CSS (reuse activity feed pulse animation).
- **Risk:** State transitions may not fire reliably if context exhausts mid-session. Mitigation: `.state` file defaults to `active` — worst case the tab looks active when idle.

## Decomposition Rationale

Workflow Steps — step 2. Adds visual lifecycle on top of PM-104's navigation.
