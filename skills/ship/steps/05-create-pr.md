---
name: Create or Detect PR
order: 5
description: Create PR with structured description or detect existing PR, then check auto_merge preference
---

## Create or Detect PR

<!-- telemetry step: create-or-detect-pr -->

## Goal

Create or detect the one PR whose repository, head, and base exactly match the reviewed delivery contract, then resolve behavior without broadening merge authority.

## How

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review-candidate-contract.md`, `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md`, and `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Export `GH_OWNER`, `GH_REPOSITORY`, `GH_REPO`, `HEAD_BRANCH`, and `BASE_BRANCH` only from matching current records.

### Candidate route: draft PR and convergence

When canonical candidate state is `review-candidate`, require candidate `create_draft_pr: true`, every readiness/certification/merge field false, canonical user `create_pr` authority, the observed exact remote head, and a current protected candidate-publication contract.

Build the exact draft-PR target from the prepared transaction and verified Push receipt. Use `release-transaction.js` plan for effect `create-pr`, then `release-transaction.js` begin for effect `create-pr`; honor every journal decision before calling GitHub. Candidate publication still uses the same effect journal and exact repository/head/base/commit identity as comprehensive Ship.

Discover an existing PR by exact repository/head/base identity. A matching existing PR is usable only when its API state is open and `draft: true`; a ready/non-draft PR blocks rather than being silently accepted or converted. When no PR exists, create it with the same contracted identity and `--draft`:

```bash
gh pr create --repo "$GH_REPO" --head "$HEAD_BRANCH" --base "$BASE_BRANCH" --draft \
  --title "[descriptive review-candidate title]" --body "[summary, targeted checks, and explicit not-certified status]"
```

Re-observe the PR through the exact API identity check and require `draft: true`. Save the exact observation and receipt, then use `release-transaction.js` reconcile for effect `create-pr`; only `matched` produces the verified Create PR receipt required by CI and merge. Never mark it ready for review, arm auto-merge, or enter the merge loop at this boundary.

Transition the candidate to `reviewing` and initialize `.pm/dev-sessions/{slug}/ship/review-convergence.json` with `createConvergence` from `scripts/review-convergence.js`. Bind the exact head, hash of the complete configured/discovered required-source set, sorted required sources, and a bounded deadline. Record each local, PM, Codex, bot, human, and required PR-conversation result through the helper.

- Any blocking finding remains `reviewing`.
- Any fix or head mutation calls `markHeadMutation`, advances the release transaction to the new prepared commit, regenerates the head-bound discovery/preflight/ref/plan identities, reruns targeted checks and affected review, and transitions `reviewing` back to `review-candidate`. Re-plan and reconcile the Push and draft-PR effects for that generation, then re-enter `reviewing`. Preserve the original `external_effect_started_at`; never replay `candidate-effect` for the same candidate lifecycle.
- Timeout, silence, or `unavailable` enters `awaiting-decision`; none is pass.
- Resume an unavailable source on the same head by recording its eventual result.
- Change requirements only through `reviseRequirements` with approver, reason, a new requirement-set hash, replacement sources, and a new deadline.

Call `evaluateConvergence` only after refreshing every source and the required conversation count. Proceed only when every required source passed on the exact head and there are **zero unresolved required conversations**. Then transition the canonical candidate to `review-converged` and hand the exact head to final certification. A later finding or mutation returns to `reviewing` before certification can run.

### Candidate route: finalization boundary

After convergence and before CI, freeze the exact converged head and finish the certification that the candidate route deliberately deferred:

1. Reload the canonical session, release transaction, gates, delivery plan, discovery receipt, and convergence record. Require the transaction's prepared commit to equal the exact converged head. A missing transaction, late version preparation, changed HEAD, stale requirement source, or changed plan/config/tool identity invalidates the candidate and returns to Review; never mutate the version here.
2. Require current passed Review, QA, and verification artifacts for that prepared commit, bind their exact hashes with `release-transaction.js bind-evidence`, and require `release-transaction.js status` to report `ready: true`. Review convergence is additional evidence; it does not replace the canonical PM Review artifact.
3. Run `release-transaction.js finalize-candidate` through the production finalizer with canonical project-relative paths and the authenticated discovery receipt:

   ```bash
   node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" finalize-candidate \
     --session ".pm/dev-sessions/{slug}/session.json" \
     --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
     --gates ".pm/dev-sessions/{slug}/gates.json" \
     --plan ".pm/dev-sessions/{slug}/ship/repository-delivery-plan.json" \
     --discovery-receipt ".pm/dev-sessions/{slug}/ship/repository-discovery.json" \
     --discovery-receipt-sha256 "sha256:{64 lowercase hex}" \
     --certification ".pm/dev-sessions/{slug}/ship/final-certification.json" \
     --attestation ".pm/dev-sessions/{slug}/ship/delivery-attestation.json" \
     --json
   ```

4. Re-read every canonical file. Require a passing, externally signed complete certification and final-candidate attestation bound to the prepared commit, release generation, exact complete command set, evidence hashes, destination, and ref update. Require the candidate state to be `certifying`. Any mismatch returns to Review; prose success is not evidence.
5. Transition `certifying` to `base-check`, refresh the live default-branch identity, and run the canonical base-drift policy. Any overlap, conflict, indeterminate result, or missing required merge-result capability invalidates optimized readiness and enters comprehensive recertification. Only a current safe result may transition `base-check` to `merge-ready`.
6. With candidate `ready_for_review: true` and canonical user `create_pr` authority still current, build the exact PR-readiness target from the verified Create PR receipt. Use `release-transaction.js` plan for effect `ready-pr`, then `release-transaction.js` begin for effect `ready-pr`. On `execute`, run:

   ```bash
   gh pr ready "$PR_NUMBER" --repo "$GH_REPO"
   ```

   Re-observe the exact PR through the contracted repository API and require the planned PR number, prepared head OID, `state: OPEN`, and `draft: false`. Save the observation and receipt, then use `release-transaction.js` reconcile for effect `ready-pr`; only `matched` is success. `observe-first` and `already-verified` always re-observe before continuing, and no ambiguous attempt is replayed.
7. Only after the `ready-pr` effect is verified may Ship enter CI. Do not run a second final certification for the comprehensive route.

When the candidate route was not selected, follow the comprehensive PR path below unchanged.

Build and plan the exact `create-pr` target with repository, head, base, and prepared head commit. The runtime will refuse it until `push` is verified. Observe existing PRs by all target dimensions before deciding whether creation is needed. Record a matching existing PR through `begin` plus `reconcile matched`; it is an idempotent success, not a reason to create another PR.

### Check for existing PR

Discover by all three identity dimensions, not by ambient repository context:

```bash
gh pr list --repo "$GH_REPO" --head "$HEAD_BRANCH" --base "$BASE_BRANCH" \
  --state open --json number,url,title,state --limit 2
```

Require zero or one result. Multiple matches are ambiguous and block Ship. For one result, run `gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json number,url,title,state`, then validate its exact API identity through `gh api "repos/$GH_OWNER/$GH_REPOSITORY/pulls/$PR_NUMBER"` as required by `delivery-contract.md`. Reject a fork, owner/repo mismatch, head mismatch, or base mismatch.

**If PR exists and is open on the comprehensive path:**
- Report: "PR #N already exists: [URL]"
- Reconcile the `create-pr` effect with a receipt containing number, URL, state, and exact head OID.
- Continue to the CI monitoring step

**If no PR exists:**

1. Require canonical and snapshotted `create_pr: true`. If false, stop at the pushed-branch boundary and ask for that exact grant before creating the PR.

2. Get context for PR description:
   - `git log {DEFAULT_BRANCH}..HEAD --oneline` for commit summary
   - `git diff {DEFAULT_BRANCH}...HEAD --stat` for files changed

3. Create the PR against the explicit reviewed identity:
   ```
   gh pr create --repo "$GH_REPO" --head "$HEAD_BRANCH" --base "$BASE_BRANCH" \
     --title "[descriptive title]" --body "$(cat <<'EOF'
   ## Summary
   [2-3 bullet points from commit log]

   ## Test plan
   - [ ] Verify [key behavior 1]
   - [ ] Verify [key behavior 2]
   EOF
   )"
   ```

4. Read the returned PR number, re-run the exact API identity validation, and persist `PR_NUMBER` only if repository/head/base all match. Then report the PR URL.

5. Reconcile the attempted effect only after the independent API observation matches the planned target and prepared head OID. Zero matches after an ambiguous attempt is `absent`/retry-safe; multiple matches, a fork, wrong base, or wrong head OID is `conflict`/blocked.

6. **Request Codex review (if configured):**
   Check CLAUDE.md or AGENTS.md for `codex_review: true`. If enabled:
   ```bash
   gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "@codex review"
   ```
   Default: skip Codex review request unless explicitly enabled.

---

## Check Auto-Merge Setting

First read canonical `authority.merge`. If it is false, Ship may monitor CI but must stop at a green PR; do not ask about or arm auto-merge. A prior `preferences.ship.auto_merge: true` does not override this boundary.

Only when `authority.merge` and the delivery-contract snapshot are both true, read `{pm_state_dir}/config.json` and check `preferences.ship.auto_merge`.

- **If `auto_merge` is `true` and merge authority is true:** Continue to CI monitoring and Phase 2 as normal.
- **If `auto_merge` is `false`:** Monitor CI (next step) but **stop after CI passes**. Do NOT enter Phase 2 (merge loop). Print the early-exit report below.
- **If the key is missing or `preferences.ship` doesn't exist:** Ask the user once:

> Ship can auto-merge your PR after CI passes, or stop at a green PR so you merge manually. Which do you prefer?
> 1. **Auto-merge** — ship merges when all gates pass (default for most workflows)
> 2. **Stop at green PR** — ship creates PR and monitors CI, you merge when ready (recommended if main is your production branch)

Persist their choice to `{pm_state_dir}/config.json` under `preferences.ship.auto_merge` so they're never asked again. This records behavior only; it does not change session authority. Then continue based on their answer.

### Early-exit report (auto_merge disabled)

```
## Shipped to PR

**PR:** #N — [title] ([URL])
**Branch:** [branch name]
**Review:** [N issues found and fixed by review agents]
**CI:** passed
**Auto-merge:** disabled (preferences.ship.auto_merge = false)

PR is green and ready. Merge manually or re-run `/pm:ship` to trigger the merge loop.
```

Then run the Product Memory steps (backlog `prs` write is skipped — no merge yet) and exit. Do NOT run cleanup — the branch stays open.

## Done-when

On the optimized route, exactly one open draft PR matches contracted repository/head/base identity, the transaction's `create-pr` effect is `verified`, every required review source has passed on its exact current head, zero required conversations remain unresolved, and the exact prepared commit has a current signed final-candidate attestation with candidate state `certifying`; merge authority is still not implied. On the comprehensive route, exactly one PR has passed the contracted repository/head/base/prepared-commit identity check, the `create-pr` effect is observed as `verified`, any PR mutation had explicit `create_pr` authority, and merge behavior is resolved without treating a preference as consent.

**Advance:** proceed to Step 6 (CI Monitor), then Step 7 only according to the explicit merge-authority and auto-merge branch; otherwise emit the green-PR early-exit report.
