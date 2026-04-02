---
type: backlog-issue
id: "PM-094"
title: "Dashboard suggested-next uses removed command syntax"
outcome: "The dashboard suggested-next section uses natural language instead of slash-command syntax, matching how users actually invoke skills"
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

The "Suggested Next" section on the dashboard home page guides users with natural phrasing ("Ask Claude to groom...") instead of the removed command syntax (`Run /pm:groom slug`).

## Acceptance Criteria

1. The suggested-next text does not use `/pm:groom`, `/pm:research`, or any `/pm:*` prefix.
2. Instead uses natural language: "Ask Claude to groom {idea}" or "Try: groom {idea}".
3. All suggested-next variants (no strategy, no landscape, no competitors, no backlog, has idea) are updated.
4. The `handleDashboardHome()` function in `scripts/server.js` is the only file changed.

## Notes

- Commands were removed in PM-057. Skills are invoked by natural language, not slash commands.
- The dashboard still references the old command syntax in the suggested-next section.
