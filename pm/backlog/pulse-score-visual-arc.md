---
type: backlog-issue
id: "PM-102"
title: "Pulse score visual arc and breakdown"
outcome: "The health score is visually compelling — an animated ring shows progress and clicking reveals which dimensions need attention"
status: done
parent: "project-pulse-score"
children: []
labels:
  - "feature"
  - "ui"
priority: medium
research_refs:
  - pm/research/groom-visual-companion/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, the plain score number from PM-101 is wrapped in an SVG arc/ring that fills proportionally (0-100). The ring color matches the score tier (green/yellow/red). Clicking or hovering reveals a breakdown panel showing each dimension's score with a short explanation. The user sees not just "your score is 62" but "research is stale, competitors are fresh, backlog is healthy, strategy is current."

## Acceptance Criteria

1. The score number from PM-101 is wrapped in a circular SVG arc. The arc fills clockwise proportional to the score (0 = empty circle, 100 = full circle).
2. The arc stroke color matches the score tier: green (`--success`) for 80-100, yellow (`--warning`) for 50-79, red-accent for 0-49.
3. The arc animates on page load — fills from 0 to the actual score over 600ms with an ease-out curve. Respects `prefers-reduced-motion` (skips animation, shows final state immediately).
4. Clicking the score widget toggles a breakdown panel below it showing all 4 dimensions in a horizontal row of small cards.
5. Each dimension card shows: dimension name, score out of max (e.g., "18/25"), a mini progress bar, and the detail string from `computePulseScore()`.
6. The breakdown panel has a slide-down animation (200ms) on open and slide-up on close.
7. The breakdown state (open/closed) persists to localStorage as `pm-pulse-expanded`.
8. The SVG arc renders correctly in both dark and light themes. The background ring uses `--border` color.
9. On mobile (< 600px), the arc diameter shrinks from 120px to 80px. The breakdown stacks vertically instead of horizontal row.

## User Flows

N/A — interactive widget enhancement.

## Wireframes

N/A — enhancement of PM-101's score display.

## Competitor Context

No competitor has this. The visual pattern draws from fitness tracker score rings (Apple Health, Oura Ring) and CI build status wheels.

## Technical Feasibility

- **Build on:** PM-101's `computePulseScore()` return value provides all data. Existing CSS variables for theming.
- **Build new:** SVG arc template (~30 lines inline SVG), arc animation JS (~20 lines), breakdown panel HTML/CSS (~40 lines), localStorage toggle (~10 lines).
- **Risk:** SVG arc math (stroke-dasharray, stroke-dashoffset) needs careful calculation for the circular fill. Well-documented pattern.

## Decomposition Rationale

Simple/Complex pattern — this is the complex version. Depends on PM-101 (score computation + number display).

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- The arc should feel like a quality indicator, not a gamification mechanic. Avoid badges, levels, or "achievements."
- Consider adding the score to the browser tab title: "(72) PM Dashboard" — but that's a separate idea (#8 from ideation, Dashboard Tab Badge).
