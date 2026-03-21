---
name: pr
description: "PR preparation lifecycle: review, push, create PR, code review, CI monitor + auto-fix, then hand off to /merge-watch"
---

# /pr

**State file convention:** The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If not found, check legacy path `.dev-state-{slug}.md`. References to `.dev-state.md` below mean `.pm/dev-sessions/{slug}.md`.

PR preparation lifecycle in one command. Reviews, pushes, creates a PR, monitors CI, and hands off to `/merge-watch`.

---

## Step 1: Pre-flight

### Verify branch

Run `git branch --show-current`. If on `main` or `master`:
- STOP. Report: "You are on main. Create a feature branch first."

### Check for uncommitted changes

Run `git status --porcelain`.

If there are uncommitted changes:
1. Show the user what's changed: `git diff --stat`
2. Stage related files (NOT `git add -A` — be selective)
3. Commit with a descriptive message based on the changes

If working tree is clean, continue.

---

## Step 2: Check & Fix Conflicts

### Check if branch is behind main

Run: `git fetch origin main && git log HEAD..origin/main --oneline`

**If no output:** Branch is up to date with main. Continue to Step 3.

**If there are commits behind:**

1. Merge main into the branch:
   ```bash
   git merge origin/main
   ```

2. **If merge succeeds cleanly:** Continue to Step 3.

3. **If merge has conflicts:**
   - Run `git diff --name-only --diff-filter=U` to list conflicted files
   - **If a lockfile is conflicted** (`pnpm-lock.yaml`, `yarn.lock`, `Gemfile.lock`, `package-lock.json`): Accept either side, then regenerate with the project's install command (from AGENTS.md or convention detection). Do NOT manually resolve lockfile conflicts.
   - For each other conflicted file:
     - Read the file and understand both sides of the conflict
     - Resolve the conflict preserving the intent of both changes
     - Stage the resolved file: `git add [file]`
   - Commit the merge: `git commit -m "merge: resolve conflicts with main"`
   - Run relevant verification commands for the resolved files (see AGENTS.md)
   - If tests fail after resolution, fix and amend the merge commit

---

## Step 3: Review

Run the `/review` command in branch mode (no PR number argument):

```
Invoke /review (no arguments — it will diff current branch against main)
```

This runs review agents in parallel, auto-fixes all findings, and commits fixes.

Code review is skipped at this stage (no PR exists yet).

If `/review` reports "No changes to review", stop — there's nothing to push.

---

## Step 4: Push

### Pre-push hook preparation

Read AGENTS.md for any pre-push hook setup commands the project requires. Common patterns:
- API spec generation (e.g., OpenAPI/Swagger spec must be up to date)
- E2E environment (simulator/emulator must be running for mobile E2E hooks)
- Build artifacts (shared packages must be built in monorepos)

Run any documented setup commands before pushing.

### Attempt push

Run `git push`. If no upstream tracking branch exists, use `git push -u origin HEAD`.

### Handle result

**If push succeeds:** Continue to Step 5.

**If push fails due to hooks:**

Parse the hook error output generically — do NOT rely on hardcoded hook names. Diagnose from the error message.

**First: check if failures are pre-existing on main.**

```bash
# Stash current work, check out main, run the failing command
git stash
git checkout main
# Run the same command that failed in the hook (test suite, lint, etc.)
# If it ALSO fails on main: these are pre-existing failures, not caused by this branch
git checkout -  # return to feature branch
git stash pop
```

**If failures are pre-existing (also fail on main):**
1. Fix them in a separate commit with message: `fix: resolve pre-existing {test/lint/spec} failures`
2. This is not optional. Pre-existing failures still block the push and must be fixed.
3. Check AGENTS.md for common pre-push setup (e.g., `bin/sync-api --spec` for API spec generation, `pnpm build` for shared packages in monorepos). Run these first as they often resolve pre-existing issues.

**If failures are new (pass on main, fail on branch):**
- Fix the issue (missing build artifact, failing test, lint error)
- Re-commit if needed: `git commit --amend` or new fix commit

**In both cases:** Retry push (max 3 attempts).

After 3 failed push attempts: stop, report the error details with actionable diagnosis, ask user for guidance.

NEVER use `--no-verify` to bypass hook failures. All failures must be fixed.

**If push fails for other reasons** (auth, network, etc.): Report the error and stop.

---

## Step 5: Create or Detect PR

### Check for existing PR

Run: `gh pr view --json number,url,title,state 2>/dev/null`

**If PR exists and is open:**
- Report: "PR #N already exists: [URL]"
- Continue to Step 6

**If no PR exists:**

1. Get context for PR description:
   - `git log main..HEAD --oneline` for commit summary
   - `git diff main...HEAD --stat` for files changed

2. Create the PR:
   ```
   gh pr create --title "[descriptive title]" --body "$(cat <<'EOF'
   ## Summary
   [2-3 bullet points from commit log]

   ## Test plan
   - [ ] Verify [key behavior 1]
   - [ ] Verify [key behavior 2]
   EOF
   )"
   ```

3. Report the PR URL

4. **Request Codex review (if configured):**
   Check `dev/instructions.md` for `codex_review: true`. If enabled:
   ```bash
   gh pr comment $PR_NUMBER --body "@codex review"
   ```
   Default: skip Codex review request unless explicitly enabled.

---

## Step 6: Code Review

Now that a PR exists, run the official code review skill:

```
Invoke the Skill tool: skill: "code-review:code-review", args: "[PR_NUMBER]"
```

This posts findings as GitHub PR comments. No auto-fix needed — the findings are for the reviewer to see.

---

## Step 7: Monitor CI + Auto-fix (Pre-Merge)

### Watch CI run

1. Get the current branch: `git branch --show-current`
2. Find the latest run: `gh run list --branch [branch] --limit 1 --json databaseId,status`
3. Watch in background: `gh run watch [run-id] --exit-status` (use `run_in_background: true`)
4. Continue with other work while CI runs. You'll be notified when it completes.
5. When notified:
   - Exit code 0 = success, proceed to Step 8 handoff
   - Non-zero = failure, proceed to "Handle CI result" below

### Handle CI result

**If conclusion is "success":** Continue to Step 8 (`/merge-watch` handoff).

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs: `gh run view [run-id] --log-failed`
2. Categorize failures: test failures, lint errors, build errors, security issues
3. Fix each issue using project-appropriate tools (check AGENTS.md for lint/fix commands)
4. Commit fixes with descriptive message
5. Push: `git push`
6. Return to polling (Step 7, top)

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.

---

## Step 8: Handoff to /merge-watch

After CI passes:

1. Update `.pm/dev-sessions/{slug}.md` with a self-contained handoff block:

```markdown
## Merge-Watch
- Stage: merge-watch
- PR: #N (URL)
- Gate 1 (CI): passed
- Gate 2 (Claude review): posted / pending
- Gate 3 (Codex review): posted / pending / skipped (not configured)
- Gate 4 (Comments): [N unresolved]
- Gate 5 (Conflicts): clean / unknown

## Resume Instructions
- Next action: Run `/merge-watch N`
- Context: Continue from Gate 2-5 checks and resolve any unresolved review threads.
- Command: /merge-watch N
```

2. If `.pm/dev-sessions/{slug}.md` does not exist, create it (run `mkdir -p .pm/dev-sessions` first) with the block above.
3. Invoke `/merge-watch N` immediately (unless the user explicitly asks to stop after PR creation).

## Final Report

After Step 8 handoff (or if the user stops before handoff):

```
## PR Complete

**PR:** [URL]
**Branch:** [branch name]
**Review:** [summary — N issues found and fixed by review agents]
**Code Review:** [posted to PR]
**CI:** [passed/failed after N rounds]
**Merge-Watch:** [started via /merge-watch N / deferred by user]
```

---

## GitHub Review Comment API Reference

When replying to or resolving PR review comments, use these patterns:

### Reply to inline review comments

Use the `/replies` sub-endpoint on the specific comment ID:

```bash
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments/<comment-id>/replies \
  -X POST -f body="Fixed in <commit-sha>. <brief description>."
```

**IMPORTANT:** Do NOT use `-F in_reply_to_id=` on the top-level comments endpoint — it returns 422. Always use the `/replies` sub-endpoint.

### Resolve review threads via GraphQL

```bash
# 1. Get unresolved thread node IDs
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: '$PR_NUMBER') {
      reviewThreads(first: 100) {
        nodes { id isResolved }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id'

# 2. Resolve threads (batch in one mutation)
gh api graphql -f query='
mutation {
  t1: resolveReviewThread(input: {threadId: "<ID_1>"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "<ID_2>"}) { thread { isResolved } }
}'
```

---

## Critical Rules

- NEVER use `--no-verify`. All hook failures must be fixed, no exceptions.
- NEVER commit to main
- After 3 CI fix attempts, ask user before continuing
- Create descriptive commit messages for all auto-fix commits
- Preserve existing functionality while fixing CI issues
- NEVER skip the review step — it catches issues before they hit CI
- If `/review` reports no changes, stop — there's nothing to ship
- `/pr` should not own final merge/cleanup; delegate to `/merge-watch` after CI is green
