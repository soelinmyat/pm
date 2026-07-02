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

Sequential implementation, one task at a time. Each task gets a fresh agent with its own worktree.

#### Environment readiness check

Before dispatching the first implementation agent, check whether any task touches mobile code (React Native/Expo). If so, ensure Metro is running:

```bash
# Only needed when tasks include mobile changes
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)
sleep 3
```

Skip if no task touches mobile code. Log in the state file whether Metro was started.

#### Skip fully-implemented tasks

If the RFC reported 0 tasks for a sub-issue (all ACs already implemented with tests), mark it as "Already implemented" in the state file and skip to the next one.

#### Claude subscription usage note

Multi-task dispatch spawns a background `claude -p` subprocess per task. Anthropic paused the previously announced 2026-06-15 Agent SDK credit split: for now, `claude -p` still draws from the user's normal Claude subscription usage limits, and the separate monthly Agent SDK credit is not active. See `dev/references/agent-runtime.md` § "Claude subscription behavior".

Do not pause for a special subprocess cost opt-in, and do not require `PM_ALLOW_SUBPROCESS`. The approved RFC is the execution consent. If a subprocess hits a normal usage limit, usage-credit limit, quota, or rate limit, `dispatch-issue.sh` writes a `blocked` result and the orchestrator follows the branch table below.

#### Sequential execution

For each task (Issue section) in dependency order from the RFC:

1. **Create worktree:**
   ```bash
   git worktree add .worktrees/{task-slug} -b feat/{task-slug} origin/{DEFAULT_BRANCH}
   ```

2. **Set sub-issue status to In Progress** (if sub-issue has a tracker ID).
   Follow retry pattern in `${CLAUDE_PLUGIN_ROOT}/references/linear-operations.md`. If the call fails after retries, log the failure and proceed — do not block implementation on Linear:
   ```
   mcp__plugin_linear_linear__save_issue({ id: "{SUB_ISSUE_ID}", state: "In Progress" })
   ```

3. **Build the per-issue prompt** at `${pm_state_dir}/runs/issue-{N}/prompt.txt`:

```text
Implement and ship the approved RFC task. You are running as a top-level subprocess —
there is no parent to return to. You own the full lifecycle until the issue is merged
or you write a blocked result. Do not exit until one of those happens.

**CWD:** {TASK_WORKTREE_PATH}
**Branch:** feat/{task-slug}
**RFC:** {pm_dir}/backlog/rfcs/{parent_slug}.html
**Parent RFC slug:** {parent_slug}
**Task/session slug:** {task-slug}
**Your issue:** Issue {N} — {ISSUE_TITLE}
**Test hooks:** {TEST_HOOKS}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}
**Result file:** ${RESULT_FILE}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Read the RFC Execution Contract first (`id="execution-contract"` when present). Then focus on Issue {N} ({ISSUE_TITLE}) — that is your scope. Your `Test hooks` (above) come pre-parsed from the validated RFC sidecar — you do not need to read the sidecar yourself. The RFC also contains shared architecture and data model appendix sections that apply to your issue.

Lifecycle tracking: before each step, write your current stage to a tracking file:
  echo "{stage}" > .dev-lifecycle-stage
Valid stages: setup, implement, design-critique, qa, review, ship, cleanup.
This file is NOT committed — it's for recovery if you fail mid-lifecycle.

Lifecycle:
1. cd {TASK_WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC Execution Contract, focus on Issue {N}, implement its tasks
4. Run the project test suite — all tests must pass
5. Commit implementation changes
6. Record TDD evidence in `.pm/dev-sessions/{task-slug}.gates.json` as `tdd` tied to the commit, or `skipped` with reason for docs/config/generated-only work
7. If UI changes: invoke pm:design-critique. If no visual impact, record `design-critique` as `skipped` with a concrete reason
8. If UI changes: dispatch QA agent per implementation-flow.md and record the `qa` gate
9. If SIZE is M/L/XL: invoke pm:review on the branch (6-lens fan-out incl. the simplification lenses), fix all high-confidence findings, commit
    If SIZE is XS/S: run code scan (single reviewer per implementation-flow.md)
10. Run full test suite as final verification and record the `verification` gate
11. Run the final recertification pass from `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/07-review.md`: rerun gates whose relevant surface changed after their evidence commit, or write `verified_commit` / `verified_at` only when existing evidence still applies to current HEAD
12. Run the gate checker and fix any missing/stale gates before push:
    ```bash
    PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
    node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
      --manifest .pm/dev-sessions/{task-slug}.gates.json \
      --commit "$(git rev-parse HEAD)" \
      --base origin/{DEFAULT_BRANCH}
    ```
13. Push branch, create PR, squash merge via merge-loop, cleanup worktree and branch
14. **Before exiting**, write your structured result to ${RESULT_FILE}:
    On success:
      {"status":"merged","issue_id":"{ISSUE_ID}","pr":<N>,"merge_sha":"<sha>","files_changed":<N>}
    On block:
      {"status":"blocked","issue_id":"{ISSUE_ID}","reason":"<one-line reason>"}

Do NOT pause for confirmation — the RFC is the contract. Execute it.
Do NOT exit before writing the result file. The orchestrator reads it to advance the plan.
```

**Placeholder contract for `prompt.txt`:** `{...}` placeholders (`{N}`, `{ISSUE_TITLE}`, `{TEST_HOOKS}`, `{TASK_WORKTREE_PATH}`, `{pm_state_dir}`, `{parent_slug}`, `{task-slug}`, …) are substituted by **you, the orchestrator**, as you write the file. `{TEST_HOOKS}` is this issue's `test_hooks` array from the validated RFC sidecar — the worker receives them pre-parsed and never reads the sidecar itself. In multi-task prompts, `{parent_slug}` is only for the RFC path and parent session context; `.pm/dev-sessions/*.gates.json` paths must use `{task-slug}` because the pre-push hook derives the required manifest from `feat/{task-slug}`. `${PM_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`, and `${RESULT_FILE}` are left **literal** — `dispatch-issue.sh` resolves them to absolute paths before the subprocess runs (the subprocess has no plugin-root env var, and a relative result path written from inside the worktree resolves where the orchestrator never looks). Do not hand-expand or escape these three.

4. **Dispatch as subprocess in the background.** Per-issue subprocesses run for hours (CI watches, multi-round review fixes). Synchronous Bash invocations will hit the harness timeout (Bash tool sync max is ~10 min in Claude Code) and kill the subprocess prematurely. Always background-dispatch.

   **Claude runtime:**
   ```text
   Bash(
     command: "PM_PLUGIN_ROOT=\"${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}\"; bash \"$PM_PLUGIN_ROOT/scripts/dispatch-issue.sh\" \\
       --runtime claude \\
       --worktree {TASK_WORKTREE_PATH} \\
       --prompt-file {pm_state_dir}/runs/issue-{N}/prompt.txt \\
       --result-file {pm_state_dir}/runs/issue-{N}/result.json \\
       --log-file {pm_state_dir}/runs/issue-{N}/log.txt",
     run_in_background: true
   )
   ```
   Returns a shell ID immediately. The subprocess runs uninterrupted in user context. If Claude reports a usage-limit, usage-credit, quota, or rate-limit stop, the dispatcher writes a blocked result for the orchestrator to surface.

   **Codex runtime:** detach the process via shell (`nohup ... &` or equivalent) and capture the PID. Same `dispatch-issue.sh` invocation, just `--runtime codex`.

5. **Wait via a bounded heartbeat — the Monitor command emits a sentinel you MUST read.** The wait can take hours, but the Claude Code harness does not guarantee a single Monitor invocation will fire its notification. Cap each Monitor call at **15 minutes (900s)**. The Monitor command itself does the state check and prints a `DISPATCH_STATE=<done|crashed|tick>` sentinel on its final line — that sentinel is the orchestrator's instruction for what to do next.

   **Claude runtime — primary wait:**
   ```text
   Monitor(
     command: "PID_FILE={pm_state_dir}/runs/issue-{N}/dispatch.pid; RESULT={pm_state_dir}/runs/issue-{N}/result.json; end=$(($(date +%s) + 900)); until [ -f \"$RESULT\" ] || { [ -f \"$PID_FILE\" ] && ! kill -0 \"$(cat \"$PID_FILE\")\" 2>/dev/null; } || [ $(date +%s) -ge $end ]; do sleep 30; done; if [ -f \"$RESULT\" ]; then echo DISPATCH_STATE=done; cat \"$RESULT\"; elif [ -f \"$PID_FILE\" ] && ! kill -0 \"$(cat \"$PID_FILE\")\" 2>/dev/null; then echo DISPATCH_STATE=crashed; else echo DISPATCH_STATE=tick; fi"
   )
   ```

   Monitor's final stdout line is one of:
   - `DISPATCH_STATE=done` — followed by the contents of result.json
   - `DISPATCH_STATE=crashed` — dispatcher PID dead with no result (SIGKILL bypassed EXIT trap)
   - `DISPATCH_STATE=tick` — 15 min elapsed, subprocess still running

   **Codex runtime / fallback:** same command in a foreground shell.

6. **Read DISPATCH_STATE and act. This is non-negotiable.**

<HARD-RULE>
After every Monitor return, your VERY NEXT ACTION is to locate the `DISPATCH_STATE=` line in Monitor's output and branch on it. Do NOT re-fire Monitor without first identifying which state was reached.

**The failure mode this rule exists to prevent:** the orchestrator treats Monitor as a "wait" primitive and reflexively re-fires it after each return, burning 15 min per tick and learning nothing. If you catch yourself about to type `Monitor(...)` right after a Monitor return without first reading the `DISPATCH_STATE=` sentinel — STOP. That is the bug.

Branch table — execute exactly one of these based on the sentinel:

| DISPATCH_STATE | Next action |
|---|---|
| `done` | Parse result.json (emitted on the line after the sentinel). On `status=merged`: checkpoint, sync main, advance to next task. On `status=blocked`: halt epic, surface `reason` to user. |
| `crashed` | Halt epic. Escalate: "subprocess crashed without writing result — see `{log-file}`". |
| `tick` | Re-arm: re-issue the exact same Monitor command from Step 5. Heartbeats are uncapped — a 6-hour subprocess = ~24 ticks, all expected. |

A `tick` is the **only** state in which re-firing Monitor is correct. Any other path that ends in another Monitor call is the bug. The cost of the heartbeat is one cache-miss orchestrator wake per 15 min while a subprocess runs — bounded, predictable, and cheaper than the hours of idle wedging that prompted this design.
</HARD-RULE>

Each per-task subprocess owns the full lifecycle for its task — implement through merge — without bailing to the orchestrator. The orchestrator's role is reduced to: build prompt, background-dispatch, wait via notification, read result, advance plan.

7. **Checkpoint** — update state file `## Tasks` table immediately (backward-compat: also check for `## Sub-Issues` header in older session files). Update `## Implementation Progress`.

   **Event extraction (for retro):** Per-task subprocesses handle QA/review/ship internally and don't write event data to the shared state file. After each subprocess returns merged, extract key events from the PR so retro can learn from them:
   ```bash
   # Get review iteration count
   gh pr view {PR_NUMBER} --json reviews --jq '.reviews | length'
   # Get CI run count (multiple runs = CI failures fixed)
   gh pr view {PR_NUMBER} --json statusCheckRollup --jq '.statusCheckRollup | length'
   # Check if merge had conflicts (commits with "merge" or "conflict" in message)
   gh pr view {PR_NUMBER} --json commits --jq '[.commits[].messageHeadline | select(test("merge|conflict"; "i"))] | length'
   ```
   Append to the session state under `## Per-Task Events`:
   ```
   - Task {N}: reviews={count}, CI runs={count}, conflict commits={count}, verdict={Merged|Blocked}
   ```

8. **Sync main** before the next task:
   ```bash
   git checkout -B {DEFAULT_BRANCH} origin/{DEFAULT_BRANCH}
   ```

9. **Announce progress:**
   > **Task {N} of {TOTAL} complete.** Next: {ISSUE_TITLE}. Proceeding.

10. Proceed to next task.

#### Per-task lifecycle tracking

Each per-task agent must track its lifecycle progress so recovery agents know where to resume. Before starting each lifecycle step, the agent writes its current stage to a tracking file in the worktree:

```bash
echo "{stage}" > {TASK_WORKTREE_PATH}/.dev-lifecycle-stage
# Valid values: setup, implement, design-critique, qa, review, ship, cleanup
```

This file is NOT committed — it's a transient marker for recovery. It lives in the worktree and is removed during cleanup.

#### Agent failure recovery

If an implementation agent fails (API overload, timeout, 529 errors):

1. Check git state in the worktree: `git log --oneline -5`, `git status`, `git diff --stat`
2. **Read lifecycle stage:** `cat {TASK_WORKTREE_PATH}/.dev-lifecycle-stage 2>/dev/null || echo "unknown"`. This tells you which lifecycle step the previous agent was executing when it failed.
3. Update state file with failure and last known lifecycle stage
4. Dispatch a fresh recovery agent with the RFC path, git state, last lifecycle stage, and instruction to resume from that stage (not from the beginning). Include: "Previous agent reached stage: {stage}. Resume from there. Do not re-run earlier stages."
5. Max 3 total attempts per task. After 3 failures, mark as "Failed" and continue to next.

Track retry count and last lifecycle stage per task in the state file.

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
