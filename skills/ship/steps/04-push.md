---
name: Push
order: 4
description: Push branch to remote, handle pre-push hook failures with diagnosis and fix
---

## Push

<!-- telemetry step: push -->

**Goal:** Push the branch to the remote, diagnosing and fixing any hook failures along the way.

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Before every push attempt, reload and validate the contract and require both canonical and snapshotted `push_feature_branch: true`. If authority is absent, stop before the external action and request that exact grant.

### Pre-push hook preparation

Read AGENTS.md for any pre-push hook setup commands the project requires. Common patterns:
- API spec generation (e.g., OpenAPI/Swagger spec must be up to date)
- E2E environment (simulator/emulator must be running for mobile E2E hooks)
- Build artifacts (shared packages must be built in monorepos)

Run any documented setup commands before pushing.

### Dev gate checker

Before running `git push`, ensure canonical `.pm/dev-sessions/{slug}/gates.json` has a current `verification` row. If it is missing or stale, run the full project test suite fresh using the command from AGENTS.md or the dev session's `## Project Context`, read the output, and record `verification: passed` with the command output artifact or state section path.

Read `{DELIVERY_REMOTE}` from canonical `session.json` at `source.delivery_remote`. Stop if it is absent, if the named remote no longer exists, or if its sole configured push URL, normalized GitHub owner/repo, head, base, or SHA-256 differs from the delivery contract frozen by Review. Never fall back to `origin`.

Then run the shared PM gate checker against current HEAD:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
  --manifest .pm/dev-sessions/{slug}/gates.json \
  --commit "$(git rev-parse HEAD)" \
  --branch "$(git branch --show-current)" \
  --review-evidence-mode enforce \
  --remote "{DELIVERY_REMOTE}" \
  --base "{DELIVERY_REMOTE}/{DEFAULT_BRANCH}"
```

If the manifest is missing or any required gate is missing, stop and run the missing gate first. If any required gate row is stale, run the final recertification pass from `skills/dev/steps/08-review.md`: rerun gates whose relevant surface changed, or write `verified_commit` / `verified_at` only when the existing evidence still applies to current HEAD. Do not treat green CI, a PR label, or remembered test output as a substitute for a current sidecar row.

### Attempt push

Run `git push` with `timeout: 600000` (pre-push hooks can take 5-10 min). Push explicitly to the reviewed destination; if no upstream tracking branch exists, use `git push -u -- "$DELIVERY_REMOTE" HEAD`.

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

Every hook fix, generated-file update, amend, or new commit triggers the complete post-mutation recertification protocol in `delivery-contract.md`: rerun current Review and changed routed gates, regenerate their artifacts, validate the delivery contract, and pass `dev-gate-check` on current HEAD before the next push attempt. Do not retry directly after committing a fix.

After 3 failed push attempts: stop, report the error details with actionable diagnosis, ask user for guidance.

NEVER use `--no-verify` to bypass hook failures. All failures must be fixed.

**If push fails for other reasons** (auth, network, etc.): Report the error and stop.

**Done-when:** `git push` exits 0, the pushed branch has an upstream on the exact contracted `{DELIVERY_REMOTE}`, and no local commit exists after the Review/gate evidence accepted by `dev-gate-check`.

**Advance:** proceed to Step 05 (Create or Detect PR).
