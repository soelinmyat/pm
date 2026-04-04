# State File Template (.pm/dev-sessions/epic-{parent-slug}.md)

Single source of truth for session state. Lives under `.pm/dev-sessions/`. Updated at every stage transition. Deleted after retro. Namespaced by parent slug to allow concurrent epics.

```markdown
# Dev Epic Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | intake | planning | epic-review | implementing | wrap-up |
| Parent Issue | {ISSUE_ID} |
| Parent Title | [title] |
| Source | groomed | raw |
| Merge strategy | PR required | direct push allowed |
| Repo root | /path/to/project |
| Started at | {ISO 8601 timestamp, e.g. 2026-04-02T07:00:20Z} |
| Stage started at | {ISO 8601 timestamp — updated on every stage transition} |
| Completed at | null | {ISO 8601 timestamp on completion} |

## Sub-Issues

| # | ID | Title | Size | Dependency | Plan | Status | Retries | Started | Completed |
|---|----|-------|------|------------|------|--------|---------|---------|-----------| 
| 1 | ISSUE-001 | First sub-issue | S | none | docs/plans/YYYY-MM-DD-slug.md | Merged (PR #312) | 0 | 2026-04-01T09:30Z | 2026-04-01T12:33Z |
| 2 | ISSUE-002 | Second sub-issue | M | ISSUE-001 | docs/plans/YYYY-MM-DD-slug.md | Implementing (review) | 1 | 2026-04-01T12:40Z | — |
| 3 | ISSUE-003 | Third sub-issue | S | ISSUE-002 | pending | Pending | 0 | — | — |

## Decisions
- Source: groomed
- Merge strategy: PR required (pre-push hook detected)
- Epic review: passed (commit abc123)
- Continuous execution: authorized

## Planning Progress
- [x] ISSUE-001: Plan written (commit abc123)
- [x] ISSUE-002: Plan written (commit def456)
- [ ] ISSUE-003: Planning...

## Implementation Progress
- [x] ISSUE-001: Merged (PR #312, commit abc123)
- [ ] ISSUE-002: Implementing... (Stage: review)
- [ ] ISSUE-003: Pending

## Resilience Summary
- Sub-issues completed: 1/3
- Agent failures: 1 (retries: 1)
- Failed sub-issues: none

## Resume Instructions
- Stage: implementing sub-issue 2 of 3
- Current sub-issue: ISSUE-002 (Stage: review)
- Next action: Fix review findings, then PR
- Worktree: .worktrees/slug
- Branch: feat/slug
- Blockers: none

## Session Summary
_Appended on completion, before archiving to `.pm/dev-sessions/completed/`._
- **Total:** 14h32m (2026-04-01T07:00Z → 2026-04-01T21:32Z)
- **Planning:** 2h18m
- **Epic review:** 0h22m
- **Implementation:** 11h04m
  - ISSUE-001: 3h03m
  - ISSUE-002: 4h21m
  - ISSUE-003: 3h40m
- **Wrap-up:** 0h47m
- **Retries:** 1 (ISSUE-002 agent replaced once)
```
