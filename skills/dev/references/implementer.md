# Implementer worker contract

Use this reference for inline, delegated, and headless implementation. The worker contract is provider-neutral; the configured runtime profile selects the model and execution mechanism.

## Goal

Complete one owned work unit, verify it, and return a machine-readable result without performing root-owned external actions.

## How

The controller supplies the nine prompt sections from `worker-contract.md`. Before editing:

1. Verify CWD, branch, and worktree.
2. Read the work-unit outcome, scope, ACs, Test hooks, owned paths, dependency results, and repository rules.
3. Confirm requested authority is no broader than the controller's authority.
4. Check the worktree for unrelated or pre-existing changes. Preserve them.

Implement with TDD from `tdd.md`: observe the relevant test fail, write the smallest change that passes it, then refactor while green. Stage only owned files by explicit path. Never use `git add .` or `git add -A`.

### Authority

Only perform actions explicitly allowed in the prompt. The normal worker may inspect, edit, test, and commit inside its assigned worktree. Push, PR creation, merge, deployment, and tracker updates belong to the root and are denied unless the contract expressly grants them.

Do not modify files outside `owns`. If required work crosses that boundary, return `blocked` with the additional paths and reason instead of expanding scope yourself.

### Stop conditions

Return `blocked` when:

- A missing product or architecture decision materially changes behavior.
- Required context, dependency output, credentials, or environment is unavailable.
- The baseline is unusable and the failure is outside the unit's ownership.
- The task needs files outside its ownership.
- The same root cause remains after three evidence-backed attempts.

Return `failed` for an unrecoverable execution error. Do not repeatedly issue the same failing command without a changed hypothesis.

### Self-review

Before returning `completed`, check:

- Every AC and Test hook has corresponding evidence.
- Tests assert required behavior rather than implementation details.
- Changed paths stay within ownership.
- The commit is on the assigned branch and contains no unrelated files.
- No denied external action occurred.

### Structured result

Write one JSON object and no provider-specific sentinel:

```json
{
  "schema_version": 1,
  "work_unit_id": "issue-2",
  "status": "completed",
  "summary": "Implemented the runtime adapter contract.",
  "commit": "abc123",
  "files_changed": 4,
  "evidence": [
    {
      "kind": "test",
      "command": "node --test tests/dev-runtime-adapters.test.js",
      "exit_code": 0
    }
  ],
  "blocker": null,
  "runtime": {
    "provider": "codex",
    "model": "configured-workhorse"
  }
}
```

Allowed statuses are `completed`, `blocked`, and `failed`. Blocked and failed results replace `blocker: null` with:

```json
{
  "reason": "A concrete reason",
  "blocker": {
    "reason": "A concrete reason",
    "remediation": "The decision or state change needed"
  }
}
```

The top-level `reason` matches `blocker.reason`. This keeps the result compatible with the shared runtime schema while the blocker object carries remediation.

Validate the result with `validateWorkUnitResult()` from `scripts/lib/dev-work-units.js`. A completed result requires evidence. A work-unit worker must never return `merged`.

## Done-when

The scoped change is implemented, tests pass, self-review is complete, owned files are committed when authorized, and a valid structured result is available to the controller.

**Advance:** return control to the root implementation controller; do not begin shipping.
