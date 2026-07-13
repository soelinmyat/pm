---
name: Create or Detect PR
order: 5
description: Create PR with structured description or detect existing PR, then check auto_merge preference
---

## Create or Detect PR

<!-- telemetry step: create-or-detect-pr -->

**Goal:** Create or detect the one PR whose repository, head, and base exactly match the reviewed delivery contract, then resolve behavior without broadening merge authority.

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Export `GH_OWNER`, `GH_REPOSITORY`, `GH_REPO`, `HEAD_BRANCH`, and `BASE_BRANCH` only from that current contract.

### Check for existing PR

Discover by all three identity dimensions, not by ambient repository context:

```bash
gh pr list --repo "$GH_REPO" --head "$HEAD_BRANCH" --base "$BASE_BRANCH" \
  --state open --json number,url,title,state --limit 2
```

Require zero or one result. Multiple matches are ambiguous and block Ship. For one result, run `gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json number,url,title,state`, then validate its exact API identity through `gh api "repos/$GH_OWNER/$GH_REPOSITORY/pulls/$PR_NUMBER"` as required by `delivery-contract.md`. Reject a fork, owner/repo mismatch, head mismatch, or base mismatch.

**If PR exists and is open:**
- Report: "PR #N already exists: [URL]"
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

5. **Request Codex review (if configured):**
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

**Done-when:** Exactly one PR has passed the contracted repository/head/base identity check, any PR mutation had explicit `create_pr` authority, and merge behavior is resolved without treating a preference as consent.

**Advance:** proceed to Step 06 (CI Monitor). After CI, enter Step 07 only when both merge authority and auto-merge behavior permit it; otherwise emit the green-PR early-exit report.
