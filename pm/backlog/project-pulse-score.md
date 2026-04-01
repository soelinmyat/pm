---
type: backlog-issue
id: "PM-100"
title: "Project Pulse Score on Dashboard Home"
outcome: "The product engineer sees a single health number on the dashboard that tells them whether their project knowledge base is healthy or needs attention"
status: done
parent: null
children:
  - "pulse-score-computation"
  - "pulse-score-visual-arc"
labels:
  - "feature"
  - "ui"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
  - pm/research/sse-event-bus/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

Today the dashboard home page shows separate stat cards and staleness badges — the user must scan 4+ indicators to judge project health. After this ships, a single score (0-100) at the top of the page answers "is my project healthy?" at a glance. Green means everything is fresh and covered. Yellow means attention needed. Red means significant staleness or gaps.

## Acceptance Criteria

1. A score (0-100) appears prominently on the dashboard home page, above the existing stat cards.
2. The score is color-coded: green (80-100), yellow (50-79), red (0-49).
3. The score is computed from 4 dimensions: research freshness, competitor freshness, backlog coverage, strategy presence.
4. Hovering or clicking the score reveals a breakdown showing each dimension's contribution.
5. The score computation is a reusable function that could be called from both the dashboard and CLI.

## User Flows

N/A — single widget on existing page.

## Wireframes

N/A — too small for a standalone wireframe. The widget sits above the stat-grid in the dashboard home.

## Competitor Context

No competitor has a project health score. Productboard Spark has a knowledge base but no health metric. CI dashboards (GitHub Actions, Vercel) use green/yellow/red status for build health — same concept applied to product knowledge.

## Technical Feasibility

- **Build on:** `handleDashboardHome()` (server.js:2472) already computes stats and staleness. `stalenessInfo()` returns freshness levels. `hooks/auto-launch.sh` has equivalent scan logic.
- **Build new:** `computePulseScore(pmDir)` function, SVG arc widget, CSS color theming, breakdown tooltip.
- **Risk:** Score formula weights need to feel intuitive — equal weights as starting point, tune based on feedback.
- **Sequencing:** Score function + number display first (PM-101), visual arc + breakdown second (PM-102).

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- Decomposed via Simple/Complex: PM-101 delivers score + badge (simple), PM-102 adds arc + breakdown (complex)
- Score formula must be transparent — user should understand why they got a 62
