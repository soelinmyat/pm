---
type: backlog-issue
id: "PM-107"
title: "Canvas auto-archive cleanup"
outcome: "Completed canvases automatically archive after 24 hours — the dashboard stays clean without manual cleanup"
status: drafted
parent: "live-canvas-system"
children: []
labels:
  - "infrastructure"
priority: low
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, completed canvas directories are automatically cleaned up. No stale session artifacts accumulate in `.pm/sessions/`. The dashboard only shows active, idle, and recently completed canvases.

## Acceptance Criteria

1. On dashboard server start, scan `.pm/sessions/` for directories with `.state` file containing `completed`.
2. If the `.state` file's mtime is older than 24 hours, delete the entire canvas directory.
3. On every `canvas_state` event with state `completed`, schedule a cleanup check for that canvas after 24 hours (or on next server start, whichever comes first).
4. The cleanup runs silently — no user-facing output.
5. Canvas directories for sessions that are still referenced by an active groom/dev state file (`.pm/groom-sessions/*.md` or `.pm/dev-sessions/*.md`) are never archived, regardless of `.state` value.
6. A `canvas_archived` SSE event is emitted when a canvas is cleaned up, so the dashboard can remove it from the "Recent" section.

## Technical Feasibility

- **Build on:** Dashboard server startup already scans `.pm/` directory. `readAllActiveSessions()` cross-references state files.
- **Build new:** Cleanup scan function (~20 lines), protection check against active state files, timer or startup-based trigger.
- **Risk:** Race condition if a session restarts just as cleanup fires. Mitigation: check active state files before deleting.

## Decomposition Rationale

Workflow Steps — step 4. Housekeeping. Low priority since manual cleanup works until this ships.
