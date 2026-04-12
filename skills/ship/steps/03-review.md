---
name: Review Gate
order: 3
description: Run review for M/L/XL changes or code scan for XS/S before pushing
---

## Review

**Verify review ran (standalone invocation guard):** Check `.pm/dev-sessions/*.md` for the current branch. If the state file shows `Review gate: passed` and no new commits exist since that review (compare commit SHA), skip this step and proceed to push. Log: "Review gate already passed in dev session — skipping."

If no state file exists (standalone ship invocation without a dev session), run `/review` as the gate. Do not skip review for standalone invocations.

**Otherwise:** Run the `/review` command in branch mode (no PR number argument):

```
Invoke /review (no arguments — it will diff current branch against the default branch)
```

This runs review agents in parallel, auto-fixes all findings, and commits fixes.

For review reference material, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review.md`.

Code review is skipped at this stage (no PR exists yet).

If `/review` reports "No changes to review", stop — there's nothing to push.

For handling review feedback after PR creation, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md`.
