---
name: Implementation
order: 5
description: Dispatch fresh developer agents to implement the approved RFC
---

## Goal

Complete implementation of the approved RFC and leave the branch in a verified, reviewable state for downstream gates (Steps 07–09).

<HARD-RULE>
Step 05 **dispatches agents**. It does NOT execute implementation in the orchestrator context.

- **Multi-task (`task_count > 1`):** dispatch one fresh @developer agent per task as a **subprocess** (`scripts/dispatch-issue.sh`), sequentially. The subprocess owns the full lifecycle implement → review → ship → merge. The orchestrator coordinates — create worktree, build prompt, dispatch subprocess, read result.json, checkpoint, sync main, next. Never read the RFC and start implementing.
- **Single-task M/L/XL:** dispatch one fresh @developer agent in the existing worktree. May use in-process `Agent(...)` / `spawn_agent(...)` since there's only one task and the orchestrator isn't carrying multi-task state.
- **Single-task XS/S:** handled inline per the XS Express Path / size routing table in `02-intake.md`. This is the **only** valid inline path.

Enforcement check before writing any implementation code in this step: if `task_count > 1` OR size is M/L/XL, you MUST dispatch a fresh agent. Multi-task uses **subprocess dispatch** (see `dev/references/agent-runtime.md` § Subprocess Dispatch). If you catch yourself about to read the RFC to "start implementing", STOP — you are the orchestrator, not the implementer. Dispatch with the brief below.

**Why subprocess for multi-task:** in-process sub-agents inherit "return promptly to parent" pressure and tend to bail back to the orchestrator after creating the PR — dumping the merge-loop work (CI watching, review-comment fixes) onto the orchestrator. Over an N-issue epic this burns orchestrator context and triggers compaction loops. A subprocess has no parent to bail to, so it owns the full lifecycle by construction.

Violations of this rule have happened when the orchestrator has hot context on the codebase and takes the path of least resistance. That path is wrong — fresh agents are the contract.
</HARD-RULE>

## Implementation

Dispatch **fresh** @developer agent(s) using the runtime adapter. The RFC is the contract and contains all codebase exploration findings needed for implementation. RFC generation and review are handled by the standalone `/rfc` skill — dev assumes an approved RFC exists (or inline planning was done for smaller work).

**Implementation methodology:** All implementation agents follow `dev/references/tdd.md` (inside-out TDD) and `dev/references/subagent-dev.md` for task execution. The implementation-flow.md reference defines the full lifecycle.

### Single-task implementation (task_count == 1)

One fresh agent in the existing worktree.

**Implementation brief:**

```text
Implement the approved RFC.

**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}
**RFC:** {pm_dir}/backlog/rfcs/{slug}.html
**Test hooks:** {TEST_HOOKS}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md Steps 1–2
for setup and implementation methodology. Steps 4+ (design critique, QA, review, ship) are
handled by the orchestrator after you return.

Lifecycle:
1. cd {WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC Execution Contract first (`id="execution-contract"` when present), then read Issue cards, Test Strategy, and appendix detail needed for implementation. Your `Test hooks` (above) come pre-parsed from the validated RFC sidecar — you do not need to read the sidecar yourself.
4. Use TDD: run the targeted failing test before implementation, then make it pass
5. Run the project test suite — all tests must pass
6. Commit implementation and test changes
7. Record TDD evidence in `.pm/dev-sessions/{slug}.gates.json` as `tdd` tied to the committed HEAD, or `skipped` with reason for docs/config/generated-only work tied to that same committed HEAD

If blocked, report: "Blocked: {reason}"
Do NOT pause for confirmation — the RFC is the contract. Execute it.

Report when done: "Implementation complete. {N} files changed, tests passing."
```

The implementation agent does NOT own design critique, QA, review, ship, or cleanup. Those are handled by Steps 07–09.

### Multi-task implementation (task_count > 1)

Sequential execution, one task at a time: each task gets a fresh @developer agent in its own worktree, dispatched as a **subprocess** (`scripts/dispatch-issue.sh`) that owns the full lifecycle implement → design-critique → QA → review → ship → merge. The orchestrator coordinates — create worktree, build prompt, background-dispatch, wait via `scripts/dispatch-wait.sh`, checkpoint, sync main, next.

That machinery — environment readiness, the per-issue prompt template, subprocess dispatch, the `dispatch-wait.sh` branch table, checkpointing, per-task lifecycle tracking, and failure recovery — lives in its own reference so it loads only on this branch, not on every XS/S/single-task run.

**Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/multi-task-dispatch.md` and follow it.** It runs under the Continuous Execution / non-interactive discipline below. When every task is merged, proceed to Step 09 (retro) — Steps 07–08 are handled inside each subprocess.

### Continuous Execution

<HARD-RULE>
After the user approves the RFC (via /rfc), the orchestrator proceeds through ALL remaining steps without pausing for user input. No "Ready to execute?" prompts, no confirmation dialogs, no options menus.

The rationale: by this point, the spec has been reviewed by product/design agents, the plan has been reviewed by engineering agents, and the user has explicitly approved. The plan is the contract. Execute it.

**Only stop for:**
- Test failures that can't be resolved after 3 attempts
- QA verdict of **Blocked** (ask user for guidance, Step 07)
- Merge conflicts (Step 08)
- CI failures that require human intervention (Step 08)
- Review feedback from human reviewers on the PR (Step 08, use `ship/references/handling-feedback.md`)
- Per-task agent returned **Blocked** (multi-task: ask user whether to skip or investigate)
</HARD-RULE>

### Agent lifecycle

```
RFC generated and reviewed via /rfc (separate skill)
  → user approves RFC

Single-task: Fresh developer agent dispatched (Implementation)
  → reads approved RFC
  → implements code + tests, commits
  → returns "Implementation complete."

Multi-task: For each task in order, fresh developer agent dispatched as a subprocess
  → orchestrator builds prompt at .pm/runs/issue-{N}/prompt.txt
  → orchestrator shells out: scripts/dispatch-issue.sh --runtime ... --prompt-file ...
  → subprocess reads approved RFC, focuses on assigned Issue section
  → subprocess: implements → design critique → QA → review → merge → cleanup
  → subprocess writes .pm/runs/issue-{N}/result.json (status: merged | blocked) and exits
  → orchestrator reads result.json, checkpoints, syncs main, dispatches next

Orchestrator runs Step 09 (retro) once after all tasks complete.
```

**Single-task** hands off to Step 07 with code and tests committed on the feature branch, the suite passing, and the session file updated. **Multi-task** subprocesses each own implement→merge and write `result.json` (`status: merged` or `blocked`); the orchestrator checkpoints the `## Tasks` table, then proceeds straight to Step 09 (retro) — Steps 07–08 are skipped because the subprocesses handled them.
