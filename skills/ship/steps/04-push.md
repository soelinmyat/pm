---
name: Push
order: 4
description: Push branch to remote, handle pre-push hook failures with diagnosis and fix
---

## Push

<!-- telemetry step: push -->

**Goal:** Push the branch to the remote, diagnosing and fixing any hook failures along the way.

**Done-when:** `git push` exits 0 and the branch has a tracking upstream on origin.

### Pre-push hook preparation

Read AGENTS.md for any pre-push hook setup commands the project requires. Common patterns:
- API spec generation (e.g., OpenAPI/Swagger spec must be up to date)
- E2E environment (simulator/emulator must be running for mobile E2E hooks)
- Build artifacts (shared packages must be built in monorepos)

Run any documented setup commands before pushing.

### Attempt push

Run `git push` with `timeout: 600000` (pre-push hooks can take 5-10 min). If no upstream tracking branch exists, use `git push -u origin HEAD`.

### Handle result

**If push succeeds:** Continue to the next step.

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
