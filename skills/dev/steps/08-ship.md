---
name: Ship
order: 8
description: Push branch, create PR, merge via merge-loop, clean up worktrees, update status
---

<!-- Merged: Ship/PR flow + Stage 6 (Worktree Cleanup) + Status Updates from dev-flow.md -->

## Ship

**Multi-task skip:** If `task_count > 1` in the session state, per-task agents in Step 05 handled push/PR/merge for each task. Skip the PR creation and merge-loop sections below. **However**, the parent-level status updates MUST still run — jump directly to "Status Updates" to mark the parent backlog item and parent Linear issue as done. Verify all Linear children are actually done before closing the parent (see Step 3 below).

## Goal

Take the implemented branch through PR creation, merge, cleanup, and status write-back so delivery actually finishes cleanly.

Push the branch, create the PR, and merge via the merge-loop. Then clean up worktrees and update all status trackers.

Invoke `pm:ship` to handle the PR creation and merge-loop. The ship skill manages:
- Push branch to remote
- Create PR with summary from the RFC
- Monitor CI, code review, and merge readiness
- Squash merge when all gates pass

### Worktree Cleanup

Clean up any worktrees created during this session:

1. For each worktree created in Workspace or by dispatched agents, remove it:
   ```bash
   git worktree remove <worktree-path> --force
   ```
2. Delete any leftover branches that were only used inside worktrees:
   ```bash
   git branch -d <worktree-branch>
   ```
3. If removal fails (locked worktree), force-remove:
   ```bash
   git worktree remove <worktree-path> --force
   ```

Do NOT skip this step. Leftover worktrees consume disk and confuse subsequent sessions.

## Status Updates (ALL sizes)

<HARD-GATE>
After merge, you MUST complete ALL status updates below — both local backlog AND issue tracker (if available). Do NOT proceed to retro until every step is done. Do NOT consider the task complete without this. This applies to ALL sizes (XS/S/M/L/XL).
</HARD-GATE>

### At intake (set "In Progress")

These happen during Workspace, not after merge. Listed here for completeness.

**Local backlog:** Handled in Workspace step 7 — sets `{pm_dir}/backlog/{slug}.md` status to `in-progress`.

**Linear** (if available, ticket-originated):
```
mcp__plugin_linear_linear__save_issue({ id: "{ISSUE_ID}", state: "In Progress" })
```

For conversation-originated work (M/L/XL): create the Linear issue first, then set In Progress.

### At plan complete (M/L/XL)

**Linear** (if available):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "RFC written: {summary}" })
```

### At PR created (M/L/XL)

**Linear** (if available):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "PR opened: #{pr_number}" })
```

### After merge — set "Done" everywhere

<HARD-GATE>
You MUST complete ALL steps below in order. Local backlog updates are always required. Linear updates require user confirmation first (see Step 2b below). A merged PR with a backlog item still showing "in-progress" is a bug.
</HARD-GATE>

**Step 1: Create local backlog entry if missing.**

If `linear_id` is set in `.pm/dev-sessions/{slug}.md` (or RFC metadata) AND `{pm_dir}/backlog/{slug}.md` does NOT exist:
- Create `{pm_dir}/backlog/` if needed: `mkdir -p {pm_dir}/backlog`
- **ID rule:** When Linear is available, use the Linear identifier as the local `id`. Only fall back to local `PM-{NNN}` sequence when no tracker is configured.
- Write `{pm_dir}/backlog/{slug}.md`:
  ```yaml
  ---
  type: backlog
  id: "{linear_id}"
  title: "{title from Linear or RFC}"
  outcome: "{one-sentence from RFC summary or Linear description}"
  status: done
  priority: medium
  linear_id: "{linear_id}"
  rfc: rfcs/{slug}.html
  prs:
    - "#{pr_number}"
  created: {today's date, YYYY-MM-DD format}
  updated: {today's date, YYYY-MM-DD format}
  ---

  ## Outcome

  {Summary of what was built, derived from RFC or Linear description.}

  ## Notes

  Originated from Linear issue {linear_id}. Product memory created at ship.
  ```
- Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir pm` to verify. Fix errors before proceeding.
- Log: `Backlog created: {pm_dir}/backlog/{slug}.md (id: {linear_id})`

**Step 2: Update local backlog item(s) to done.**

Read `{pm_dir}/backlog/{slug}.md`. Update frontmatter:
- Set `status: done`
- Set `updated: {today's date}`
- If `linear_id` is available in session state and not already in frontmatter, add it
- If `prs` field exists, append `"#{pr_number}"` if not already listed

Verify the file was written: read it back and confirm `status: done`.

Log: `Backlog: {pm_dir}/backlog/{slug}.md → done`

Note: In the single-backlog model, each backlog item has its own RFC. Issue decomposition lives inside the RFC, not as separate backlog files. Ship updates only this one backlog item — there are no child backlog files to iterate.

**Step 2b: Ask user before updating Linear issues.**

If Linear is configured (`{pm_state_dir}/config.json` has `linear: true` or Linear MCP is available) AND `linear_id` is set in the session state:

> "Update Linear issues to Done? (y/n)"

Wait for the user's answer.
- **If yes:** Proceed to Steps 3, 3b, 4, and 5 (Linear updates).
- **If no:** Skip Steps 3, 3b, and 4. Jump to Step 5 (verify local backlog only — skip the Linear verification check). Say: "Skipping Linear updates. Local backlog marked done."

**Step 3: Close Linear child issues** (if tracker available, and user approved in Step 2b).

Fetch children:
```
mcp__plugin_linear_linear__list_issues({ parentId: "{ISSUE_ID}" })
```

For EACH child returned, set to Done:
```
mcp__plugin_linear_linear__save_issue({ id: "{CHILD_ISSUE_ID}", state: "Done" })
```
Log each: `Linear: {CHILD_ISSUE_ID} → Done`

**Step 3b: Verify all children are done before closing parent.**

<HARD-GATE>
Do NOT close the parent issue until ALL children are confirmed Done. Re-fetch children after the updates above and verify every child's state:
```
mcp__plugin_linear_linear__list_issues({ parentId: "{ISSUE_ID}" })
```
Check that each returned child has `state: "Done"`. If any child is still open (e.g., a per-task agent was blocked and didn't close it), log: `WARN: Child {CHILD_ID} is still {state} — not closing parent.` Ask the user whether to close the parent anyway or leave it open.
</HARD-GATE>

**Step 4: Close Linear parent issue** (if tracker available, user approved in Step 2b, and Step 3b passed).

```
mcp__plugin_linear_linear__save_issue({ id: "{ISSUE_ID}", state: "Done" })
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "Merged: {sha}" })
```
Log: `Linear: {ISSUE_ID} → Done (+ {N} children closed)`

**Step 5: Verify.**

- Read `{pm_dir}/backlog/{slug}.md` — confirm `status: done`
- If tracker available: `mcp__plugin_linear_linear__get_issue({ id: "{ISSUE_ID}" })` — confirm state is "Done"
- If either check fails, retry the update. Do NOT proceed until confirmed.

Log summary: `Status updates complete: backlog → done, Linear → Done`

## Progress Announcements (multi-task)

<HARD-RULE>
When task_count > 1, announce progress at every stage transition and after each task completes. The user should never need to ask "what's next?"

**Format:**
> **Stage N complete.** [M of N] tasks {planned/implemented/merged}. Next: {specific next action}. {Proceeding. | Approve to proceed?}

In autonomous mode (after RFC Review approval), do NOT pause for confirmation. Announce and proceed.
</HARD-RULE>

## Done-when

- PR merged and merge confirmed (not just auto-merge armed — verify PR state is MERGED)
- Worktrees cleaned up (no leftover worktrees from this session)
- All status updates complete: local backlog → done, Linear → Done (if available)
- State file updated with merge SHA and completion details
