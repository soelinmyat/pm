---
name: deploy
description: "Create a PR from main to production and self-heal until merged. Handles CI failures, review threads, and auto-merge. Triggers on 'deploy to production,' 'deploy,' 'release,' 'push to production,' 'promote to production,' 'production deploy.'"
---

# /deploy

Create a PR from `main` to `production`, monitor CI, self-heal failures, and auto-merge.

This is the final step after `/ship` has merged work into `main`. No code review gates are needed since code was already reviewed.

---

## Prerequisites

Before starting, verify required tools:

```bash
command -v gh >/dev/null 2>&1 || { echo "GitHub CLI (gh) is required. Install: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "GitHub CLI not authenticated. Run: gh auth login"; exit 1; }
```

If `gh` is missing or not authenticated, tell the user and stop. Deploy cannot proceed without it.

---

## Step 1: Sync Main

Ensure local `main` matches remote before creating the PR.

```bash
git fetch origin main production
git checkout main
git merge --ff-only origin/main
```

If `ff-only` fails (local main diverged): `git reset --hard origin/main`.

Print a summary of what's being deployed:

```bash
# Commits going to production
git log origin/production..origin/main --oneline
```

If no commits: STOP. "Nothing to deploy. `main` and `production` are identical."

---

## Step 2: Check for Existing PR

```bash
gh pr list --base production --head main --state open --json number,url,title
```

**If a PR already exists:** Report it and skip to Step 4 (gate monitoring).

**If no PR exists:** Continue to Step 3.

---

## Step 3: Create PR

```bash
# Build commit summary for PR body
COMMITS=$(git log origin/production..origin/main --oneline)
COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')

gh pr create \
  --base production \
  --head main \
  --title "Deploy to production" \
  --body "$(cat <<EOF
## Deploy

**$COMMIT_COUNT commit(s)** from \`main\` to \`production\`.

### Changes
\`\`\`
$COMMITS
\`\`\`
EOF
)"
```

Report: "Created PR #N: [URL]"

---

## Step 4: Arm Auto-Merge

```bash
PR_NUMBER=$(gh pr list --base production --head main --state open --json number --jq '.[0].number')
gh pr merge $PR_NUMBER --auto --merge 2>&1 || true
```

Note whether auto-merge was armed or unavailable.

**Important:** Use `--merge` (not `--squash`). Squash creates commits on production that don't exist on main, causing recurring merge conflicts on future deploys. Merge commits preserve shared history between the two branches.

---

## Step 5: Gate Monitoring Loop

Poll until all gates are green or the agent is stuck. The production branch requires:
1. `merge-gate` status check passed
2. All conversation threads resolved

### Check cycle

Each iteration, check **all three blockers** before drawing conclusions:

**1. CI status**

```bash
gh pr checks $PR_NUMBER --json name,state,bucket
```

- If all checks passed: gate clear.
- If pending: watch in background (`gh run watch [run-id] --exit-status` with `run_in_background: true`). Continue checking other gates.
- If failed: proceed to "Handle CI Failure" below.

**2. Unresolved review threads**

```bash
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

For unresolved threads: follow the same categorization as the merge loop reference:
- Code fix: fix on `main`, push, reply, resolve
- Question: answer, resolve
- Bot noise (e.g. `chatgpt-codex-connector`): resolve directly, these should never block a deploy
- Design/taste: surface to user

**3. Merge conflicts**

```bash
gh pr view $PR_NUMBER --json mergeStateStatus --jq .mergeStateStatus
```

If `DIRTY`: production has diverged from main. Create a branch from main, merge production into it with a **merge commit** (not squash), PR it to main, wait for it to merge, then re-check the deploy PR.

```bash
git checkout main && git pull --ff-only origin main
git checkout -b fix/merge-production-history
git merge origin/production  # resolve conflicts keeping main's versions
git commit  # produces a real merge commit
git push origin fix/merge-production-history
gh pr create --base main --head fix/merge-production-history --title "fix: merge production history into main"
gh pr merge <NUMBER> --auto --merge  # MUST use --merge, not --squash
```

**Important:** The resolution PR must use `--merge` (not `--squash`) so production's commits become ancestors of main. Squash merge loses the topology and the deploy PR will still show conflicts.

**4. Review decision (if still BLOCKED after all above are clear)**

```bash
gh pr view $PR_NUMBER --json mergeStateStatus,reviewDecision
```

If `reviewDecision` is `CHANGES_REQUESTED` or branch protection requires approvals: ask the user for approval. But **only after confirming** CI, threads, and conflicts are all clear. Never assume approval is the blocker without checking the other three first.

### Diagnosing BLOCKED state

When `mergeStateStatus` is `BLOCKED`, always check in this order:
1. Unresolved review threads (most common, self-fixable)
2. CI failures (self-fixable)
3. Merge conflicts (self-fixable via merge branch)
4. Review approval required (requires user action)

Only escalate to the user after exhausting self-fixable causes.

### Gate status report

After each iteration:

```
Deploy Gate #{N}
  CI:          {passing / failing / pending}
  Threads:     {0 unresolved / N unresolved}
  Conflicts:   {clean / dirty}
  Auto-merge:  {armed / unavailable}
```

---

## Handle CI Failure

When CI fails on the production PR, fixes must go through `main` (the PR head).

1. Get failure details:
   ```bash
   # Find the failed run
   gh run list --branch main --event pull_request --limit 5 --json databaseId,status,conclusion
   # Get logs
   gh run view [run-id] --log-failed
   ```

2. Diagnose the root cause. Read relevant files, understand the failure.

3. Fix on `main`:
   ```bash
   git checkout main
   # Make the fix
   git add [files]
   git commit -m "fix: [description of CI fix for production deploy]"
   git push origin main
   ```

4. Wait for new CI run, then re-check gates.

### Retry limit

Same problem recurring: 2 fix attempts (3 total tries), then ask the user.
Different problems: keep going, no arbitrary limit.

---

## Step 6: Merge

**If auto-merge armed:** GitHub merges automatically when gates pass. Confirm:

```bash
gh pr view $PR_NUMBER --json state --jq .state
# Should return "MERGED"
```

**If manual merge needed:**

```bash
gh pr view $PR_NUMBER --json mergeStateStatus --jq .mergeStateStatus
# Must be CLEAN or UNSTABLE

gh pr merge $PR_NUMBER --merge --delete-branch=false
```

**Important:** Do NOT delete the `main` branch. Use `--delete-branch=false` explicitly.

If merge fails: report the error and STOP. Never force-merge.

---

## Step 7: Cleanup

```bash
# Sync local branches
git fetch origin main production
git checkout main
git merge --ff-only origin/main

# Verify production updated
git log origin/production -1 --oneline
```

No branch deletion (both `main` and `production` are permanent).

---

## Final Report

```
Deployed
  PR: #N (URL)
  Commits: N deployed to production
  CI fixes: N (or "none needed")
  Production HEAD: [short sha] — [commit message]
```

---

## Critical Rules

- NEVER force-merge or use `--no-verify`
- NEVER delete `main` or `production` branches
- NEVER commit directly to `production`
- All fixes go through `main` (the PR updates automatically)
- If merge-gate fails repeatedly on the same issue after 2 fix attempts, ask the user
- Always use `--merge` (not `--squash`) to preserve shared branch history
- Always confirm the PR is merged before reporting success
- When BLOCKED, check threads/CI/conflicts before assuming approval is needed
