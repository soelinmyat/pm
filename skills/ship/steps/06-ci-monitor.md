---
name: CI Monitor
order: 6
description: Monitor CI status, auto-fix failures, retry up to 3 rounds
---

## Monitor CI + Auto-fix (Pre-Merge)

<!-- telemetry step: ci-monitor -->

## Goal

Determine the complete required CI outcome for the exact current PR head,
auto-fixing branch-caused failures up to 3 rounds.

## How

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md` and `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Require verified `push` and `create-pr` effects, then use only their bound `GH_REPO`, `HEAD_BRANCH`, `BASE_BRANCH`, prepared commit, and PR number; never use ambient `gh` repository discovery.

Before monitoring CI on the optimized route, verify the canonical final-candidate attestation created by Step 05. Its commit must equal the release transaction's prepared commit and the observed remote branch tip, its signed complete certification must remain valid, the canonical candidate state must be `merge-ready`, and the `ready-pr` effect must be verified against the same open, non-draft PR. Missing or stale evidence returns to Review and finalization; CI cannot create or substitute for this attestation.

CI passes only when every required check has an accepted terminal result for
the exact prepared commit and independently observed PR head. One successful
workflow, the latest run, an empty check list, or a successful watch process
cannot establish that outcome. Failed, pending, missing, stale-head, cancelled,
ambiguous, and unavailable results remain visible; none is green.

### Observe the complete CI set

1. Confirm `git branch --show-current` equals `$HEAD_BRANCH` from the contract.
2. Bind `$PREPARED_COMMIT` from the verified release transaction. Re-observe the contracted PR and its head, and retrieve all check runs and
   status contexts for that exact commit through the repository adapter. Discover
   the complete required-check set from current branch protection and rulesets,
   including check/app identity. An inaccessible policy or incomplete paginated
   observation is unavailable, not an empty requirement set. `gh pr checks` is a
   useful projection, but an empty or unavailable result does not prove that no
   checks are required:
   ```bash
   gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json headRefOid,statusCheckRollup
   gh pr checks "$PR_NUMBER" --repo "$GH_REPO" --required --json name,state,bucket,workflow,link
   gh run list --repo "$GH_REPO" --commit "$PREPARED_COMMIT" --json databaseId,headSha,status,conclusion,workflowName
   ```
   The run list helps find current-head run IDs; paginate as needed and retain
   status contexts and policy checks that do not appear in workflow runs.
3. Require the observed PR head and each relevant check's commit to equal the
   contracted remote branch tip and prepared commit. Exclude old-head runs from
   satisfaction; retain them as stale evidence. Resolve reruns to the authoritative
   current attempt using provider identity, not an arbitrary passing duplicate.
   Preserve required checks with no current result as `missing`.
4. Save the complete normalized snapshot at
   `.pm/dev-sessions/{slug}/ship/ci-checks.json`. It carries `expectedHead`,
   `observedHead`, `requirementsKnown`, `observationComplete`, `requiredChecks`
   (name plus app identity where constrained), and `checks` (name, app identity,
   headSha, status, conclusion). Use `summarizeRequiredChecks` from
   `scripts/lib/ci-check-summary.js` to summarize it. Normalize status contexts
   using their observed commit and provider result; never invent completion or
   translate `pending` to success. Neutral/skipped conclusions are accepted only
   when the observed repository policy explicitly allows them. A verified empty
   required set is `not-required`; report `No required CI checks configured`,
   not `CI passed`, and retain all other repository delivery requirements.
5. For pending current-head runs, watch their exact run IDs in background with
   `run_in_background: true`:
   ```bash
   gh run watch "$RUN_ID" --repo "$GH_REPO" --exit-status
   ```
6. Continue authorized independent work while CI runs. When a watch completes,
   re-observe the entire required set and PR head. Exit code zero means that
   watched run finished successfully; it does not replace the complete summary.
   A non-zero result returns to the summary and failure diagnosis below.

### Handle CI result

**If the complete summary is `passed`:** Continue according to merge authority
and enabled merge behavior. Report the exact head and the required check names.
For `not-required`, use the explicit no-required-checks report and the existing
repository delivery policy; do not claim CI ran or passed. For `pending`,
`missing`, `ambiguous`, or `unavailable`, preserve that state and the concrete
missing evidence. Do not emit a green-PR handoff or enter merge based on it.

Before advancing, re-check the canonical final-candidate attestation when this delivery used the optimized route. The observed CI head must equal its frozen commit and the release transaction's prepared commit. A CI fix, review finding, changed plan/config/tool identity, or different head invalidates the attestation and returns to Review. Comprehensive deliveries have no extra finalization step and retain their existing single-certification baseline.

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs:
   ```bash
   gh run view "$RUN_ID" --repo "$GH_REPO" --log-failed
   ```
2. Categorize failures: test failures, lint errors, build errors, security issues,
   infrastructure failures, or a pre-existing default-branch failure. A
   pre-existing classification requires the same command/toolchain to fail on
   the current authoritative default branch with evidence that the delivery diff
   is unrelated.
3. Fix branch-caused issues using project-appropriate tools (check AGENTS.md for
   lint/fix commands). For a pre-existing unrelated failure, do not claim CI
   success and do not expand delivery scope automatically; preserve the blocker
   and ask for explicit separate remediation authority.
4. Commit fixes with descriptive message
5. Run the full post-mutation recertification protocol: advance the release transaction to current HEAD with the concrete CI-fix reason, rerun `pm:review`, regenerate and bind Review/QA/verification artifacts, replan effects for the new generation, revalidate repository identity, and pass `dev-gate-check`.
6. Only after recertification exits cleanly, push explicitly to the contracted remote with `git push -- "$DELIVERY_REMOTE" HEAD` (use `timeout: 600000`). Never use an ambient `git push` here.
7. Return to the watch procedure at the top of this step.

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.

## Done-when

Every required CI check has an accepted terminal result for the exact remote
tip, or the report states the precise failed/pending/missing/unavailable outcome
or independently verified no-required-checks policy. Every CI-fix commit has
current Review/gate artifacts plus a passing `dev-gate-check` before its push.

**Advance:** proceed to Step 07 (Merge Loop) only with a satisfied required-check policy, explicit merge authority, and enabled merge behavior. Otherwise stop with the observed CI state; emit the green-PR early-exit report only for `passed`, and report `not-required` explicitly without claiming CI passed.
