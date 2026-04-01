---
type: backlog-issue
id: "PM-101"
title: "Pulse score computation and display"
outcome: "The dashboard home page shows a prominent health score (0-100) with a color badge — the user knows their project's health in one glance"
status: done
parent: "project-pulse-score"
children: []
labels:
  - "feature"
  - "ui"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, the dashboard home page shows a large number (0-100) with a color badge (green/yellow/red) above the stat cards. The number aggregates research freshness, competitor freshness, backlog coverage, and strategy presence into a single health metric. The user stops scanning multiple badges and cards — one number tells the story.

## Acceptance Criteria

1. A new function `computePulseScore(pmDir)` is added to `scripts/server.js` that returns `{ score, dimensions }`.
2. The score is computed from 4 equally-weighted dimensions (25 points each):
   - **Research freshness (0-25):** 25 if all research topics have `updated:` within 30 days. Deducts proportionally per stale topic. 0 if no research exists.
   - **Competitor freshness (0-25):** 25 if all competitor profiles have `updated:` within 30 days. Deducts proportionally per stale profile. 0 if no competitors profiled.
   - **Backlog coverage (0-25):** 25 if backlog has at least 5 items with `status: done`. Scales linearly: 5 points per shipped item up to 25. Bonus: -5 if ratio of ideas to shipped exceeds 3:1 (idea backlog is growing faster than shipping).
   - **Strategy presence (0-25):** 25 if `pm/strategy.md` exists and has `updated:` within 60 days. 15 if exists but older. 0 if missing.
3. Each dimension object includes `{ name, score, max, detail }` where detail is a human-readable explanation (e.g., "3 of 5 research topics are fresh").
4. `handleDashboardHome()` calls `computePulseScore()` and renders the score as a large number with a color badge above the stat-grid.
5. The score display uses existing CSS variables: `--success` for green (80-100), `--warning` for yellow (50-79), `--accent` (red-tinted) for red (0-49).
6. The score number uses `font-size: 3rem; font-weight: 700` and is centered above the stat cards with a label "Project Health".
7. If `pm/` directory has no content (empty KB), the score shows "—" instead of 0, with a label "Set up your knowledge base to see your health score."

## User Flows

N/A — single widget on existing page.

## Wireframes

N/A — widget placement: centered, above `.stat-grid`, below `.page-header`.

## Competitor Context

No competitor has this. Closest analogy: Vercel's deployment status indicator, GitHub Actions workflow badges.

## Technical Feasibility

- **Build on:** `handleDashboardHome()` already reads stats, staleness, and updated dates. `stalenessInfo()` returns `{ level, label }`. Reuse these computations.
- **Build new:** `computePulseScore()` (~40 lines), score HTML template (~15 lines), CSS (~10 lines).
- **Risk:** None significant. This is additive — existing dashboard behavior is unchanged.

## Decomposition Rationale

Simple/Complex pattern — this is the simple version. Delivers the core value (one number) without the visual polish (arc, breakdown). PM-102 layers that on top.

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- Equal weights (25 each) are the starting point. Can tune after seeing real scores.
- The formula intentionally penalizes empty KB (0/100) — this creates motivation to populate it.
