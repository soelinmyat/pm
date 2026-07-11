---
name: Implementation
order: 5
description: Implement dependency-ready work units with bounded authority and executable evidence
phase: implementation
requires:
  - worker-contract.md
  - tdd.md
  - implementation-flow.md
  - subagent-dev.md
gates:
  - tdd
result_schema: phase-result-v1
---

## Goal

Complete the routed implementation work and produce commit-linked test evidence without granting workers delivery or integration authority.

## How

1. Read the canonical session. Read the RFC Execution Contract first when present. Treat acceptance criteria and explicit non-goals as the scope boundary; use legacy issue-card detail only when intake recorded that fallback.
2. Validate `task.work_units` with `scripts/lib/dev-work-units.js`. A unit must name its dependencies and owned paths. Reject cycles, unknown dependencies, or requested authority broader than the parent session.
3. Use inline execution for one ordered unit. For multiple units, call `analyzeWorkUnits` and delegate only its `runnable` set; ownership overlaps and ambiguous globs serialize. Root remains responsible for integrating completed commits and resolving conflicts.
4. Build each execution packet with `scripts/dev-prompt.js`. Include only current-phase material and the strict worker result schema. Do not repeat provider-specific coaching; model, effort, sandbox, and permissions come from `model-profiles.json`.
5. Follow `tdd.md`: observe the targeted test fail before behavioral implementation, make it pass, then run the relevant suite. A docs/config/generated-only exception requires a concrete non-behavioral reason in routing state.
6. Workers return `completed`, `blocked`, or `failed`. Validate results with `validateWorkUnitResult`; reject `merged`, unexpected fields, missing evidence, wrong unit IDs, or commits outside the assigned worktree. Root records accepted evidence and integrates work.
7. For CLI execution, follow `agent-runtime.md` and dispatch through `scripts/dev-runtime/dispatch.js`. Probe capabilities before launch. Resume the recorded runtime session only for the same unit and authority; otherwise start a new session.
8. After integration, run targeted tests and the project-appropriate suite, commit any root-owned integration fixes, and produce the phase-result envelope for `scripts/dev-session.js record`.

Read `multi-task-dispatch.md` only when more than one validated work unit exists.

## Done-when

- Every routed work unit is completed, or the phase has a structured blocker with bounded remediation.
- Behavioral changes have observed red/green evidence; exceptions carry a specific non-behavioral reason.
- Accepted commits are reachable from the current worktree HEAD and required tests pass after integration.
- The implementation phase result validates and has been recorded by the runner.

**Advance:** proceed to Step 07 (Review) for routed quality gates.
