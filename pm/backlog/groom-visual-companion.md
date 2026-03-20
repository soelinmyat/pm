---
type: backlog-issue
id: "PM-036"
title: "Groom Session Visual Companion: Live Browser View per Phase"
outcome: "Users who opt in see the current grooming phase rendered as a clean, scannable web page — the terminal becomes a lightweight conversation channel while the browser shows the substance"
status: idea
parent: null
children: []
labels:
  - "output-quality"
  - "feature"
priority: high
research_refs:
  - pm/competitors/index.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After this ships, users can opt into a browser companion at the start of any groom session. The browser shows a clean, formatted view of the current phase — scope grid, review verdicts, issue cards — that updates as the session progresses. The terminal becomes a lightweight channel for questions and approvals ("yes/no, pick A/B/C") while the browser carries the rich content. Multiple concurrent groom sessions each get their own URL at `/session/{slug}`.

## Acceptance Criteria

1. After Phase 1 completes and `.pm/groom-sessions/{slug}.md` is written (before Phase 2 begins), the skill checks `.pm/config.json` for `visual_companion`. If unset, it asks: "Want a visual companion in the browser? I'll show each phase as a clean web page." and persists the answer. If already set, it uses the stored value silently. If yes, the skill ensures the dashboard server is running and opens `localhost:{PORT}/session/{slug}`. PORT is discovered from the running dashboard server (default 3456, configurable via `.pm/config.json` `dashboard_port` key).
2. A new `/session/{slug}` route is added to the **dashboard server** (`createDashboardServer` in `scripts/server.js`), not the companion mode server. The route:
   - Serves the current phase HTML from `.pm/sessions/{slug}/current.html`
   - The dashboard server calls `watchDirectoryTree` a second time for `.pm/sessions/` as a separate watched root. The `server.close` patch is updated to call `closeWatchersUnder` on both `pmDir` and `sessionsDir` to prevent watcher leaks on shutdown.
   - Uses the existing WebSocket `broadcastDashboard({ type: 'reload' })` mechanism to push updates when the file changes
   - Returns a "Session not found" page if the slug doesn't exist
   - The existing companion mode server is NOT used for this feature
3. Each groom phase file includes a companion screen generation step (conditional on visual companion being active): write a self-contained HTML file to `.pm/sessions/{slug}/current.html` summarizing the phase's key output in scannable format.
4. Companion screens follow the style guide from PM-034: one-sentence summary at top, bullets not prose, max 3 content blocks per screen.
5. Multiple concurrent groom sessions are supported: each writes to `.pm/sessions/{slug}/` and is served at `/session/{slug}`. The dashboard home shows a list of active sessions.
6. The `current.html` file is overwritten each phase (not accumulated). When the groom session completes (Phase 6), the companion shows the final proposal with a link to the full HTML proposal file. The `.pm/sessions/{slug}/` directory is cleaned up after the user dismisses the session or after 24 hours — not immediately on Phase 6 completion, so users can re-open the companion to review the final state.
7. The `.pm/sessions/` directory is gitignored.
8. The opt-in preference persists in `.pm/config.json` under `visual_companion: true|false` so returning users don't need to answer every session. The key already exists in `.pm/config.json` (confirmed: line 8, currently set to `true`).
9. Companion screens are generated for phases with meaningful visual output: Phase 4 (scope grid), Phase 4.5 (scope review verdicts), Phase 5 (decomposition + issue preview), Phase 5.5 (team review verdicts), Phase 5.7 (bar raiser verdict), Phase 5.8 (final proposal link). Phases 1-3 and 6 produce minimal structured content and do not generate companion screens — the browser shows a "Phase in progress..." placeholder.

## User Flows

N/A — infrastructure feature, no user-facing workflow diagram needed. The interaction is: opt-in prompt → browser opens → phase screens auto-update → session ends → cleanup.

## Wireframes

N/A — no wireframes for this feature type. The companion screens are generated per-phase by the groom skill, not from a static wireframe.

## Competitor Context

No competitor offers a live visual companion during product grooming sessions. ChatPRD is a chat interface only. PM Skills Marketplace is terminal-only. Productboard Spark has a web UI but it's the primary surface, not a companion to a terminal workflow. PM's approach — terminal for conversation, browser for substance — is unique and plays to the editor-native positioning.

The superpowers brainstorming skill in Claude Code has a visual companion pattern, but it's dev-focused (mockups, diagrams) and doesn't persist across a multi-phase pipeline. PM's version is purpose-built for the groom lifecycle.

## Technical Feasibility

**Feasible as scoped.** The EM review found that `scripts/server.js` already has a companion mode with WebSocket live-reload serving HTML files from a screen directory. The `watchDirectoryTree()` + `broadcastDashboard({ type: 'reload' })` pattern is proven. The `/session/{slug}` route is a new dynamic route but follows the same serving pattern as existing dashboard pages.

**Risk:** The `/session/{slug}` route is added to the dashboard server (`createDashboardServer`), requiring it to watch both `pm/` (knowledge base) and `.pm/sessions/` (companion screens). A second `watchDirectoryTree` call handles the sessions directory. The `server.close` patch (line 3141) currently only calls `closeWatchersUnder(pmDir)` — it must be updated to also close watchers under the sessions directory to prevent file handle leaks. The companion mode server (`createCompanionServer`) is NOT used and remains unchanged.

**Risk:** Per-phase companion screen generation adds a write step to every phase file. If the LLM skips it under context pressure, the browser shows stale content. Mitigation: the write step should be at the top of each phase (before heavy work), not at the end.

## Research Links

- Plugin analysis: superpowers brainstorming visual companion pattern
- EM scope review: scripts/server.js companion mode already exists with WebSocket
- Web: CLI Guidelines — "concise by default, verbose when requested"

## Notes

- The companion is opt-in, not default — experienced users who prefer terminal-only are not disrupted.
- The `.pm/config.json` `visual_companion` key is already anticipated by Phase 4's scope grid offer, so the config schema needs no new fields.
- Cleanup is deferred until user dismissal or 24 hours after Phase 6, so the final companion view remains accessible for review.
