# Design Critique Integration Reference

`pm:design-critique` is the source of truth for the Design Critique gate. Read its `SKILL.md`, ordered steps, and `references/evidence-contract.md`; do not recreate a parallel flow here.

## Execution context

Execution context is independent from critique subject:

- **Embedded:** Dev owns implementation and applies fixes returned by the gate.
- **Standalone:** the skill may implement fixes within the user-authorized scope.

The subject mode is separately `product-ui` or `pm-artifact`. Never infer subject mode from embedded versus standalone execution.

## Review perspectives

Run two evidence reviews:

1. A primary reviewer receives route context, acceptance criteria, project principles, captures, accessibility evidence, and deterministic audits.
2. Fresh Eyes receives only the subject/job description, project principles, and rendered evidence. It never receives previous findings, implementation rationale, or round history.

Run them in parallel when isolated delegation is available. Otherwise run two explicitly isolated inline passes. Merge findings in the orchestrator using deterministic subject/region/rule/evidence identity; do not dispatch a third “merge” reviewer.

## Ownership

- Design Critique: rendered hierarchy, density, consistency, accessibility evidence, state presentation, responsive behavior, and artifact print/navigation craft.
- QA: functional acceptance behavior, navigation behavior, data state transitions, and end-to-end correctness.
- Review: source correctness, security, reuse, maintainability, and runtime efficiency.

Preserve evidence for an ownership handoff, but do not count another gate’s finding toward Design Critique pass/fail.

## Evidence and outcome

All passing evidence is durable under `.pm/dev-sessions/{slug}/design-critique/` and validated by `scripts/design-critique-check.js` against current HEAD. `/tmp` may be used as capture scratch space only.

The gate has at most two review rounds. P0/P1 fixes require distinct before/after capture hashes. Outcomes are `passed`, `failed`, `blocked`, and `deferred`; deferred maps to a blocked Dev gate until the selected direction is rendered and rechecked.
