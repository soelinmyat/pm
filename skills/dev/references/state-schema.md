# Dev State File Schema

## Location

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions:

- **All sessions:** `.pm/dev-sessions/{slug}.md` — where `{slug}` is derived from the branch name by stripping the type prefix (`feat/`, `fix/`, `chore/`). Example: branch `feat/add-auth` → `.pm/dev-sessions/add-auth.md`. For XS tasks (no branch), use the topic slug from intake.
- **`.gitignore`:** `.pm/` covers all state files (no separate pattern needed).
- **Directory creation:** If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before the first write.

**Repo location:** Dev sessions always live in the source repo's `.pm/dev-sessions/` directory — even in separate-repo mode. This keeps dev state co-located with the code being modified. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}.md` as before.

## Legacy Migration

On resume detection or any state file read, also check legacy paths (`.dev-state-{slug}.md`, `.dev-epic-state-{slug}.md` at repo root, and `epic-{slug}.md` in `.pm/dev-sessions/`). If found at legacy path but not at new path, read from legacy. New writes always go to `.pm/dev-sessions/{slug}.md`.

## Context Recovery

At the start of every turn, if you're unsure which stage you're in or what decisions were made, read the state file first. The state file is the single source of truth — not conversation history.

After compaction or if context feels stale, read this file to recover full session state.

## Valid Stage Values

`intake`, `workspace`, `rfc-check`, `implement`, `simplify`, `design-critique`, `qa`, `review`, `ship`, `retro`.

## Valid Task Status Values

These are the only valid values for the `Status` column in the `## Tasks` table:

| Value | Meaning |
|-------|---------|
| `pending` | Task has not started |
| `in-progress` | Agent has been dispatched and is working |
| `implementing` | Agent is in the implementation phase (multi-task lifecycle tracking) |
| `simplifying` | Agent is in the simplify phase |
| `reviewing` | Agent is in the review phase |
| `shipping` | Agent is in the push/PR/merge phase |
| `done` | Task completed successfully (single-task) or merged (multi-task) |
| `failed` | Task failed after max retry attempts |
| `blocked` | Task blocked by an issue requiring user input |
| `skipped` | Task was already implemented or intentionally skipped |

Multi-task per-task agents should update the Tasks table status at each lifecycle transition (via the orchestrator's checkpoint). This enables accurate resume and retro.

## Template

```markdown
# Dev Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | implement |
| Size | M |
| Task Count | 1 |
| Ticket | PROJ-456 |
| Repo root | /path/to/project |
| Active cwd | /path/to/project/.worktrees/feature-name |
| RFC | {pm_dir}/backlog/rfcs/feature-name.html |
| Branch | feat/feature-name |
| Worktree | .worktrees/feature-name |
| Started at | 2026-04-04T01:00:00Z |
| Stage started at | 2026-04-04T03:20:00Z |
| Completed at | null |

## Project Context
- Product: Example App — task management for teams
- Stack: Rails API + React frontend + React Native mobile
- Test command: pnpm test (inferred from package.json)
- Issue tracker: Linear (detected via MCP)
- Monorepo: yes (apps/api, apps/web-client, apps/mobile)
- CLAUDE.md: present
- AGENTS.md: present
- Strategy: present

## Decisions
- Platform: frontend (frontend + backend files modified)
- Spec review: passed (commit abc123)
- Plan review: passed (commit def456)
- Continuous execution: authorized
- Contract gate: passed (commit ghi789) — frontend detected, gate required
- Design critique: required (frontend files modified)
- E2E: yes (CRUD flow)

## Tasks (always present — sourced from RFC Issue sections)

| Issue # | Title | Size | Status | Branch | PR |
|---------|-------|------|--------|--------|----|
| 1 | First task | S | done | feat/first-task | #312 |
| 2 | Second task | M | in-progress | feat/second-task | — |

Tasks are populated during intake by reading the RFC HTML file (`.issue-detail` cards). Single-task sessions have one row. The RFC is the single source of truth for task decomposition — not Linear sub-issues or backlog `children:` fields. See "Valid Task Status Values" above for allowed Status values.

## Key Files
- backend/app/controllers/api/v1/features_controller.rb
- frontend/src/features/feature-name/FeatureList.tsx

## Design Critique
- Status: pending
- Size routing: S (lite, 1 round) | M/L/XL (full)
- Report: (not yet run)

## QA
- QA verdict: pending
- Ship recommendation: pending
- Issues found: pending
- Issues fixed: none
- Issues deferred: none
- Confidence: pending
- Re-runs: 0

## Review
- Review gate: pending

## Merge-Watch
- Stage: pending
- PR: (not yet created)
- Gate 1 (CI): pending
- Gate 2 (Claude review): pending
- Gate 3 (Codex review): pending
- Gate 4 (Comments): pending
- Gate 5 (Conflicts): pending

## Per-Task Events (multi-task only — written by Step 05 checkpoint)
- Task 1: reviews=0, CI runs=1, conflict commits=0, verdict=Merged
- Task 2: reviews=2, CI runs=3, conflict commits=1, verdict=Merged
- Task 3: verdict=Blocked (reason: missing API endpoint)

Per-task agents handle QA/review/ship internally. This section aggregates key events extracted from each task's PR after the agent returns, so retro (Step 09) can learn from them. See Step 05 checkpoint for extraction logic.

## Linear Context (if sourced from Linear)
| Field | Value |
|-------|-------|
| Linear ID | {ID or null} |
| Linear readiness | dev-ready / needs-groom / null |
| Linear fetch | succeeded / failed / null |
| Linear gaps | [missing-ac, vague-scope, unclear-size] or [] |
| Linear labels | {labels or []} |

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

## Update Rules

- Write the full file (not append) at each stage transition
- Keep `Stage started at` current at every stage transition and set `Completed at` when the session finishes
- Include all decisions made so far — a cold reader should understand the full context
- After design critique, add the report path
- Resume Instructions section must be populated at every stage transition. A cold reader should be able to continue the session from this section alone.
- After retro, delete the file
