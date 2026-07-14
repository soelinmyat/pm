---
name: ship
description: "Use when shipping committed changes — review, push, PR, CI monitor, and auto-merge in one flow. Use when the user says 'ship it', 'push this', 'create a PR', 'merge this', 'send it', 'land this', 'get this in', 'open a PR', 'ready to merge', 'submit this', or wants to take committed code through the full review-push-PR-merge lifecycle. Also handles existing PRs to completion — babysit CI, resolve feedback, and merge."
---

# /ship

## Purpose

Complete shipping lifecycle as a resumable transaction: prepare the final release tree, review it, push, create or reconcile a PR, monitor CI, merge, place any release tag on `main`, and close the loop. Ship drives committed code through every gate to observed delivery — or stops at a precise authority, identity, or external-system boundary.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating the PR description or reports.

**Workflow:** `ship` | **Telemetry steps:** `pre_flight`, `conflict_check`, `prepare_release`, `review`, `push`, `create_or_detect_pr`, `ci_monitor`, `merge_monitor`

## Iron Law

**NEVER MERGE WITHOUT READING THE DIFF.**

## When NOT to use

- For read-only PR status, inspect the PR without entering Ship.
- When changes are uncommitted or implementation gates are incomplete, return to `pm:dev`.
- When the user wants only a raw push without review, explain that Ship owns the full delivery lifecycle and do not broaden the request.

## Hard rules

- **NEVER MERGE WITHOUT READING THE DIFF.** Every merge is preceded by a review that read the actual changes — not just status labels. Review is mandatory regardless of diff size; small diffs cause incidents too. If review was skipped, CI was green, and auto-merge is armed, that's a pipeline shipping unreviewed code — stop and review first.
- **Green CI is necessary, not sufficient.** CI catches syntax and regressions, not wrong behavior, missing edge cases, or security holes. "Tests pass locally" is not the clean-room test — don't skip the CI wait, and don't treat green as a substitute for review.
- **Armed is not merged.** Verify the PR state is MERGED before reporting success — auto-merge can be blocked by late review requests, branch-protection changes, or conflicts.
- **Prepare before freezing Review.** A required version mutation happens before the final Review target; no post-review bump may stale a passing report.
- **Observe before replay.** An `attempting` effect with an ambiguous outcome must be reconciled from authoritative remote state before another mutation.
- **Tag only the verified main result.** The new Ship path never creates an installable tag on a feature commit and never force-moves a conflicting tag.
- **Never skip the conflict check**, even when the user says "ship it" — shipping with conflicts corrupts the merge.
- **Never bypass hooks (`--no-verify`).** Hook failures are bugs; fix them, don't ship them.
- **You don't get to classify findings as "nits."** Follow the review step's severity rubric — advisory findings are evaluated, not dismissed.
- **The PR description is for the reviewer, not the author** — a meaningful title and enough context, not a terse note.
- **Before done:** PR created with a meaningful title/description, CI passed (not just running), review comments evaluated and addressed (not blindly resolved), merge state verified as MERGED (not just armed), and the feature branch cleaned up.
- Every phase records current evidence and advances only from an observed remote state. Push, PR creation, merge, and tracker effects require their exact persisted authority; preferences never supply consent.

## Red Flags — Self-Check

- **"The diff is tiny, so CI is enough."** Stop and read the exact contracted diff before pushing.
- **"Auto-merge is enabled, so merge is authorized."** Check persisted merge authority separately from preference.
- **"The PR is green, so comments can wait."** Include current review feedback in the readiness gate.
- **"The hook is flaky."** Stop and diagnose it; never use `--no-verify`.
- **"The command timed out, so retry it."** The effect may have completed; use the release transaction's observer first.
- **"We can bump after review; only manifests changed."** The reviewed binary diff changed; instead, prepare the release before the frozen Review target.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` with `PM_LOOP_STAGE=ship` (or `review`), this run is ONE bounded ship cycle dispatched unattended by the PM loop:

- Assess CI status and new review comments, fix what is actionable now, push, then stop. Do not poll or wait on CI — if external state is pending, report and exit; the next scheduled wake runs the next cycle.
- Preserve review, CI, verification, and merge-approval gates. Merge only if the loop granted it and every gate/check is green.
- Do not write or update backlog/card state in loop mode; the loop worker is the only canonical durable card-state writer.
- Atomically write the version-1 result to `PM_LOOP_RESULT_FILE`. Exact statuses: merged, ready-for-human, waiting, blocked, failed, noop. PR-bearing statuses include the repository-pinned pull-request payload; `merged` adds merge SHA/time; `waiting` adds a bounded `retry_after`; `blocked` includes bounded remediation.
- Non-interactive: never wait for user input; return `ready-for-human` or `blocked` when a decision requires a human.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ship/steps/` in numeric filename order. If `.pm/workflows/ship/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State Files

Canonical lifecycle state is `.pm/dev-sessions/{slug}/session.json`; executable delivery state is `.pm/dev-sessions/{slug}/ship/release-transaction.json`. Resolve `{slug}` with `deriveSessionSlug` from `${CLAUDE_PLUGIN_ROOT}/scripts/lib/session-slug.js`: for example, both `codex/pm-dev-workflow-proposal` and `pm-dev-workflow-proposal` resolve to `pm-dev-workflow-proposal`. Flat Markdown state is compatibility-only and cannot authorize an effect.

## References

The following reference files provide detailed guidance for specific ship phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md` | Review agent configuration and execution (canonical `pm:review` skill) |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` | Handling PR review feedback (M/L/XL) |
| `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` | Shared self-healing merge loop procedure |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md` | Prepare-release, effect journal, observers, resume, and main-tag placement |

## Escalation Paths

- Stop at the last verified local or remote boundary before asking for a new authority, product decision, or manual conflict resolution.
- **Changes aren't committed yet:** "There are uncommitted changes. Want to commit first, or run `/pm:dev` to finish the implementation?"
- **PR has blocking human review feedback:** "PR has unresolved review comments that need your input. [Summary of blocking items]. Want to address these before I continue the merge loop?"
- **CI keeps failing after 3 fix rounds:** "CI has failed 3 times. Here's what's still broken: [details]. Want to investigate manually, or should I try a different approach?"
- **Merge conflicts can't be auto-resolved:** "Merge conflicts in [files] require judgment calls I can't make confidently. Want to resolve these manually?"
- **Branch is stale and diverged significantly:** "Branch is [N] commits behind {DEFAULT_BRANCH} with conflicts in [critical files]. Consider rebasing or re-running `/pm:dev` to verify the implementation still works after merge."

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Green checks prove the change is safe." | CI does not replace diff review, product gates, or review feedback. |
| "The hosting service will eventually merge it." | Success is an observed merged identity, not an armed setting. |
| "A network error proves the effect failed." | Ambiguous outcomes require observation; blind replay can duplicate or corrupt delivery. |
| "The release tag can be fixed later." | A tag is an installable identity and must be verified on the main merge SHA before Ship completes. |

## Before Marking Done

- [ ] The prepared tree, release transaction, delivery contract, PR description, gate evidence, delivery receipt, and required Product Memory artifacts are saved and identity-bound.
- [ ] The user granted each requested external effect, including merge when applicable.
- [ ] Diff review, conflict, hook, CI, feedback, remote identity, merge verification, optional main-tag verification, tracker, and cleanup gates passed.
