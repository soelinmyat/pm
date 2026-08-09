---
name: CI Monitor
order: 6
description: Monitor CI status, auto-fix failures, retry up to 3 rounds
---

## Monitor CI + Auto-fix (Pre-Merge)

<!-- telemetry step: ci-monitor -->

## Goal

Monitor CI to green, auto-fixing failures up to 3 rounds.

## How

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md` and `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Require verified `push` and `create-pr` effects, then use only their bound `GH_REPO`, `HEAD_BRANCH`, `BASE_BRANCH`, prepared commit, and PR number; never use ambient `gh` repository discovery.

Before monitoring CI on the optimized route, verify the canonical final-candidate attestation created by Step 05. Its commit must equal the release transaction's prepared commit and the observed remote branch tip, its signed complete certification must remain valid, the canonical candidate state must be `merge-ready`, and the `ready-pr` effect must be verified against the same open, non-draft PR. Missing or stale evidence returns to Review and finalization; CI cannot create or substitute for this attestation.

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

Before advancing, re-check the canonical final-candidate attestation when this delivery used the optimized route. The observed CI head must equal its frozen commit and the release transaction's prepared commit. A CI fix, review finding, changed plan/config/tool identity, or different head invalidates the attestation and returns to Review. Comprehensive deliveries have no extra finalization step and retain their existing single-certification baseline.

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs:
   ```bash
   gh run view "$RUN_ID" --repo "$GH_REPO" --log-failed
   ```
2. Categorize failures: test failures, lint errors, build errors, security issues
3. Fix each issue using project-appropriate tools (check AGENTS.md for lint/fix commands)
4. Commit fixes with descriptive message
5. Run the full post-mutation recertification protocol: advance the release transaction to current HEAD with the concrete CI-fix reason, rerun `pm:review`, regenerate and bind Review/QA/verification artifacts, replan effects for the new generation, revalidate repository identity, and pass `dev-gate-check`.
6. Only after recertification exits cleanly, push explicitly to the contracted remote with `git push -- "$DELIVERY_REMOTE" HEAD` (use `timeout: 600000`). Never use an ambient `git push` here.
7. Return to the watch procedure at the top of this step.

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.

## Done-when

CI reports success for the exact remote tip and every CI-fix commit has current Review/gate artifacts plus a passing `dev-gate-check` recorded before its push.

**Advance:** proceed to Step 07 (Merge Loop) only with explicit merge authority and enabled merge behavior; otherwise emit the green-PR early-exit report and stop.
