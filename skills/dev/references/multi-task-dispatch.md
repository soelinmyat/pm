# Multi-Work-Unit Dispatch

Use this reference only when the canonical session contains more than one work unit.

## Goal

Run independent implementation units concurrently where safe while keeping integration and all external effects with the root orchestrator.

## Dispatch algorithm

1. Validate the complete DAG with `validateWorkUnits` from `scripts/lib/dev-work-units.js`.
2. Call `analyzeWorkUnits`. Dispatch only `runnable`; keep `serialized` units pending until their ownership conflicts clear.
3. Narrow parent authority for every worker. The normal worker grant is local read/write, test, and optional commit inside its assigned worktree. Push, PR, merge, tracker updates, and aggregate gate changes are always false.
4. Build a phase-local prompt with the objective, unit-specific acceptance criteria, dependencies already satisfied, owned paths, constraints, evidence requirements, and structured result contract.
5. Prefer native in-process delegation for bounded units. Use `scripts/dev-runtime/dispatch.js` when a separate CLI session is beneficial or native delegation is unavailable. Profile choice is independent of workflow semantics.
6. Validate each result and inspect its commit before marking the unit completed. A failed result consumes a bounded retry; blocked stops dependent units. Never infer completion from prose or a process exit code alone.
7. After a wave, the root integrates commits in deterministic DAG order, resolves conflicts, reruns tests, records evidence, and analyzes the next wave.

## Compatibility

`scripts/dispatch-issue.sh` remains a compatibility entry point and forwards to the Node runtime adapter. Legacy PID, crash, quota, and old result-file handling remain supported, but new prompts use `completed | blocked | failed`; `merged` is not valid worker authority.

## Done-when

All work units have schema-valid terminal results, all accepted commits are integrated and reachable, and the root has run post-integration tests. Then return one implementation phase result to the session runner.
