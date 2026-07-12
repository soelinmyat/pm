---
name: Merge Loop
order: 7
description: Self-healing merge loop with gate monitoring, auto-merge, cleanup, and Product Memory updates
---

## Phase 2: Merge Loop

<!-- telemetry step: merge-monitor -->

**Goal:** Drive the PR through all readiness gates to a confirmed merge, then clean up.

### Pre-merge gate attestation (HARD-GATE)

Before arming auto-merge or invoking `gh pr merge`, re-verify the gate attestation:

1. Resolve `remote_tip="$(git rev-parse origin/{branch})"` — the tree that would actually merge.
2. Read canonical `.pm/dev-sessions/{slug}/gates.json`. For each required row, the effective attestation is `commit` when it equals `remote_tip`, otherwise `verified_commit` when it equals `remote_tip`.
3. Compute changed files with `changed_files="$(git diff --name-only origin/{DEFAULT_BRANCH}...origin/{branch} | paste -sd, -)"`.
4. Set `PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"`, then run `node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" --manifest .pm/dev-sessions/{slug}/gates.json --commit "$remote_tip" --branch "{branch}" --review-evidence-mode enforce --changed-files "$changed_files"`. The checker is the authority for effective attestation; do not require every raw `commit` field to equal the remote tip.
5. If every required row is effectively attested and the checker passes: proceed to the merge loop.
6. If any row is missing or neither `commit` nor `verified_commit` matches `remote_tip` — fix commits, rebases, or auto-fixes have landed since the last attestation — run the final recertification pass from `skills/dev/steps/08-review.md`. Rerun review and any other gate whose relevant surface changed. Only proceed once the sidecar attests the remote branch tip.

This enforces ship's Iron Law — "NEVER MERGE WITHOUT READING THE DIFF" — structurally. A stale review SHA means code is about to ship that no review ever read.

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` for the full procedure — including its "Transient failure retry (`gh`)" convention: wrap every network `gh api` / `gh pr` call in the loop with `gh_retry` so a transient 5xx / gateway / timeout does not abort the merge.

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

**Loop worker branch:** If `PM_LOOP_WORKER=1`, skip this backlog write and every Product Memory/card status write in this step. Preserve merge verification and all review/CI gates, then atomically return `merged`, `ready-for-human`, `waiting`, `blocked`, `failed`, or `noop` through `PM_LOOP_RESULT_FILE`. The loop worker verifies the PR and owns the durable transition.

After merge confirmation, if `{pm_dir}/backlog/{slug}.md` exists, update its frontmatter to record the PR number(s):

1. Read the existing frontmatter of `{pm_dir}/backlog/{slug}.md`
2. If `prs` field already exists, append the new PR number to the list. If not, create it.
3. Use quoted YAML format for PR values: `- "#N"` (the `#` is a YAML comment character — quoting is load-bearing)
4. Commit and push to the default branch so the data reaches `main` before the feature branch is deleted

**This write must happen on the default branch after merge lands, before worktree cleanup.**

### Linear-originated work

After merge, check the session state for `linear_id`. If set and `{pm_dir}/backlog/{slug}.md` does not exist, the Status Updates section in Step 08 (ship) handles backlog creation. Ship ensures the PR number is available in the session state for the backlog entry's `prs` field.

Before cleanup, verify the backlog entry was written:
- Check: `test -f {pm_dir}/backlog/{slug}.md`
- If missing and `linear_id` is set: warn the user that product memory was not created.

Finish only when the PR is confirmed merged, required Product Memory updates are complete, and cleanup is done or intentionally skipped — then print the final shipped report.

Say: "Ship complete. PR merged and cleanup finished. What would you like to work on next?"
