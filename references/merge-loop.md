# Merge Loop

Shared reference for the self-healing PR merge flow. Used by the `/merge` command and the ship skill's gate monitoring phase.

**Goal:** Take a PR from its current state to merged, fixing whatever comes up along the way.

---

## Step 1: Orient

Detect the PR and assess current state.

```bash
# Find PR from current branch (or from arg)
gh pr view --json number,url,title,state,mergeStateStatus,statusCheckRollup,reviewDecision
```

- If no PR exists: STOP. "No PR found for this branch."
- If PR is closed/merged: STOP. "PR #N is already {state}."
- Print current status summary:

```
Merge Status — PR #{N}: {title}
  CI:          {passing / failing / pending}
  Reviews:     {approved / changes_requested / pending}
  Conflicts:   {clean / conflicted}
  Threads:     {N unresolved} (blocks merge if repo requires conversation resolution)
```

---

## Step 2: Try Auto-Merge

Attempt to arm GitHub auto-merge. If the repo supports it, GitHub will merge automatically once all branch protection rules pass.

```bash
gh pr merge --auto --squash
```

- **If accepted:** Auto-merge is armed. The agent's job is now fix-only — fix CI failures, resolve review comments, resolve conflicts. GitHub handles the actual merge when everything's green.
- **If rejected** (repo doesn't allow auto-merge, or branch protection not configured): Manual path — the agent must merge via `gh pr merge --squash --delete-branch` after all gates pass.

Note which path we're on. Print:

```
Auto-merge: {armed / unavailable (manual merge required)}
```

---

## Step 3: Fix Loop

Iterate until all gates are green or the agent is stuck. Check all gates each iteration.

### Gate checks (in priority order)

**1. Merge conflicts**

```bash
gh pr view --json mergeStateStatus --jq .mergeStateStatus
```

If `DIRTY`:
- Fetch and merge base branch: `git fetch origin {DEFAULT_BRANCH} && git merge origin/{DEFAULT_BRANCH}`
- Resolve conflicts (lockfiles: accept either side + regenerate; code: preserve intent of both)
- Run tests to verify resolution
- Commit and push

**2. CI status**

```bash
gh pr checks --json name,state,conclusion
```

If any check failed:
- Get failure logs: `gh run view [run-id] --log-failed`
- Investigate root cause before fixing (don't guess)
- Fix, commit, push
- Wait for new CI run to complete

If checks are pending:
- Watch in background: `gh run watch [run-id] --exit-status` (use `run_in_background: true`)
- Continue checking other gates while CI runs

**3. Review comments**

```bash
# Fetch unresolved threads
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 10) {
            nodes { body author { login } path line }
          }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

For each unresolved thread:

| Comment type | Action |
|-------------|--------|
| Code fix (bug, style, missing check) | Fix the code, commit, push, reply explaining the fix, resolve the thread |
| Question (why did you do X?) | Reply with the answer, resolve the thread |
| Suggestion (consider doing X) | Evaluate: if it improves the code, apply it. If not, reply explaining why, resolve the thread |
| Design/taste decision (should we use A or B?) | **Surface to user** — don't auto-respond to subjective feedback |
| Bot noise (Linear, dependabot, CI bots) | Skip — don't resolve, don't reply |

**Reply format:**
```bash
# Reply to the comment
gh api repos/{owner}/{repo}/pulls/PR_NUMBER/comments/{comment-id}/replies \
  -X POST -f body="Fixed in {commit-sha}. {brief description}."

# Resolve the thread
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "{thread-id}"}) {
    thread { isResolved }
  }
}'
```

**IMPORTANT:** Use the `/replies` sub-endpoint on the comment ID. Do NOT use `-F in_reply_to_id=` on the top-level comments endpoint — it returns 422.

**4. Unresolved conversations (branch protection blocker)**

Many repos require all PR conversations to be resolved before merging. Unresolved threads block merge even when CI passes and reviews are approved.

After resolving threads in Gate 3, verify the count:

```bash
# Count remaining unresolved threads
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'
```

If count > 0: these are blocking merge. Loop back to Gate 3 to address remaining threads. Do NOT report "needs approval" when the actual blocker is unresolved conversations.

**5. Review approval**

```bash
gh pr view --json reviewDecision --jq .reviewDecision
```

If `CHANGES_REQUESTED` and all comment threads are resolved: the reviewer may need to re-approve. If threads are resolved and code is fixed, the fixes often satisfy the reviewer — wait for CI to pass, then check again.

If `REVIEW_REQUIRED` and no reviewers assigned: ask the user who should review.

### Gate status report

After each iteration, print:

```
Gate Check #{N}
  Conflicts:   ✓ clean
  CI:          ✗ failing (attempt 2 — fixing lint error)
  Threads:     ✓ 0 unresolved (3 resolved this cycle)
  Conversations: ✓ all resolved
  Review:      ✓ approved
  Auto-merge:  armed (will merge when CI passes)
```

### Stop conditions

The agent stops fixing and asks the user when:

- **Same CI failure recurs after a fix** — the fix didn't work, human judgment needed
- **Review comment requires a design decision** — can't be resolved by code alone
- **Merge conflict can't be resolved** — complex conflict needs human understanding
- **Reviewer explicitly blocks** — "do not merge until X" type comments

The agent does NOT stop after an arbitrary number of attempts. It keeps going as long as each fix addresses a different problem. For the same problem recurring: the agent gets two fix attempts before asking the user (the first fix might just be slightly wrong). Three total tries at the same problem (initial + 2 fixes), then escalate.

---

## Step 4: Merge

**If auto-merge was armed in Step 2:** GitHub merges automatically when all gates pass. The agent must confirm the merge actually happened:

```bash
# Verify PR was merged
gh pr view --json state --jq .state
# Must return "MERGED"
```

If state is still `"OPEN"`: auto-merge is armed but blocked. **Loop back to Step 3** — do not report success, do not proceed to cleanup. Diagnose the blocker:
1. **Unresolved conversations** — most common. Check thread count first.
2. **New review comments** arrived after the fix loop completed (e.g., from Codex review that was still in progress).
3. **Pending approvals** or **failing checks**.

**If manual merge path:**

```bash
# Final verification
gh pr view --json mergeStateStatus --jq .mergeStateStatus
# Must be CLEAN or UNSTABLE (not DIRTY or BLOCKED)

# If BLOCKED: diagnose WHY before looping back to Step 3
# Common causes (check in order):
#   1. Unresolved conversations — most frequent, check thread count first
#   2. New review comments arrived since last gate check
#   3. Missing review approval
#   4. Failed/pending CI checks

# Merge
gh pr merge --squash --delete-branch
```

After merge command, verify state is `"MERGED"`. If still `"OPEN"`, loop back to Step 3.

If merge fails: report the error and STOP. Do NOT force through.

---

## Step 5: Close the Loop (issue tracker + backlog)

<HARD-GATE>
This step runs IMMEDIATELY after merge is confirmed — before cleanup, before the final report. If the session dies during cleanup, the tracker is already updated. Do NOT skip this step. Do NOT defer it to "later."
</HARD-GATE>

**5a. Issue tracker (Linear/Jira)**

If an issue tracker is configured (Linear/Jira via MCP) and the PR title or branch name contains an issue identifier (e.g., `CLE-1380`, `PM-044`):

1. Set the issue status to **Done**
2. Add a comment with the merge SHA and PR link
3. If the issue has sub-issues, mark those Done too

**5b. Backlog file**

If a backlog file exists in `pm/backlog/` matching the issue slug:
- No action needed — backlog files are specs, not status trackers

**5c. Dev session file**

Delete or archive the `.pm/dev-sessions/{slug}.md` file. The session is complete.

---

## Step 6: Cleanup

```bash
FEATURE_BRANCH=$(git branch --show-current)
GIT_COMMON=$(git rev-parse --git-common-dir)
GIT_DIR=$(git rev-parse --git-dir)

# If in worktree: switch to main repo first
if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  WORKTREE_PATH=$(pwd)
  MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
  cd "$WORKTREE_PATH" && git checkout --detach HEAD 2>/dev/null || true
  cd "$MAIN_REPO"
fi

# Update base branch
git fetch origin {DEFAULT_BRANCH}
git checkout {DEFAULT_BRANCH}
git merge --ff-only origin/{DEFAULT_BRANCH}

# Remove worktree if applicable
if [ -n "$WORKTREE_PATH" ]; then
  git worktree remove "$WORKTREE_PATH" 2>/dev/null || \
    git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || \
    echo "WARN: Could not remove worktree at $WORKTREE_PATH"
fi

# Delete local feature branch + prune
git branch -D "$FEATURE_BRANCH" 2>/dev/null || true
git fetch --prune
```

---

## Final Report

```
Merged
  PR: #{N} — {title} ({url})
  Merged to: {DEFAULT_BRANCH} ({short sha})
  Fixes applied: {N} (CI: {n}, review comments: {n}, conflicts: {n})
  Remote branch: {branch} — deleted
  Local branch: {branch} — deleted
  Issue tracker: {issue} → Done / no issue linked
```

---

## Critical Rules

- NEVER use `--no-verify` to bypass hooks
- NEVER force-merge. If `gh pr merge` fails, STOP and report.
- NEVER merge with unresolved review threads (except bot noise)
- NEVER auto-respond to subjective/design review comments — surface to user
- NEVER commit to {DEFAULT_BRANCH} directly
- Stop after 2 failed fixes for the same problem (3 total tries), not on total attempt count
- Use `/replies` sub-endpoint for PR comments (not `in_reply_to_id`)
- Always verify remote branch was deleted after merge
- Always pull {DEFAULT_BRANCH} after merge
