---
name: Merge Loop
order: 7
description: Self-healing merge loop with gate monitoring, auto-merge, cleanup, and Product Memory updates
---

## Phase 2: Merge Loop

<!-- telemetry step: merge-monitor -->

**Goal:** Drive the PR through all readiness gates to a confirmed merge, then clean up.

After PR is created and CI passes, run the self-healing merge loop.

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` for the full procedure.

**Ship-specific additions** (on top of the shared merge loop):

1. **Codex review gate:** If `codex_review: true` in CLAUDE.md or AGENTS.md, wait for Codex bot comment before merging. 5-minute cooldown after @codex comment. After 15 min total, ask user: proceed without or keep waiting.
2. **State file updates:** Update `.pm/dev-sessions/{slug}.md` at every gate-check cycle with current status.

### State file during gate monitoring

`.pm/dev-sessions/{slug}.md` must include:

```markdown
## Ship
- Stage: gate-monitoring
- PR: #N (URL)
- CI: passed / running / failed
- Review: approved / pending / changes_requested
- Threads: 0 unresolved / N unresolved
- Conflicts: clean / conflicted
- Auto-merge: armed / unavailable
- Fix commits: [list of fix commit SHAs]

## Resume Instructions
- Next action: [single immediate step]
- Context: [PR #, gate status, unresolved thread id/file:line]
```

### Final Report

```
## Shipped

**PR:** #N — [title] ([URL])
**Branch:** [branch name]
**Review:** [N issues found and fixed by review agents]
**CI:** [passed after N rounds]
**Merged to:** {DEFAULT_BRANCH} ([short sha])
**Remote branch:** [branch] — deleted
**Local branch:** [branch] — deleted
**Worktree:** [removed at path / n/a]
```

## Product Memory

### Backlog prs write (after merge, before cleanup)

After merge confirmation, if `{pm_dir}/backlog/{slug}.md` exists, update its frontmatter to record the PR number(s):

1. Read the existing frontmatter of `{pm_dir}/backlog/{slug}.md`
2. If `prs` field already exists, append the new PR number to the list. If not, create it.
3. Use quoted YAML format for PR values: `- "#N"` (the `#` is a YAML comment character — quoting is load-bearing)
4. Commit and push to the default branch so the data reaches `main` before the feature branch is deleted

**This write must happen on the default branch after merge lands, before worktree cleanup.**

### Linear-originated work

After merge, check the session state for `linear_id`. If set and `{pm_dir}/backlog/{slug}.md` does not exist, the Status Updates section in `dev-flow.md` handles backlog creation. Ship ensures the PR number is available in the session state for the backlog entry's `prs` field.

Before cleanup, verify the backlog entry was written:
- Check: `test -f {pm_dir}/backlog/{slug}.md`
- If missing and `linear_id` is set: warn the user that product memory was not created.

**Done-when:** The PR is confirmed merged, required Product Memory updates are complete, cleanup is finished or intentionally skipped, and the final shipped report can be printed without ambiguity.
