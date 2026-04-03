---
name: ship
description: "Ship workflow: review, push, create PR, code review, CI monitor + auto-fix, then poll readiness gates and auto-merge. Also handles existing PRs: resolve review comments (Codex, Claude, human), fix CI failures, and keep iterating until merged. Triggers on 'ship it,' 'let's ship,' 'let's ship it,' 'ready to ship,' 'ship this,' 'push,' 'push this,' 'merge,' 'deploy,' 'land,' 'land this,' 'create PR,' 'open PR,' 'pull request,' 'ready for review,' 'submit PR,' 'PR,' 'fix PR comments,' 'resolve CI,' 'get this merged,' 'handle PR,' 'fix review feedback.' Also includes /merge for manual merge + cleanup."
---

# /ship

**State file convention:** The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If not found, check legacy path `.dev-state-{slug}.md`. References to `.dev-state.md` below mean `.pm/dev-sessions/{slug}.md`.

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## Default Branch

Read `{DEFAULT_BRANCH}` from `.pm/dev-sessions/{slug}.md` if available. Otherwise detect:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

All git commands below use `{DEFAULT_BRANCH}` — never hardcode `main`.

---

## Prerequisites

Before starting, verify required tools are available:

```bash
command -v gh >/dev/null 2>&1 || { echo "GitHub CLI (gh) is required for PR creation and merging. Install: https://cli.github.com"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required."; exit 1; }
```

If `gh` is missing, tell the user: "Ship requires GitHub CLI. Install it from https://cli.github.com and run `gh auth login`."

If `gh auth status` fails, tell the user: "GitHub CLI is not authenticated. Run `gh auth login` first."

---

# Phase 1: PR Preparation

## Step 1: Pre-flight

### Verify branch

Run `git branch --show-current`. If on `{DEFAULT_BRANCH}`:
- STOP. Report: "You are on {DEFAULT_BRANCH}. Create a feature branch first."

### Check for uncommitted changes

Run `git status --porcelain`.

If there are uncommitted changes:
1. Show the user what's changed: `git diff --stat`
2. Stage related files (NOT `git add -A` — be selective)
3. Commit with a descriptive message based on the changes

If working tree is clean, continue.

---

## Step 2: Check & Fix Conflicts

### Check if branch is behind {DEFAULT_BRANCH}

Run: `git fetch origin {DEFAULT_BRANCH} && git log HEAD..origin/{DEFAULT_BRANCH} --oneline`

**If no output:** Branch is up to date with {DEFAULT_BRANCH}. Continue to Step 3.

**If there are commits behind:**

1. Merge {DEFAULT_BRANCH} into the branch:
   ```bash
   git merge origin/{DEFAULT_BRANCH}
   ```

2. **If merge succeeds cleanly:** Continue to Step 3.

3. **If merge has conflicts:**
   - Run `git diff --name-only --diff-filter=U` to list conflicted files
   - **If a lockfile is conflicted** (`pnpm-lock.yaml`, `yarn.lock`, `Gemfile.lock`, `package-lock.json`): Accept either side, then regenerate with the project's install command (from AGENTS.md or convention detection). Do NOT manually resolve lockfile conflicts.
   - For each other conflicted file:
     - Read the file and understand both sides of the conflict
     - Resolve the conflict preserving the intent of both changes
     - Stage the resolved file: `git add [file]`
   - Commit the merge: `git commit -m "merge: resolve conflicts with {DEFAULT_BRANCH}"`
   - Run relevant verification commands for the resolved files (see AGENTS.md)
   - If tests fail after resolution, fix and amend the merge commit

---

## Step 3: Review

**Skip if already reviewed:** Check `.pm/dev-sessions/*.md` for the current branch. If the state file shows `Review gate: passed` and no new commits exist since that review (compare commit SHA), skip this step and proceed to push. Log: "Review gate already passed in dev session — skipping."

**Otherwise:** Run the `/review` command in branch mode (no PR number argument):

```
Invoke /review (no arguments — it will diff current branch against the default branch)
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

Run `git push` with `timeout: 600000` (pre-push hooks can take 5-10 min). If no upstream tracking branch exists, use `git push -u origin HEAD`.

### Handle result

**If push succeeds:** Continue to Step 5.

**If push fails due to hooks:**

Parse the hook error output generically — do NOT rely on hardcoded hook names. Diagnose from the error message.

**First: check if failures are pre-existing on {DEFAULT_BRANCH}.**

```bash
# Use a temporary worktree to check {DEFAULT_BRANCH} without stashing (avoids blind stash recovery)
git worktree add /tmp/check-default-$$ {DEFAULT_BRANCH} --quiet
cd /tmp/check-default-$$
# Run the same command that failed in the hook (test suite, lint, etc.)
# If it ALSO fails on {DEFAULT_BRANCH}: these are pre-existing failures, not caused by this branch
cd -
git worktree remove /tmp/check-default-$$ --force 2>/dev/null || true
```

**If failures are pre-existing (also fail on {DEFAULT_BRANCH}):**
1. Fix them in a separate commit with message: `fix: resolve pre-existing {test/lint/spec} failures`
2. This is not optional. Pre-existing failures still block the push and must be fixed.
3. Check AGENTS.md for common pre-push setup (e.g., `bin/sync-api --spec` for API spec generation, `pnpm build` for shared packages in monorepos). Run these first as they often resolve pre-existing issues.

**If failures are new (pass on {DEFAULT_BRANCH}, fail on branch):**
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
   - `git log {DEFAULT_BRANCH}..HEAD --oneline` for commit summary
   - `git diff {DEFAULT_BRANCH}...HEAD --stat` for files changed

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
   - Exit code 0 = success, proceed to Phase 2
   - Non-zero = failure, proceed to "Handle CI result" below

### Handle CI result

**If conclusion is "success":** Continue to Phase 2 (Gate Monitoring).

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs: `gh run view [run-id] --log-failed`
2. Categorize failures: test failures, lint errors, build errors, security issues
3. Fix each issue using project-appropriate tools (check AGENTS.md for lint/fix commands)
4. Commit fixes with descriptive message
5. Push: `git push` (use `timeout: 600000`)
6. Return to polling (Step 7, top)

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.

---

# Phase 2: Merge Loop

After PR is created and code review is posted, run the self-healing merge loop.

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` for the full procedure.

**Ship-specific additions** (on top of the shared merge loop):

1. **Codex review gate:** If `codex_review: true` in `dev/instructions.md`, wait for Codex bot comment before merging. 5-minute cooldown after @codex comment. After 15 min total, ask user: proceed without or keep waiting.
2. **Claude review gate:** Verify `code-review:code-review` posted comments to PR. If not present, re-invoke it.
3. **State file updates:** Update `.pm/dev-sessions/{slug}.md` at every gate-check cycle with current status.

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
**Code Review:** [posted to PR]
**CI:** [passed after N rounds]
**Merged to:** {DEFAULT_BRANCH} ([short sha])
**Remote branch:** [branch] — deleted
**Local branch:** [branch] — deleted
**Worktree:** [removed at path / n/a]
```
