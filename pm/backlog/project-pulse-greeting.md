---
type: backlog-issue
id: "PM-099"
title: "Project pulse greeting on session start"
outcome: "The product engineer knows their project's health the moment a session starts — stale research, backlog state, and the one thing to do next — without checking anything manually"
status: done
parent: "dashboard-auto-launch"
children: []
labels:
  - "feature"
priority: high
research_refs:
  - pm/research/sse-event-bus/findings.md
created: 2026-04-01
updated: 2026-04-01
---

## Outcome

After this ships, the session greeting includes a 3-line project pulse below the dashboard URL. The product engineer sees at a glance: how many items need attention (stale research, aging issues), the shape of their backlog (X ideas, Y in progress, Z shipped), and one suggested next action. The "where was I?" moment is gone.

## Acceptance Criteria

1. The auto-launch hook (PM-098) is extended — or a new script is chained — to compute and print a 3-line project pulse after the dashboard URL.
2. **Line 1 — Attention needed:** Count of items needing attention. Scans `pm/research/*/findings.md` and `pm/competitors/*/profile.md` for `updated:` frontmatter older than 30 days ("stale"). Scans `pm/backlog/*.md` for `status: idea` items older than 14 days ("aging ideas"). Format: `{N} stale, {M} aging ideas` or `All fresh` if counts are zero.
3. **Line 2 — Backlog shape:** Counts `pm/backlog/*.md` by `status:` field. Format: `Backlog: {X} ideas, {Y} in progress, {Z} shipped`.
4. **Line 3 — Suggested next:** One actionable suggestion based on project state. Priority logic:
   - If no `pm/strategy.md` exists → `Next: Run /pm:strategy to set direction`
   - If stale count > 0 → `Next: Run /pm:refresh to update {N} stale items`
   - If aging ideas > 3 → `Next: Run /pm:groom to promote your oldest ideas`
   - If in-progress issues exist → `Next: Run /pm:dev to continue {oldest in-progress title}`
   - Default → `Next: Run /pm:groom ideate to discover what to build`
5. The pulse respects `preferences.auto_launch: false` — if auto-launch is disabled, pulse is also disabled (they share the same opt-out).
6. The pulse scan completes in under 500ms for a project with 100 backlog items and 20 research topics. If scan exceeds 500ms, cache results to `.pm/.pulse_cache` with an mtime-based invalidation (re-scan if any `pm/` file is newer than cache).
7. The pulse output is visually distinct from the advisory warnings printed by `check-setup.sh` — use a blank line separator and a `Project:` prefix on the first line.
8. If `pm/` directory doesn't exist (no knowledge base yet), the pulse prints only line 3 with a setup suggestion: `Next: Run /pm:setup or /pm:groom to get started`.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor provides project health context on session start. Productboard Spark has a knowledge base but no proactive surfacing. ChatPRD has no persistence across sessions. This is the "morning standup" that no tool provides.

## Technical Feasibility

- **Build on:** `hooks/check-setup.sh` (same advisory output pattern), `pm/backlog/*.md` frontmatter schema (status, updated, priority fields), `pm/research/*/findings.md` frontmatter (updated field)
- **Build new:** Pulse generator logic (~60 lines bash) that scans frontmatter, computes counts, and selects the suggested next action. Optional: `.pm/.pulse_cache` file for performance on large KBs.
- **Risk:** Frontmatter parsing in bash is fragile — `grep` + `sed` for YAML fields works for flat keys but breaks on multi-line values. Mitigation: PM's frontmatter is intentionally flat (no nested objects in scannable fields). Test with edge cases: missing fields, empty files, non-PM markdown files in `pm/backlog/`.
- **Sequencing:** Depends on PM-098 (auto-launch). Can be built independently and wired in after.

## Decomposition Rationale

Workflow Steps pattern — this is step 2 of the session-start workflow. Depends on PM-098 for the hook infrastructure but delivers its own value: project orientation.

## Research Links

- [SSE Event Bus + Activity Feed Patterns](pm/research/sse-event-bus/findings.md)

## Notes

- The "suggested next" line is the hardest to get right. If it's generic or repetitive, users will stop reading it. Priority logic should be tuned based on real usage.
- Consider emitting a `session_pulse` SSE event so the dashboard activity feed also shows the pulse.
