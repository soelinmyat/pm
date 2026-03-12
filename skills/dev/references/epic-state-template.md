# State File Template (.pm/dev-sessions/epic-{parent-slug}.md)

Single source of truth for session state. Lives under `.pm/dev-sessions/`. Updated at every stage transition. Deleted after retro. Namespaced by parent slug to allow concurrent epics.

```markdown
# Dev Epic Session State

| Field | Value |
|-------|-------|
| Stage | intake | planning | epic-review | implementing | wrap-up |
| Parent Issue | {ISSUE_ID} |
| Parent Title | [title] |
| Source | groomed | raw |
| Merge strategy | PR required | direct push allowed |
| Repo root | /path/to/project |

## Sub-Issues

| # | ID | Title | Size | Dependency | Plan | Status | Retries |
|---|----|-------|------|------------|------|--------|---------|
| 1 | ISSUE-001 | First sub-issue | S | none | docs/plans/YYYY-MM-DD-slug.md | Merged (PR #312) | 0 |
| 2 | ISSUE-002 | Second sub-issue | M | ISSUE-001 | docs/plans/YYYY-MM-DD-slug.md | Implementing (review) | 1 |
| 3 | ISSUE-003 | Third sub-issue | S | ISSUE-002 | pending | Pending | 0 |

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
```
