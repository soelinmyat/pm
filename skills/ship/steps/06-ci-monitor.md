---
name: CI Monitor
order: 6
description: Monitor CI status, auto-fix failures, retry up to 3 rounds
---

## Monitor CI + Auto-fix (Pre-Merge)

<!-- telemetry step: ci-monitor -->

**Goal:** Monitor CI to green, auto-fixing failures up to 3 rounds.

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Use only its `GH_REPO`, `HEAD_BRANCH`, `BASE_BRANCH`, and the already identity-checked `PR_NUMBER`; never use ambient `gh` repository discovery.

When CI concludes `success` on the latest run, proceed to the merge loop; if 3 fix attempts are exhausted, stop and ask the user for guidance.

### Watch CI run

1. Confirm `git branch --show-current` equals `$HEAD_BRANCH` from the contract.
2. Find the latest run:
   ```bash
   gh run list --repo "$GH_REPO" --branch "$HEAD_BRANCH" --limit 1 --json databaseId,status,headSha
   ```
3. Require the run `headSha` to equal the contracted remote branch tip; an older run cannot authorize the current branch.
4. Watch in background with `run_in_background: true`:
   ```bash
   gh run watch "$RUN_ID" --repo "$GH_REPO" --exit-status
   ```
5. Continue with other work while CI runs. You'll be notified when it completes.
6. When notified:
   - Exit code 0 = success, proceed to Phase 2 (Merge Loop)
   - Non-zero = failure, proceed to "Handle CI result" below

### Handle CI result

**If conclusion is "success":** Continue to Phase 2 (Merge Loop).

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs:
   ```bash
   gh run view "$RUN_ID" --repo "$GH_REPO" --log-failed
   ```
2. Categorize failures: test failures, lint errors, build errors, security issues
3. Fix each issue using project-appropriate tools (check AGENTS.md for lint/fix commands)
4. Commit fixes with descriptive message
5. Run the full post-mutation recertification protocol from `delivery-contract.md`: rerun `pm:review`, regenerate Review and changed routed-gate artifacts for current HEAD, revalidate repository identity, and pass `dev-gate-check`.
6. Only after recertification exits cleanly, push explicitly to the contracted remote with `git push -- "$DELIVERY_REMOTE" HEAD` (use `timeout: 600000`). Never use an ambient `git push` here.
7. Return to the watch procedure at the top of this step.

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.

**Done-when:** CI reports success for the exact remote tip and every CI-fix commit has current Review/gate artifacts plus a passing `dev-gate-check` recorded before its push.

**Advance:** proceed to Step 07 (Merge Loop) only with explicit merge authority and enabled merge behavior; otherwise emit the green-PR early-exit report and stop.
