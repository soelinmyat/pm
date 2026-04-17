---
name: Review Gate
order: 3
description: Run review for M/L/XL changes or code scan for XS/S before pushing
---

## Review

<!-- telemetry step: review -->

**Goal:** Run the required pre-push review gate and ensure anything leaving the machine has already survived the appropriate quality check.

The review gate is the last quality check before code leaves your machine. Bugs caught here cost minutes to fix; bugs caught in production cost hours.

### Skip check

**Verify review ran (standalone invocation guard):** Check `.pm/dev-sessions/*.md` for the current branch. Parse the SHA from the `Review gate: passed (commit <sha>)` line that `pm:review` writes. If that SHA equals `git rev-parse HEAD`, skip this step and proceed to push. Log: "Review gate already passed in dev session — skipping."

If the `Review gate:` line is missing, absent a SHA, or differs from current HEAD, the state is stale — do NOT skip. Re-run review so what ships is what was reviewed.

If no state file exists (standalone ship invocation without a dev session), invoke `pm:review` as the gate. Do not skip review for standalone invocations.

### Run the review

Invoke `pm:review` in branch mode (no PR number argument):

```
Invoke pm:review (no arguments — it will diff current branch against the default branch)
```

This runs review agents in parallel, tiers findings by confidence, auto-fixes high-confidence findings, and commits fixes.

For the full workflow, see `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`.

If `pm:review` reports "No changes to review", stop — there's nothing to push.

`pm:review` writes `Review gate: passed (commit <sha>)` to `.pm/dev-sessions/{slug}.md` when it completes. That SHA is the attestation that review read the actual commits on HEAD at review time. Every downstream gate (push skip check above, pre-merge verification in Step 07) parses that line and compares against the current SHA — if any commit is added after, whether a fix, rebase, or merge-loop auto-fix, the recorded SHA will not match and review must re-run before merge.

Confirm the line was written before proceeding. If it is missing (e.g. `pm:review` aborted mid-flight), treat the gate as not passed and re-invoke.

### What "passing" means

Review passes when there are no unresolved **critical** findings. The bar by change size:

| Size | Review bar |
|------|-----------|
| XS/S | Code scan only — automated bug detection, no full review |
| M | All critical findings auto-fixed. Advisory findings noted but don't block. |
| L/XL | All critical findings auto-fixed. Advisory findings reviewed — fix or explicitly defer with a reason. |

**Critical findings** are bugs, security issues, data loss risks, or behavioral regressions. These block push — always fix before proceeding.

**Advisory findings** are style suggestions, alternative approaches, or minor improvements. These don't block push but should be consciously evaluated, not silently ignored.

### When review finds issues

1. **Auto-fixable findings:** Review auto-fixes and commits them. Verify the fixes are correct — don't blindly trust auto-fix on complex logic.
2. **Manual-fix findings:** Fix them, run tests, commit. Then re-run `pm:review` to confirm the fix didn't introduce new issues.
3. **Disagreement with a finding:** If you genuinely disagree with a finding, note why in the PR description. Don't silently skip it.

### PR description quality

Before creating the PR in the next step, the review step should ensure you have enough context to write a good PR description. A good PR description:

- Summarizes **why** the change exists, not just what files changed
- Lists any decisions made during implementation that reviewers should know about
- Notes testing approach — what was tested, what edge cases were considered
- Calls out anything unusual — workarounds, known limitations, deferred improvements

For handling review feedback after PR creation, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md`.

**Done-when:** The correct review path has run for this invocation, blocking findings are fixed or the flow has stopped, and there is enough context to create a meaningful PR.
