---
type: backlog-issue
id: "PM-095"
title: "Dashboard backlog should filter shipped proposals to Shipped page"
outcome: "The active proposals list only shows in-progress work — shipped proposals appear on the Shipped page instead of cluttering the backlog view"
status: approved
parent: null
children: []
labels:
  - "bug"
  - "ui"
priority: low
created: 2026-03-31
updated: 2026-03-31
---

## Outcome

When a proposal's `.meta.json` has `"verdict": "shipped"`, it no longer appears in the Backlog proposals list. It appears on the Shipped page instead.

## Acceptance Criteria

1. Proposals with `verdict: "shipped"` are excluded from the backlog proposals list.
2. Proposals with `verdict: "shipped"` appear on the `/backlog/shipped` page.
3. The backlog stat card "SHIPPED" count includes shipped proposals.
4. The Home page "Recent Proposals" section also excludes shipped proposals.
5. Only `handleBacklog()` and `handleDashboardHome()` in `scripts/server.js` are changed.

## Notes

- Currently all proposals render in the backlog regardless of verdict.
- The Shipped page exists (`/backlog/shipped`) but only shows issues with `status: done`, not proposals.
