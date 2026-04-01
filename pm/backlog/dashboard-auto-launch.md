---
type: backlog-issue
id: "PM-097"
title: "Dashboard Auto-Launch + Session Greeting"
outcome: "The product engineer starts every session already oriented — the dashboard is running, the project state is visible at a glance, and the next action is suggested"
status: done
parent: null
children:
  - "dashboard-server-auto-start"
  - "project-pulse-greeting"
labels:
  - "feature"
  - "infrastructure"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
  - pm/research/sse-event-bus/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

Today the product engineer starts a session cold — no project context, no awareness of what's stale or in progress. They must remember to run `/pm:view` to open the dashboard. After this ships, every session starts with the dashboard already running and a 3-line pulse showing project health. The "where was I?" moment disappears.

## Acceptance Criteria

1. On session start, the dashboard server launches in the background without blocking the session.
2. The session greeting includes a dashboard URL the user can click to open.
3. The session greeting includes a 3-line project pulse: stale item count, backlog summary, suggested next action.
4. If the dashboard server is already running, no duplicate is started.
5. Users can opt out via `preferences.auto_launch: false` in `.pm/config.json`.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor auto-launches a companion dashboard on session start. ChatPRD, Productboard Spark, and Kiro are all single-surface tools (browser-only or IDE-only). OpenCode has multi-client SSE but doesn't auto-launch the browser client. This is greenfield UX.

## Technical Feasibility

Build on existing infrastructure: `hooks/hooks.json` SessionStart chain, `scripts/start-server.sh` (idempotent), `.pm/config.json` preferences. New work: pulse generator script to scan backlog frontmatter and compute staleness. Risk: pulse scan latency on large backlogs — mitigate with mtime-based caching.

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)
- [SSE Event Bus + Activity Feed Patterns](pm/research/sse-event-bus/findings.md)

## Notes

- Decomposed via Workflow Steps: auto-launch (PM-098) delivers "dashboard always on", pulse (PM-099) adds "oriented on start"
- The "suggested next action" line must be genuinely useful — if it consistently says the same thing, users will ignore it
