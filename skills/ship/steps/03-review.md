---
name: Review Gate
order: 3
description: Run review for M/L/XL changes or code scan for XS/S before pushing
---

## Review

The review gate is the last quality check before code leaves your machine. Bugs caught here cost minutes to fix; bugs caught in production cost hours.

### Skip check

**Verify review ran (standalone invocation guard):** Check `.pm/dev-sessions/*.md` for the current branch. If the state file shows `Review gate: passed` and no new commits exist since that review (compare commit SHA), skip this step and proceed to push. Log: "Review gate already passed in dev session — skipping."

If no state file exists (standalone ship invocation without a dev session), run `/review` as the gate. Do not skip review for standalone invocations.

### Run the review

Run the `/review` command in branch mode (no PR number argument):

```
Invoke /review (no arguments — it will diff current branch against the default branch)
```

This runs review agents in parallel, auto-fixes all findings, and commits fixes.

For review reference material, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review.md`.

Code review is skipped at this stage (no PR exists yet).

If `/review` reports "No changes to review", stop — there's nothing to push.

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
2. **Manual-fix findings:** Fix them, run tests, commit. Then re-run `/review` to confirm the fix didn't introduce new issues.
3. **Disagreement with a finding:** If you genuinely disagree with a finding, note why in the PR description. Don't silently skip it.

### PR description quality

Before creating the PR in the next step, the review step should ensure you have enough context to write a good PR description. A good PR description:

- Summarizes **why** the change exists, not just what files changed
- Lists any decisions made during implementation that reviewers should know about
- Notes testing approach — what was tested, what edge cases were considered
- Calls out anything unusual — workarounds, known limitations, deferred improvements

For handling review feedback after PR creation, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md`.
