---
type: backlog-issue
id: "PM-062"
title: "Dashboard session links and groom session cleanup"
outcome: "Users discover active groom companion sessions from the dashboard home page, and completed sessions are cleaned up automatically so stale files don't accumulate"
status: drafted
parent: "groom-visual-companion"
children: []
labels:
  - "output-quality"
  - "infrastructure"
priority: medium
research_refs:
  - pm/research/groom-visual-companion/findings.md
created: 2026-03-22
updated: 2026-03-22
---

## Outcome

After this ships, the dashboard home page shows active groom sessions as clickable links to their `/session/{slug}` companion pages. Users can navigate to any in-progress session's companion view without remembering the URL. When a groom session completes (Phase 6), the `.pm/sessions/groom-{slug}/` directory is cleaned up, preventing stale session files from accumulating.

## Acceptance Criteria

1. The groom session banner on the dashboard home page (`handleDashboardHome()` in `scripts/server.js`) adds an `<a href="/session/{slug}">` link to each active session's topic name. The link only appears for sessions where `.pm/sessions/groom-{slug}/` exists (i.e., the companion was activated).
2. If no `.pm/sessions/groom-{slug}/` directory exists for a session (companion not activated), the session banner displays as it does today — topic, phase, and date without a link.
3. Phase 6 (`phase-6-link.md`) adds a cleanup step at the end: after issues are created and the session state file is updated, delete the `.pm/sessions/groom-{slug}/` directory if it exists. The cleanup is silent — no user prompt.
4. If the `.pm/sessions/groom-{slug}/` directory does not exist (companion was not activated), Phase 6 skips cleanup silently.
5. The groom session state file (`.pm/groom-sessions/{slug}.md`) is NOT deleted by cleanup — only the companion screen directory. The state file is cleaned up by the existing Phase 6 logic.

## User Flows

N/A — this is a polish/integration feature, not a separate user flow.

## Wireframes

N/A — the dashboard home already renders groom session banners. This adds a link to the existing topic text.

## Competitor Context

No competitor surfaces active grooming sessions in a dashboard. This is unique to PM's dashboard + groom integration. The clickable link pattern follows standard web conventions — no innovation needed, just correct integration.

## Technical Feasibility

**Verdict: Feasible as scoped.**

**Build-on:**
- `scripts/server.js:1688-1696` — The groom session banner already renders topic, phase, and date. Adding an `href` is a one-line change to the template string.
- `scripts/server.js:1224` — `readGroomState()` returns `_slug` for each session, which maps directly to the `/session/{slug}` URL.
- `skills/groom/phases/phase-6-link.md` — Phase 6 already handles session completion and state file cleanup.

**Build-new:**
- Conditional link in groom session banner template (check if `.pm/sessions/groom-{slug}/` exists).
- Cleanup step in Phase 6: `rm -rf .pm/sessions/groom-{slug}/` (conditional on directory existence).

**Sequencing:** Requires PM-060 (session route) to be completed first. Can be implemented in parallel with PM-061 (phase screens).

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- Decomposition rationale: Workflow Steps pattern — this is the third step (dashboard surfaces sessions + cleanup). Depends on PM-060 for the route. Independent of PM-061.
- 24h background cleanup was considered and deferred. Phase 6 cleanup handles the common case (session completes normally). Orphaned sessions from interrupted grooms are rare and can be manually deleted.
