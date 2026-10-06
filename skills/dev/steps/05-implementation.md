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
required_capabilities:
  - local_writes
required_evidence:
  - test
requires_commit: true
allowed_modes:
  - inline
  - delegated
  - headless
result_schema: phase-result-v1
---

## Goal

Complete the routed implementation work and produce commit-linked test evidence without granting workers delivery or integration authority.

## How

1. Read the canonical session. Read the RFC Execution Contract first when present. Treat acceptance criteria and explicit non-goals as the scope boundary; use legacy issue-card detail only when intake recorded that fallback.
2. Validate `task.work_units` with `scripts/lib/dev-work-units.js`. A unit must name its dependencies and owned paths. Reject cycles, unknown dependencies, or requested authority broader than the parent session.
3. Use inline execution for one ordered unit. For multiple units, call `analyzeWorkUnits` and delegate only its `runnable` set; ownership overlaps and ambiguous globs serialize. Before dispatch, record each unit with `dev-session work-unit --session {session_path} --id {id} --status running --worktree {assigned_worktree}`. The runner verifies the shared Git common directory and persists that worktree's branch and base SHA. Root remains responsible for integrating completed commits and resolving conflicts.
4. Build each execution packet with `scripts/dev-prompt.js`. Set `phase: "implementation"`. For RFC-derived units, read the durable `task.work_units[].contract` and pass its acceptance criteria, approach, verification commands, test hooks, and optional `design_context` into the corresponding worker packet. Supply that complete object as the builder's `design_context` field. For a direct approved-proposal route, use `task.design_context`; a supplied work-unit contract carries the same exact object. Never reconstruct or selectively copy either contract from memory. A UI worker receives the complete source-bound prototype tree plus visual and experience invariants; a nonvisual worker receives honest experience invariants without invented visual constraints. Without a bound design context, set `ui_impact` from the observed affected surface; do not invent an approved context. Include only current-phase material and the strict worker result schema. Do not repeat provider-specific coaching; model, effort, sandbox, and permissions come from `model-profiles.json`.
4a. For visible UI work, read `product-ui-judgment.md` now, especially **Apply during implementation**. Follow repository references-by-task from root/app instructions to the relevant deeper design guidance; put those paths and a strong comparable incumbent screen into packet `inputs`, with the task similarity and useful differences. No suitable incumbent or deeper guide is an honest limitation, not a reason to invent one. Name the intended whole-page scan order and action grouping in the existing brief, using the approved behavior. Before accepting the first visible slice that changes hierarchy or interaction, personally inspect a realistic whole-page before/after in ordinary entry/return context and relevant content growth. Keep the observation with existing implementation evidence, correct composition while work is still small, and leave unavailable pixels explicitly unexamined. No additional review round or universal alternative prototype is required; later routed critique/QA still own certification.
5. Follow `tdd.md`: observe the targeted test fail before behavioral implementation, make it pass, then run the relevant suite. A docs/config/generated-only exception requires a concrete non-behavioral reason in routing state.
5a. If a verified unit commit is rejected because it changed paths outside its ownership, and the change belongs in that unit, do not edit the sidecar. Amend the RFC ownership through `/pm:rfc` (reviewed in-scope maintenance; no fresh human approval), copy the new run archive into this source repository if the RFC ran elsewhere, then run `dev-session rebind-rfc --session {session_path} --rfc-sidecar {bound_sidecar} --expected-sidecar-sha256 {reviewed_hash} --reason {why} --json` and retry the completion. Completed units may gain ownership the same way. For changed approaches, verification commands or hooks, read `../../rfc/references/maintenance.md`: adopt the updated contract, preserve old results and reverify only the affected reopened units. Finish or release an overlapping running unit first.
6. Workers return `completed`, `blocked`, or `failed`. Record the terminal transition against the same assigned worktree. Validate results with `validateWorkUnitResult`; reject `merged`, unexpected fields, missing evidence, wrong unit IDs, branch drift, or commits outside the assigned worktree. Root records accepted evidence and integrates work.
7. For CLI execution, follow `agent-runtime.md` and dispatch through `scripts/dev-runtime/dispatch.js`. Probe capabilities before launch. Resume the recorded runtime session only for the same unit and authority; otherwise start a new session.
8. After integration, run targeted tests and the project-appropriate suite, commit any root-owned integration fixes, and produce the phase-result envelope for `scripts/dev-session.js record`.

Read `multi-task-dispatch.md` only when more than one validated work unit exists.

## Done-when

- Every routed work unit is completed, or the phase has a structured blocker with bounded remediation.
- Behavioral changes have observed red/green evidence; exceptions carry a specific non-behavioral reason.
- Accepted commits are reachable from the current worktree HEAD and required tests pass after integration.
- The implementation phase result validates and has been recorded by the runner.

**Advance:** record the result and proceed to Step 06 (Design Critique), or the next routed quality phase selected by the runner.
