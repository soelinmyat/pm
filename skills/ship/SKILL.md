---
name: ship
description: "Use when shipping committed changes — review, push, PR, CI monitor, and auto-merge in one flow. Use when the user says 'ship it', 'push this', 'create a PR', 'merge this', 'send it', 'land this', 'get this in', 'open a PR', 'ready to merge', 'submit this', or wants to take committed code through the full review-push-PR-merge lifecycle. Also handles existing PRs to completion — babysit CI, resolve feedback, and merge."
---

# /ship

## Purpose

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge. Ship takes committed code and drives it through every gate to a merged PR — or stops with a clear diagnosis when a gate fails.

## Hard rules

- **NEVER MERGE WITHOUT READING THE DIFF.** Every merge is preceded by a review that read the actual changes — not just status labels. Review is mandatory regardless of diff size; small diffs cause incidents too. If review was skipped, CI was green, and auto-merge is armed, that's a pipeline shipping unreviewed code — stop and review first.
- **Green CI is necessary, not sufficient.** CI catches syntax and regressions, not wrong behavior, missing edge cases, or security holes. "Tests pass locally" is not the clean-room test — don't skip the CI wait, and don't treat green as a substitute for review.
- **Armed is not merged.** Verify the PR state is MERGED before reporting success — auto-merge can be blocked by late review requests, branch-protection changes, or conflicts.
- **Never skip the conflict check**, even when the user says "ship it" — shipping with conflicts corrupts the merge.
- **Never bypass hooks (`--no-verify`).** Hook failures are bugs; fix them, don't ship them.
- **You don't get to classify findings as "nits."** Follow the review step's severity rubric — advisory findings are evaluated, not dismissed.
- **The PR description is for the reviewer, not the author** — a meaningful title and enough context, not a terse note.
- **Before done:** PR created with a meaningful title/description, CI passed (not just running), review comments evaluated and addressed (not blindly resolved), merge state verified as MERGED (not just armed), and the feature branch cleaned up.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` with `PM_LOOP_STAGE=ship` (or `review`), this run is ONE bounded ship cycle dispatched unattended by the PM loop:

- Assess CI status and new review comments, fix what is actionable now, push, then stop. Do not poll or wait on CI — if external state is pending, report and exit; the next scheduled wake runs the next cycle.
- Preserve review, CI, verification, and merge-approval gates. Merge only if the loop granted it and every gate/check is green.
- Do not write or update backlog/card state in loop mode; the loop worker is the only canonical durable card-state writer.
- Atomically write the version-1 result to `PM_LOOP_RESULT_FILE`. Exact statuses: merged, ready-for-human, waiting, blocked, failed, noop. PR-bearing statuses include the repository-pinned pull-request payload; `merged` adds merge SHA/time; `waiting` adds a bounded `retry_after`; `blocked` includes bounded remediation.
- Non-interactive: never wait for user input; return `ready-for-human` or `blocked` when a decision requires a human.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

Document output (the PR description) follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `ship`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ship/steps/` in numeric filename order. If `.pm/workflows/ship/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**When NOT to use:** Checking PR status ("what's the status of my PR?"), when changes aren't committed yet, or when the user just wants to push without review. Ship runs the full review-push-PR-merge lifecycle — if they only need `git push`, they don't need this skill.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State File

The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name using the normalization rules in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` (`deriveSessionSlug` in `${CLAUDE_PLUGIN_ROOT}/scripts/dev-gate-check.js`). Examples: `feat/add-auth` -> `.pm/dev-sessions/add-auth.md`; `codex/pm-dev-workflow-proposal` -> `.pm/dev-sessions/pm-dev-workflow-proposal.md`. If not found, check legacy path `.dev-state-{slug}.md`.

## References

The following reference files provide detailed guidance for specific ship phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md` | Review agent configuration and execution (canonical `pm:review` skill) |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` | Handling PR review feedback (M/L/XL) |
| `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` | Shared self-healing merge loop procedure |

## Escalation Paths

- **Changes aren't committed yet:** "There are uncommitted changes. Want to commit first, or run `/pm:dev` to finish the implementation?"
- **PR has blocking human review feedback:** "PR has unresolved review comments that need your input. [Summary of blocking items]. Want to address these before I continue the merge loop?"
- **CI keeps failing after 3 fix rounds:** "CI has failed 3 times. Here's what's still broken: [details]. Want to investigate manually, or should I try a different approach?"
- **Merge conflicts can't be auto-resolved:** "Merge conflicts in [files] require judgment calls I can't make confidently. Want to resolve these manually?"
- **Branch is stale and diverged significantly:** "Branch is [N] commits behind {DEFAULT_BRANCH} with conflicts in [critical files]. Consider rebasing or re-running `/pm:dev` to verify the implementation still works after merge."
