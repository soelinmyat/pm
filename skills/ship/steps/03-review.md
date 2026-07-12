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

**Verify review ran (standalone invocation guard):** Resolve the branch sidecar and its `review` row. The row must be `passed`, equal current HEAD, and point to project-relative `.pm/dev-sessions/{slug}/review/report.html`. Read sibling `review/report.json`, then run `node "$PM_PLUGIN_ROOT/scripts/review-check.js" --root "$PWD" --report "{REPORT_PATH}" --from-report`. Only a passing current check may skip a new review. Log: "Review gate already passed with current checked evidence — skipping."

If the row, report, any bound result, current SHA, remote base, diff, or browser-checked HTML fails, the state is stale — do NOT skip. Re-run Review so what ships is what was reviewed.

If no state file exists (standalone ship invocation without a dev session), invoke `pm:review` as the gate. Do not skip review for standalone invocations.

### Run the review

Invoke `pm:review` in branch mode (no PR number argument):

```
Invoke pm:review (no arguments — it will diff current branch against the default branch)
```

This freezes the target, plans six logical lenses across available reviewers, validates structured evidence, preserves disagreement, runs bounded fix rounds, and publishes checked JSON plus HTML.

For the full workflow, see `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`.

If `pm:review` reports "No changes to review", stop — there's nothing to push.

`pm:review` writes a current checked report and points the sidecar `review` row to its HTML artifact. The report binds target, commit, remote base, binary diff, reviewer results, decisions, findings, and human projection. Any later commit, rebase, merge-loop fix, or evidence mutation invalidates the check and requires a new round.

Confirm the report checker and sidecar row pass before proceeding. A Markdown line alone is never review evidence.

### What "passing" means

Review passes only with complete current logical-lens coverage, no unresolved Review-owned high/critical finding at confidence 80+, and no unresolved reviewer disagreement or decision-required item. The bar by route:

| Size | Review bar |
|------|-----------|
| XS/S via `pm:dev` | Checked `code-scan` report with bug, edge, reuse, quality, and efficiency coverage |
| Standalone `pm:ship` | Run `pm:review` unless a current `review` gate already exists |
| M | Checked full report; safe mechanical fixes may run automatically; disputes require decisions. |
| L/XL | Same machine gate; every handoff, advisory, decision, and fix round remains in the report. |

**Critical findings** are bugs, security issues, data loss risks, or behavioral regressions. These block push — always fix before proceeding.

**Advisory findings** are style suggestions, alternative approaches, or minor improvements. These don't block push but should be consciously evaluated, not silently ignored.

### When review finds issues

1. **Auto-fixable findings:** Review auto-fixes and commits them. Verify the fixes are correct — don't blindly trust auto-fix on complex logic.
2. **Manual-fix findings:** Fix them, run tests, commit. Then re-run `pm:review` to confirm the fix didn't introduce new issues.
3. **Disagreement with a finding:** Record an explicit approver, action, and rationale in `decisions.json`. A PR-description note cannot override the machine gate.

### PR description quality

Before creating the PR in the next step, the review step should ensure you have enough context to write a good PR description. A good PR description:

- Summarizes **why** the change exists, not just what files changed
- Lists any decisions made during implementation that reviewers should know about
- Notes testing approach — what was tested, what edge cases were considered
- Calls out anything unusual — workarounds, known limitations, deferred improvements

For handling review feedback after PR creation, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md`.

Once the correct review path has run, blocking findings are fixed (or the flow has stopped), and you have enough context to write a meaningful PR, proceed to push.
