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

Discover an existing PR by exact repository/head/base identity. A matching existing PR is usable only when its API state is open and `draft: true`; a ready/non-draft PR blocks rather than being silently accepted or converted. When no PR exists, create it with the same contracted identity and `--draft`:

```bash
gh pr create --repo "$GH_REPO" --head "$HEAD_BRANCH" --base "$BASE_BRANCH" --draft \
  --title "[descriptive review-candidate title]" --body "[summary, targeted checks, and explicit not-certified status]"
```

Re-observe the PR through the exact API identity check and require `draft: true`. Never mark it ready for review, arm auto-merge, or enter the merge loop at this boundary.

Transition the candidate to `reviewing` and initialize `.pm/dev-sessions/{slug}/ship/review-convergence.json` with `createConvergence` from `scripts/review-convergence.js`. Bind the exact head, hash of the complete configured/discovered required-source set, sorted required sources, and a bounded deadline. Record each local, PM, Codex, bot, human, and required PR-conversation result through the helper.

- Any blocking finding remains `reviewing`.
- Any fix or head mutation calls `markHeadMutation`, then reruns targeted checks and affected review on the new head.
- Timeout, silence, or `unavailable` enters `awaiting-decision`; none is pass.
- Resume an unavailable source on the same head by recording its eventual result.
- Change requirements only through `reviseRequirements` with approver, reason, a new requirement-set hash, replacement sources, and a new deadline.

Call `evaluateConvergence` only after refreshing every source and the required conversation count. Proceed only when every required source passed on the exact head and there are **zero unresolved required conversations**. Then transition the canonical candidate to `review-converged` and hand the exact head to final certification. A later finding or mutation returns to `reviewing` before certification can run.

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

On the optimized route, exactly one open draft PR matches contracted repository/head/base identity, every required review source has passed on its exact current head, zero required conversations remain unresolved, and the canonical candidate is `review-converged`; no readiness, certification, or merge authority was claimed. On the comprehensive route, exactly one PR has passed the contracted repository/head/base/prepared-commit identity check, the `create-pr` effect is observed as `verified`, any PR mutation had explicit `create_pr` authority, and merge behavior is resolved without treating a preference as consent.

**Advance:** proceed to Step 6 (CI Monitor), then Step 7 only according to the explicit merge-authority and auto-merge branch; otherwise emit the green-PR early-exit report.
