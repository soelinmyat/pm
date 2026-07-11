# Work-unit execution

Use bounded work units when an RFC or implementation plan contains separable concerns. The root session remains responsible for integration, aggregate verification, push, PR, merge, and tracker updates.

## Goal

Run the ready parts of a plan without creating file conflicts, hiding dependencies, or giving workers more authority than the root owns.

## Source of truth

Represent each unit in canonical dev state:

```json
{
  "id": "issue-2",
  "title": "Add runtime adapters",
  "depends_on": ["issue-1"],
  "owns": ["scripts/dev-runtime/**", "tests/dev-runtime-*.test.js"],
  "status": "pending",
  "result_path": null
}
```

Validate and analyze these records with `scripts/lib/dev-work-units.js`.

## How

### Choose execution mode

Prefer the root model inline when the work is ordered, small, or touches shared state. Use a delegated or headless worker when a unit is bounded and delegation materially helps. Do not require a new worker merely because a new unit begins; reuse or resume is valid when context and ownership remain safe.

The configured runtime profile selects the model. Never pin a provider or model in this reference. A missing delegation capability falls back to inline execution when the phase permits it.

### Determine readiness

A pending unit is dependency-ready only when every `depends_on` unit is `completed`. Missing dependencies, duplicates, and cycles are errors.

Dependency readiness does not imply concurrency safety. Before dispatch:

1. Compare `owns` against running units.
2. Compare it against other units selected for the same wave.
3. Serialize any overlapping ownership.
4. If ownership is vague or uses a glob whose intersection cannot be disproved, serialize.

Tasks with independent ownership may run together. Tasks that touch a shared layer, generated contract, database state, import chain, or configuration file serialize unless repository instructions explicitly provide a safe isolation mechanism.

### Narrow authority

Derive worker authority from root authority with `narrowAuthority(parent, requested)`. Missing worker actions become denied. A worker can relinquish authority but cannot gain an action the root lacks.

Default implementation-worker authority:

- Allow inspection, local edits, tests, and a scoped commit when the root owns them.
- Deny push, PR creation, merge, and tracker updates.
- Scope all writes to the assigned worktree and owned paths.

Authority expansion is a validation failure, not a prompt suggestion.

### Build the worker package

Use `worker-contract.md` for the nine-section prompt. Include:

- Work-unit ID, full outcome, ACs, and Test hooks.
- Explicit CWD, branch, worktree, owned paths, and dependency results.
- App-specific test command and repository rules.
- Narrowed authority and structured result schema.
- Stop conditions from `implementer.md`.

The worker reads task-specific source files as needed. Do not paste unrelated future phases or the full controller transcript.

### Consume results

Workers return the provider-neutral result described in `implementer.md`. Validate it before changing unit status. A clean process exit without a valid result is not success.

- `completed`: verify evidence and commit, then mark the unit completed.
- `blocked`: preserve work and surface the blocker/remediation.
- `failed`: classify the failure and retry only with a changed hypothesis, context, profile, or task boundary.
- `merged`: invalid for a work unit because integration belongs to the root.

After all units complete, the root runs aggregate verification and the required review gates against the combined branch.

## Review

Independent spec and quality review may run as separate read-only workers when useful. The required `pm:review` gate remains authoritative; per-unit review does not replace it.

## Done-when

- Every dependency-ready unit has either completed or returned a structured blocker.
- No concurrently running units have overlapping ownership.
- Worker authority is equal to or narrower than root authority.
- Every completed result has test evidence tied to its commit.
- Aggregate verification and required review remain assigned to the root.

**Advance:** return the validated unit results to the implementation phase controller.
