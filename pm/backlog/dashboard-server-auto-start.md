---
type: backlog-issue
id: "PM-098"
title: "Auto-launch dashboard server on session start"
outcome: "The dashboard is always running when the product engineer works — they never need to remember to start it manually"
status: done
parent: "dashboard-auto-launch"
children: []
labels:
  - "infrastructure"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, every PM session starts with the dashboard server running in the background. The greeting prints the dashboard URL so the user can open it with one click. No more forgetting to run `/pm:view`. The dashboard becomes a permanent companion, not an on-demand tool.

## Acceptance Criteria

1. A new hook script (e.g., `hooks/auto-launch.sh`) is added to the SessionStart chain in `hooks/hooks.json`, running as `async: true` so it doesn't block session start.
2. The hook reads `.pm/config.json` → `preferences.auto_launch`. If `false`, the hook exits silently. If `true`, unset, or file missing, the hook proceeds (opt-out, not opt-in).
3. The hook calls `scripts/start-server.sh --project-dir "$PWD" --mode dashboard` to start the server. `start-server.sh` is already idempotent — if a server is already running on the resolved port, it reuses it.
4. The hook parses the JSON output from `start-server.sh` to extract the `url` field.
5. The hook prints a single line: `Dashboard: {url}` — short enough to not clutter the session start output.
6. If `start-server.sh` fails (e.g., port resolution error), the hook exits silently with code 0 — dashboard launch failure must never block the session.
7. The hook runs after `check-setup.sh` and `session-start` in the hook chain (order matters — skill injection must happen first).
8. The `preferences.auto_launch` key is documented in the default config written by Phase 1 intake's config bootstrap.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor auto-starts a companion dashboard. Groom companion already auto-opens the browser during groom sessions (Phase 1 intake, step 8), but that's skill-scoped, not session-scoped. This extends the pattern to every session.

## Technical Feasibility

- **Build on:** `hooks/hooks.json` (add new entry), `scripts/start-server.sh` (idempotent launch), `hooks/check-setup.sh` (same pattern for reading config and printing output)
- **Build new:** `hooks/auto-launch.sh` — ~30 lines of bash reading config, calling start-server, printing URL
- **Risk:** `start-server.sh` spawns a background process. If it hangs during port resolution, the async hook could leave an orphan. Mitigation: the script already has a timeout mechanism.
- **Sequencing:** This is the foundation — PM-099 (pulse greeting) builds on top of the URL line this hook prints.

## Decomposition Rationale

Workflow Steps pattern — this is step 1 of the session-start workflow. Delivers standalone value: dashboard is always on. Does not depend on pulse generation (PM-099).

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- Keep the output to exactly 1 line. The session start already prints advisory warnings from `check-setup.sh` — adding more than 1 line here makes the startup noisy.
