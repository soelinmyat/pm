---
name: Create or Detect PR
order: 5
description: Create PR with structured description or detect existing PR, then check auto_merge preference
---

## Create or Detect PR

<!-- telemetry step: create-or-detect-pr -->

**Goal:** Create a PR with a meaningful description, or detect an existing one. Resolve the auto-merge preference.

**Done-when:** PR exists and URL is reported to the user. Auto-merge preference is resolved and persisted. If `auto_merge` is disabled, early-exit report is printed and skill exits after Product Memory steps.

### Check for existing PR

Run: `gh pr view --json number,url,title,state 2>/dev/null`

**If PR exists and is open:**
- Report: "PR #N already exists: [URL]"
- Continue to the CI monitoring step

**If no PR exists:**

1. Get context for PR description:
   - `git log {DEFAULT_BRANCH}..HEAD --oneline` for commit summary
   - `git diff {DEFAULT_BRANCH}...HEAD --stat` for files changed

2. Create the PR:
   ```
   gh pr create --title "[descriptive title]" --body "$(cat <<'EOF'
   ## Summary
   [2-3 bullet points from commit log]

   ## Test plan
   - [ ] Verify [key behavior 1]
   - [ ] Verify [key behavior 2]
   EOF
   )"
   ```

3. Report the PR URL

4. **Request Codex review (if configured):**
   Check CLAUDE.md or AGENTS.md for `codex_review: true`. If enabled:
   ```bash
   gh pr comment $PR_NUMBER --body "@codex review"
   ```
   Default: skip Codex review request unless explicitly enabled.

---

## Check Auto-Merge Setting

Read `{pm_state_dir}/config.json` and check `preferences.ship.auto_merge`.

- **If `auto_merge` is `true`:** Continue to CI monitoring and Phase 2 as normal.
- **If `auto_merge` is `false`:** Monitor CI (next step) but **stop after CI passes**. Do NOT enter Phase 2 (merge loop). Print the early-exit report below.
- **If the key is missing or `preferences.ship` doesn't exist:** Ask the user once:

> Ship can auto-merge your PR after CI passes, or stop at a green PR so you merge manually. Which do you prefer?
> 1. **Auto-merge** — ship merges when all gates pass (default for most workflows)
> 2. **Stop at green PR** — ship creates PR and monitors CI, you merge when ready (recommended if main is your production branch)

Persist their choice to `{pm_state_dir}/config.json` under `preferences.ship.auto_merge` so they're never asked again. Then continue based on their answer.

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
