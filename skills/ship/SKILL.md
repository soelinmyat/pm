---
name: ship
description: "Use when shipping committed changes — review, push, PR, CI monitor, and auto-merge in one flow. Use when the user says 'ship it', 'push this', 'create a PR', 'merge this', 'send it', 'land this', 'get this in', 'open a PR', 'ready to merge', 'submit this', or wants to take committed code through the full review-push-PR-merge lifecycle. Also handles existing PRs to completion — babysit CI, resolve feedback, and merge."
---

# /ship

## Purpose

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge. Ship takes committed code and drives it through every gate to a merged PR — or stops with a clear diagnosis when a gate fails.

## Iron Law

**NEVER MERGE WITHOUT READING THE DIFF.** Every merge must be preceded by a review that read the actual changes — not just checked status labels. If review was skipped, CI was green, and auto-merge is armed, that's a pipeline that shipped unreviewed code. Stop and review before merging.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `ship` | **Telemetry steps:** `pre-flight`, `conflict-check`, `review`, `push`, `create-or-detect-pr`, `merge-monitor`, `cleanup`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ship/steps/` in numeric filename order. If `.pm/workflows/ship/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**When NOT to use:** Checking PR status ("what's the status of my PR?"), when changes aren't committed yet, or when the user just wants to push without review. Ship runs the full review-push-PR-merge lifecycle — if they only need `git push`, they don't need this skill.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State File

The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If not found, check legacy path `.dev-state-{slug}.md`.

## References

The following reference files provide detailed guidance for specific ship phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review.md` | Review agent configuration and execution |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` | Handling PR review feedback (M/L/XL) |
| `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` | Shared self-healing merge loop procedure |

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The diff is small, I don't need to review it."** Small diffs cause production incidents too. Review is not proportional to line count — it's mandatory.
- **"CI is green, so the code must be correct."** CI catches syntax and regressions. It doesn't catch wrong behavior, missing edge cases, or security holes. Green CI is necessary, not sufficient.
- **"Auto-merge is armed, my job is done."** Armed is not merged. Verify the PR state is MERGED before reporting success. Auto-merge can be blocked by late review requests, branch protection changes, or merge conflicts.
- **"The user said 'ship it' so I'll skip the conflict check."** Shipping with conflicts corrupts the merge. The user said ship, not skip.
- **"Push failed but --no-verify would fix it."** Hook failures are bugs. Bypassing them ships those bugs. Fix the failure, never bypass it.
- **"Review found issues but they're just style nits."** You don't get to classify findings as nits. Follow the severity rubric in the review step. Advisory findings are evaluated, not dismissed.

## Escalation Paths

- **Changes aren't committed yet:** "There are uncommitted changes. Want to commit first, or run `/pm:dev` to finish the implementation?"
- **PR has blocking human review feedback:** "PR has unresolved review comments that need your input. [Summary of blocking items]. Want to address these before I continue the merge loop?"
- **CI keeps failing after 3 fix rounds:** "CI has failed 3 times. Here's what's still broken: [details]. Want to investigate manually, or should I try a different approach?"
- **Merge conflicts can't be auto-resolved:** "Merge conflicts in [files] require judgment calls I can't make confidently. Want to resolve these manually?"
- **Branch is stale and diverged significantly:** "Branch is [N] commits behind {DEFAULT_BRANCH} with conflicts in [critical files]. Consider rebasing or re-running `/pm:dev` to verify the implementation still works after merge."

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Code looks clean, skip review" | Clean code can have wrong behavior. Review checks intent, not style. |
| "Just push, CI will catch issues" | CI catches syntax. Review catches logic, security, and architectural drift. |
| "Small change, PR description can be brief" | PR description is for the reviewer, not the author. Brief = reviewer misses context. |
| "Tests pass locally, skip CI wait" | Local passes with local state. CI is the clean-room test. |
| "Auto-merge is fine, I trust the gates" | Trust but verify. Check merge state is MERGED, not just armed. |

## Before Marking Done

- [ ] PR created with meaningful title and description
- [ ] CI passed (not just "running")
- [ ] Review comments evaluated and addressed (not blindly resolved)
- [ ] Merge state verified as MERGED (not just auto-merge armed)
- [ ] Feature branch cleaned up

