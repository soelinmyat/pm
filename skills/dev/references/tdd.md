# Risk-Aware Test-Driven Development

## Purpose

Use executable evidence to prove a change is necessary, correct, and safe. The
default for new behavior and bug fixes is a witnessed red-green-refactor cycle;
the mode changes when the work is legacy characterization, a disposable spike,
generated code, or configuration.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `tdd`:

- run start / run end
- one step span for each completed `red`, `green`, and `refactor` cycle
- the selected mode and any reason a conventional red test was not applicable

## Core rule

**NEVER CLAIM TEST-FIRST PROOF WITHOUT OBSERVING A RELEVANT FAILURE BEFORE THE
BEHAVIORAL FIX.**

Do not delete useful pre-existing work merely because tests were written late.
Preserve it, choose the honest mode below, and create evidence that can fail for
the defect or contract being changed.

## Choose the mode

Use the mode that matches the work, not the one that makes the gate easiest.

| Mode | Use when | Required proof |
|---|---|---|
| **New behavior** | A new user-visible or programmatic contract is being added | A focused test fails because the behavior is absent, then passes after the smallest implementation |
| **Regression** | Existing behavior is wrong | A test reproduces the reported defect on the pre-fix state, then passes after the root-cause fix |
| **Legacy characterization** | Existing code lacks reliable tests and must be changed safely | Characterization tests first pin intentional current behavior; a separate failing test expresses the intended change whenever the behavior can be isolated |
| **Disposable spike** | The team must learn whether an approach is viable | Time-box the spike and keep it out of the delivery diff; discard it, then implement from a failing acceptance test |
| **Generated code** | Output is produced by a generator, schema, or template | Test the generator/input contract and representative generated output; change the source generator and regenerate, never hand-maintain generated output |
| **Configuration** | Behavior is controlled mainly by config, manifests, or wiring | Start with a failing schema, parser, build, integration, or smoke check that demonstrates the missing or invalid configuration |

Pure prose or metadata with no executable behavior may be routed past TDD by the
Dev risk contract. Do not invent a meaningless test only to satisfy a ritual.

### Existing implementation discovered before RED

Do not destroy or hide it. First determine whether it is user work, a prior
commit, a spike, or an incomplete implementation. Then use the least risky way
to prove test sensitivity:

1. Run the new test against the known pre-fix commit or a clean comparison
   worktree when available.
2. For a regression, temporarily exercise the unfixed path without committing a
   destructive revert.
3. For legacy behavior, add characterization coverage and use a narrowly scoped
   mutation or differential check to show that the assertion detects the
   relevant change.
4. If none is safe, record that the test is post-hoc verification rather than
   test-first proof and strengthen it with contract, integration, or boundary
   evidence. Never relabel it TDD.

## The working cycle

### 1. RED — specify one behavior

Write the smallest test that states the observable contract. Prefer public
behavior over implementation detail and real collaborators over mocks.

```javascript
test("retries a transient failure up to the configured limit", async () => {
  let attempts = 0;
  const operation = async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary");
    return "ok";
  };

  assert.equal(await retry(operation, { attempts: 3 }), "ok");
  assert.equal(attempts, 3);
});
```

Run the narrowest repository-declared command that executes the test. Confirm:

- it fails rather than crashing during setup;
- the message is the expected missing-behavior or reproduced-defect signal;
- changing an unrelated input would not produce the same failure;
- the failure is not caused by a stale fixture, typo, wrong import, or unavailable
  environment.

If it passes immediately, learn why. The behavior may already exist, the test
may be observing the wrong boundary, or the requirement may be wrong. Do not
weaken the assertion to manufacture red.

### 2. GREEN — make the focused proof pass

Implement the smallest coherent change that satisfies the contract. Avoid
unrelated cleanup, speculative options, or widening public APIs. Run the focused
test, then the nearest affected suite.

Fix implementation defects, not a correct expectation. Change the test only
when new evidence shows the expectation or fixture is wrong, and record that
reason.

### 3. REFACTOR — improve without changing behavior

Only after green:

- remove duplication;
- clarify names and boundaries;
- replace test scaffolding that obscures behavior;
- run the focused and affected suites after each coherent refactor.

Add the next behavior with a new red cycle. Do not bundle several acceptance
criteria into one ambiguous test.

## Mode-specific guidance

### Regression fixes

Reproduce the smallest externally meaningful symptom before editing production
behavior. When the failure is intermittent, first make the trigger deterministic
with controlled time, scheduling, inputs, or dependencies. A test that fails for
an unrelated environment problem is not regression evidence.

### Legacy code

Characterization tests document what the system does today; they do not endorse
every current behavior. Identify which outputs and side effects must remain,
write those tests, then add a failing test for the intended change. Prefer seams
at stable boundaries over large snapshot files. When refactoring is needed to
make the behavior observable, separate and verify that no-behavior-change step
before the functional edit.

### Spikes

Label a spike disposable, isolate it from the delivery branch when practical,
and define the question and time limit before starting. Its result is learning,
not production proof. If retaining spike code is genuinely safer, treat it as
legacy code: characterize what is worth preserving, add failing acceptance
coverage for the deliverable behavior, and review the retained design explicitly.

### Generated code

Test the source of generation: schema, template, generator, or transformation.
Use a small representative output or structural assertions rather than checking
in huge brittle snapshots without intent. Regenerate with the repository's
documented command and verify drift. Never edit the generated artifact as the
primary fix unless the repository declares it hand-maintained.

### Configuration and wiring

Choose the closest executable consumer. Useful red evidence includes schema
validation, a parser assertion, a build that rejects a missing key, an integration
test for dependency wiring, or a bounded smoke test. Secrets and machine-local
values stay out of fixtures and captured output.

## Match test depth to risk

- **Low risk:** focused unit or contract assertion plus the nearest affected
  suite.
- **Boundary or integration risk:** exercise serialization, persistence,
  retries, partial failure, and compatibility at the real boundary.
- **Authorization, privacy, or data risk:** cover allowed and denied actors,
  cross-tenant/resource access, redaction, and failure paths. A happy-path unit
  test is insufficient.
- **Concurrency or operational risk:** use deterministic scheduling where
  possible and cover retry, idempotency, cancellation, timeout, and cleanup.
- **UI behavior:** test state transitions and semantics at component or
  integration level; use browser QA for rendering and live interaction evidence.

Follow the routed test strategy and repository conventions. More tests are not
automatically better; each test should protect a decision, boundary, or failure
mode.

## Test quality checks

- Name the behavior and condition, not the implementation method.
- Assert outcomes and durable side effects; avoid asserting incidental call
  order unless order is the contract.
- Mock only an understood boundary. Do not test that a mock returns what it was
  programmed to return.
- Keep fixtures minimal but realistic enough to expose the boundary.
- Prove negative cases where a permissive implementation would be dangerous.
- Avoid sleeps; prefer condition-based waiting or controlled clocks.
- Keep command output free of unexpected warnings and unhandled errors.

When adding mocks or test utilities, read `testing-anti-patterns.md` in this
directory.

## Evidence to retain

For each behavioral cycle, record:

- selected mode;
- focused command;
- expected RED signal and observed non-zero result;
- GREEN result on the fixed state;
- affected-suite result;
- any justified deviation, such as legacy characterization or generated output.

A command name without its observed outcome is not evidence. A broad suite that
never exercises the changed behavior does not replace the focused proof.

## Before marking implementation complete

- [ ] Every changed behavior has an appropriate mode and focused test evidence.
- [ ] New behavior or a regression has an observed relevant RED before the fix,
      unless the deviation is explicitly and honestly recorded.
- [ ] Legacy invariants that must remain are characterized.
- [ ] Spike code is discarded or promoted through the legacy path.
- [ ] Generated code/config changes test their source contract and consumer.
- [ ] Focused tests and the affected repository suite pass on the final tree.
- [ ] Edge cases match the change's actual risk, not a generic checklist.
