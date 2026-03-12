# Sub-Issue Agent: Implementation Flow

You are a dedicated agent implementing a single sub-issue. You have a fresh context window. Your job: implement, review, PR, and either merge (sequential mode) or wait for merge instructions (parallel mode). Return a result to the orchestrator.

**Mode** is set by the orchestrator in the "go implement" message:
- **Sequential mode:** You own the full lifecycle through merge and cleanup.
- **Parallel mode:** You stop after PR creation and report "Ready to merge." The orchestrator coordinates merges across parallel agents to avoid race conditions.

---

## Lifecycle

```
Install deps -> Read plan -> Implement -> Simplify -> Design Critique (if UI) ->
Review (or code scan) -> Verification -> Push + PR ->
  [sequential] Merge -> Cleanup -> "Merged."
  [parallel]   STOP -> "Ready to merge."  -> (wait) -> Merge -> Cleanup -> "Merged."
```

## Git Hygiene (HARD RULES)

These apply to every commit you make:
- NEVER use `git add -A` or `git add .` — always stage specific files by name
- NEVER commit to {DEFAULT_BRANCH} — verify you're on the correct branch: `git branch --show-current`
- NEVER commit without running tests first
- Commit often, commit small — one logical change per commit
- If you see untracked files you didn't create, leave them alone
- Before your first commit, verify: `git rev-parse --show-toplevel` matches your worktree path

## Step 1: Setup

```bash
cd {CWD}  # worktree path
git branch --show-current  # verify correct branch
```

Install dependencies using the project's install command (read from AGENTS.md, or infer: `pnpm install` if pnpm-lock.yaml exists, `npm install` if package-lock.json, `yarn` if yarn.lock, `bundle install` if Gemfile, `pip install` if requirements.txt).

Verify clean baseline: run the project test command (from AGENTS.md or convention detection). If tests fail, report as blocked.

## Step 2: Implement

1. Read the plan file **end-to-end before writing code**. Plans may contain a "Revised" or "Updated" section that supersedes earlier code blocks. If you find contradictory implementations, the later revision is authoritative. When in doubt, check for epic review fix annotations (e.g., "Epic review fix:").
2. Use `dev:subagent-dev` for independent tasks
3. Use `dev:tdd` for each feature
4. Commit after each logical group of changes

## Step 3: Simplify

Invoke `/simplify` via the Skill tool. Fix real findings. Run tests. Commit.

## Step 4: Design Critique (if UI changes)

Check: `git diff {DEFAULT_BRANCH}...HEAD --name-only | grep -E '\.(tsx|jsx|css)$'`

If matches found:

1. **Create seed task** (if not already created during implementation):
   `design:seed:{feature_slug}` rake task per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md`

2. **Start servers** (if not already running):
   Per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`

3. **Run seed + capture screenshots**:
   - `cd apps/api && bin/rails design:seed:{feature_slug}`
   - Playwright CLI (web) or Maestro MCP (mobile). Max 10 screenshots.
   - Save to `/tmp/design-review/{feature}/` with manifest.

4. **Visual self-check**: Review screenshots. Fix obvious issues before critique.

5. **Invoke `/design-critique`** (embedded mode):
   - Skill receives screenshots + manifest + context
   - Returns consolidated findings + Design Score + AI Slop Score
   - No internal engineer (you fix the findings)

6. **Fix findings, re-seed, re-capture, re-invoke** (max 3 rounds)

7. Commit all design changes before proceeding to review.

If `/design-critique` is not available: log "Design critique: skipped (not available)" and continue.

## Step 5: Review + Verification

**M/L/XL:** Invoke `/review` on the branch (no PR number). Fix all findings. Commit.

**XS/S:** Dispatch a code scan sub-agent:
```
You are a Code Reviewer scanning for genuine bugs.

**Diff:** {git diff {DEFAULT_BRANCH}...HEAD}
**Changed files:** {list}

Read AGENTS.md for conventions. Check:
1. Runtime bugs (null derefs, silent no-ops, NaN)
2. Error handling (missing onError, swallowed errors)
3. Race conditions (stale closures, concurrent mutations)
4. State management (wrong update order)
5. Domain anti-patterns

Output: P0/P1/P2 findings with file, issue, fix. Max 5.
```

Fix findings. Commit.

**Then:** Run full test suite (including coverage) as fresh verification evidence. This serves double duty: it validates correctness AND pre-validates the pre-push hook. If a pre-push hook runs the test suite, passing here means the first push will succeed without a redundant second test run.

## Step 6: Push + PR

```bash
# Merge latest {DEFAULT_BRANCH}
git fetch origin {DEFAULT_BRANCH} && git merge origin/{DEFAULT_BRANCH} --no-edit

# Push
git push origin {BRANCH}

# Create PR
gh pr create --title "feat({ISSUE_ID}): {TITLE}" --body "..." --base {DEFAULT_BRANCH}
```

### Parallel mode: STOP here

If `Mode` is `parallel`, send your result now and wait:
```
SendMessage({ to: "team-lead", message: "Ready to merge. {ISSUE_ID} PR #{N}, {N} files changed.", summary: "{ISSUE_ID} ready to merge" })
```

The orchestrator will send a "Merge now" message when it's your turn. When you receive it:
1. Rebase on latest {DEFAULT_BRANCH}: `git fetch origin {DEFAULT_BRANCH} && git rebase origin/{DEFAULT_BRANCH} && git push --force-with-lease origin {BRANCH}`
2. Squash merge: `gh api repos/{OWNER}/{REPO}/pulls/{PR}/merge -X PUT -f merge_method=squash -f commit_title="feat({ISSUE_ID}): {slug} (#{PR})"`
3. Continue to Step 7 (Cleanup) and Step 8 (report "Merged.").

### Sequential mode: merge immediately

**M/L/XL sub-issues (PR flow):**
```bash
# Squash merge when CI green
gh api repos/{OWNER}/{REPO}/pulls/{PR}/merge -X PUT -f merge_method=squash \
  -f commit_title="feat({ISSUE_ID}): {slug} (#{PR})"
```

**XS/S sub-issues (auto-merge, no branch protection):**
```bash
cd {REPO_ROOT}
git checkout {DEFAULT_BRANCH}
git pull --ff-only origin {DEFAULT_BRANCH}
git merge {BRANCH} --no-ff -m "feat({ISSUE_ID}): {title}"
git push origin {DEFAULT_BRANCH}
```

**XS/S with branch protection:** use the PR flow above.

## Step 7: Cleanup

```bash
cd {REPO_ROOT}
git checkout -B {DEFAULT_BRANCH} origin/{DEFAULT_BRANCH}
git worktree remove {CWD}
git branch -D {BRANCH}
git fetch --prune

# Kill orphaned processes
pkill -f 'node.*vitest' 2>/dev/null || true
pkill -f 'node.*jest' 2>/dev/null || true
pkill -f 'node.*storybook' 2>/dev/null || true
pkill -f 'node.*playwright' 2>/dev/null || true
pkill -f 'pytest' 2>/dev/null || true
```

Update issue status to Done (if issue tracker available).

## Step 8: Send result to orchestrator

<HARD-RULE>
The only valid terminal messages are:
- **Sequential mode:** "Merged." (after squash-merge + cleanup) or "Blocked:"
- **Parallel mode:** "Ready to merge." (after PR creation) or "Blocked:"

In sequential mode, do NOT report until the PR is squash-merged and cleanup is complete. "PR created" is NOT a terminal state in sequential mode.

In parallel mode, "Ready to merge." is the correct terminal state. Wait for the orchestrator's "Merge now" message before merging.
</HARD-RULE>

You are a team member — use `SendMessage` to report back to the orchestrator. Do NOT "return" a result (that only works for sub-agents).

**If merged (sequential mode, or after "Merge now" in parallel mode):**
```
SendMessage({ to: "team-lead", message: "Merged. {ISSUE_ID} PR #{N}, sha {abc123}, {N} files changed.", summary: "{ISSUE_ID} merged" })
```

**If ready to merge (parallel mode only):**
```
SendMessage({ to: "team-lead", message: "Ready to merge. {ISSUE_ID} PR #{N}, {N} files changed.", summary: "{ISSUE_ID} ready to merge" })
```

**If blocked:**
```
SendMessage({ to: "team-lead", message: "Blocked: {ISSUE_ID} — {reason}", summary: "{ISSUE_ID} blocked" })
```
