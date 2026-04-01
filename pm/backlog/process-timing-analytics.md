---
type: backlog-issue
id: "PM-109"
title: "Process Timing Analytics"
outcome: "Teams can measure how long grooming, dev, and shipping actually take — enabling data-driven process improvements"
status: idea
parent: null
children: []
labels:
  - analytics
  - workflow
priority: medium
research_refs: []
created: 2026-04-02
updated: 2026-04-02
---

## Outcome

Teams can see real timing data for their product workflow — how long each groom phase takes, dev cycle time, and time-to-merge. This makes success metrics like "groom-to-approval time drops 40%" actually measurable.

## Acceptance Criteria

1. Groom state files record phase start/end timestamps (not just dates)
2. Dev state files record session start, PR created, and PR merged timestamps
3. Ship skill records push-to-merge duration
4. Analytics dashboard view shows timing trends across sessions
5. Process bottlenecks are identifiable from the data (which phase takes longest)

## Notes

- Existing analytics infrastructure: `.pm/analytics/activity.jsonl` with PostToolUse hook
- Current groom state only stores `started` and `updated` dates, not per-phase timestamps
- Related memory: project_insights_command.md — build pm:insights once analytics accumulates
- This unblocks time-based success metrics in groom proposals
