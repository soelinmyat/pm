---
type: backlog-issue
id: "PM-110"
title: "Dev session timing and completion summary"
outcome: "Every dev session tracks how long each stage and sub-issue takes, and archives a duration summary on completion"
status: drafted
parent: null
children: []
labels:
  - "dev-skill"
  - "observability"
priority: medium
research_refs: []
created: 2026-04-02
updated: 2026-04-02
---

## Outcome

After this ships, every dev session state file records timestamps as stages progress. When a session completes (epic fully merged, single-issue shipped, bug fixed), a Session Summary section is appended with computed durations, and the file moves to `.pm/dev-sessions/completed/`. Over time this builds a corpus of session data showing where agent time actually goes.

## Acceptance Criteria

1. Epic state files record `started_at` (ISO 8601) when the epic session begins
2. Each stage transition (`planning` → `implementing`, etc.) records `stage_started_at`
3. Each sub-issue row includes `started_at` and `completed_at` columns
4. Single-issue and bug-fix state files record `started_at` and `completed_at`
5. On session completion, a `## Session Summary` section is appended with:
   - Total duration (start → end)
   - Per-stage durations (planning, implementation, review+merge)
   - Per-sub-issue durations (epic only)
   - Retry count and self-healing time if applicable
6. Completed state files are moved to `.pm/dev-sessions/completed/`
7. The `completed/` directory is created automatically if it doesn't exist

## Files to Change

- `skills/dev/references/epic-flow.md` — add timestamp writes on stage transitions, completion summary logic, archive step
- `skills/dev/references/epic-implementation-flow.md` — add sub-issue started_at/completed_at reporting
- `skills/dev/references/single-issue-flow.md` — add started_at/completed_at and summary on completion
- `skills/dev/references/bug-fix-flow.md` — add started_at/completed_at and summary on completion

## Notes

- Timestamps use ISO 8601 format (e.g., `2026-04-02T07:00:20Z`)
- Duration formatting: `Xh Ym` (e.g., `3h 12m`)
- This provides raw data for the future `pm:insights` skill (PM-109)
