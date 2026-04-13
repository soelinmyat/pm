---
name: Conflict Check
order: 2
description: Check if branch is behind default branch and resolve merge conflicts
---

## Check & Fix Conflicts

<!-- telemetry step: conflict-check -->

**Goal:** Ensure the branch is up to date with `{DEFAULT_BRANCH}` and free of merge conflicts before review.

**Done-when:** `git log HEAD..origin/{DEFAULT_BRANCH} --oneline` produces no output (branch is current), or conflicts have been resolved, committed, and verified with tests.

### Check if branch is behind {DEFAULT_BRANCH}

Run: `git fetch origin {DEFAULT_BRANCH} && git log HEAD..origin/{DEFAULT_BRANCH} --oneline`

**If no output:** Branch is up to date with {DEFAULT_BRANCH}. Continue to the next step.

**If there are commits behind:**

1. Merge {DEFAULT_BRANCH} into the branch:
   ```bash
   git merge origin/{DEFAULT_BRANCH}
   ```

2. **If merge succeeds cleanly:** Continue to the next step.

3. **If merge has conflicts:**
   - Run `git diff --name-only --diff-filter=U` to list conflicted files
   - **If a lockfile is conflicted** (`pnpm-lock.yaml`, `yarn.lock`, `Gemfile.lock`, `package-lock.json`): Accept either side, then regenerate with the project's install command (from AGENTS.md or convention detection). Do NOT manually resolve lockfile conflicts.
   - For each other conflicted file:
     - Read the file and understand both sides of the conflict
     - Resolve the conflict preserving the intent of both changes
     - Stage the resolved file: `git add [file]`
   - Commit the merge: `git commit -m "merge: resolve conflicts with {DEFAULT_BRANCH}"`
   - Run relevant verification commands for the resolved files (see AGENTS.md)
   - If tests fail after resolution, fix and amend the merge commit
