---
type: backlog-issue
id: "PM-048"
title: "Merge SessionStart hooks into a single unified hook"
outcome: "One SessionStart hook runs PM setup checks and dev context preloading sequentially, giving the product engineer both PM and dev capabilities from the first prompt."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "infrastructure"
  - "hooks"
priority: medium
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

When a product engineer starts a session, the merged hook: (1) checks for first-run setup and daily updates, (2) verifies CLAUDE.md/AGENTS.md/.gitignore presence, and (3) preloads the `using-dev` routing guide into session context. All three jobs run in one sequential hook chain.

## Acceptance Criteria

1. Single `hooks/hooks.json` with one SessionStart matcher running all hook scripts sequentially.
2. Merged `check-setup.sh` execution order: (a) CLAUDE.md/AGENTS.md/.gitignore presence checks (advisory, never exit early), (b) first-run detection (`.pm/config.json` absent → prompt setup, but do NOT exit — dev-only users must still reach subsequent checks), (c) daily update check against merged repo URL. PM's current early-exit at line 36 when `.pm/config.json` is absent must be removed or gated so dev advisory checks always fire.
3. `session-start` script preloads `using-dev/SKILL.md` into session context. If the file is not found, emit a visible warning (not silent skip). The preloaded content must cover routing for all 23 skills (update `using-dev` to include PM skill routing, or create a unified `using-all` guide).
4. Combined hook output injected into session context must not exceed 4,000 characters, measured by the total size of `hookSpecificOutput.additionalContext`. If the merged `using-dev/SKILL.md` exceeds this, compress the routing guide to essential skill-trigger mappings only.
5. Update check points to the merged repository URL (not the old PM-only or dev-only repos).
6. All hook scripts use `${CLAUDE_PLUGIN_ROOT}` for path resolution, not hardcoded paths.
7. Preloading verification: after session-start runs, the session context contains the skill routing guide content (verifiable by checking that `using-dev` or equivalent content appears in the session's initial context).

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor plugin uses SessionStart hooks for context preloading. Compound Engineering Plugin requires users to manually invoke `/ce:ideate` or similar — there is no automatic skill discovery. PM Skills Marketplace (6,769 stars) has no hooks at all. This automatic routing reduces cold-start friction — the product engineer gets guidance on which skill to use without asking. The preloading must actually succeed and be verifiable; a silent failure means the "unique capability" never fires.

## Technical Feasibility

Build-on: Dev already chains `check-setup.sh` + `session-start` sequentially with `async: false` in `hooks.json`. PM has a single `check-setup.sh`. Both patterns are compatible. Build-new: Merged `check-setup.sh` combining 5 checks from two separate scripts. Risk: Dev's `session-start` uses `PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"` — silently outputs error message and continues if `using-dev/SKILL.md` not found. This best-effort pattern with no failure signal should be reviewed.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- Decision required before implementation: either extend `using-dev/SKILL.md` to cover all 23 skills (PM + dev routing in one guide), or create a unified `using-all/SKILL.md`. Do not leave this as a post-implementation question — the engineer needs a clear spec.
