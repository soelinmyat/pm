---
name: Implementation
order: 5
description: Dispatch fresh developer agents to implement the approved RFC
---

## Goal

Complete implementation of the approved RFC and leave the branch in a verified, reviewable state for downstream gates (Steps 06–09).

<HARD-RULE>
Step 05 **dispatches agents**. It does NOT execute implementation in the orchestrator context.

- **Multi-task (`task_count > 1`):** dispatch one fresh @developer agent per task as a **subprocess** (`scripts/dispatch-issue.sh`), sequentially. The subprocess owns the full lifecycle implement → simplify → review → ship → merge. The orchestrator coordinates — create worktree, build prompt, dispatch subprocess, read result.json, checkpoint, sync main, next. Never read the RFC and start implementing.
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
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md Steps 1–2
for setup and implementation methodology. Steps 3+ (simplify, review, ship) are
handled by the orchestrator after you return.

Lifecycle:
1. cd {WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC end-to-end and implement all issues
4. Run the project test suite — all tests must pass
5. Commit implementation changes

If blocked, report: "Blocked: {reason}"
Do NOT pause for confirmation — the RFC is the contract. Execute it.

Report when done: "Implementation complete. {N} files changed, tests passing."
```

The implementation agent does NOT own simplify, design critique, QA, review, ship, or cleanup. Those are handled by Steps 06–09.

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
**RFC:** {pm_dir}/backlog/rfcs/{slug}.html
**Your issue:** Issue {N} — {ISSUE_TITLE}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}
**Result file:** {pm_state_dir}/runs/issue-{N}/result.json

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Read the RFC. Focus on Issue {N} ({ISSUE_TITLE}) — that is your scope. The RFC also
contains shared architecture and data model sections that apply to your issue.

Lifecycle tracking: before each step, write your current stage to a tracking file:
  echo "{stage}" > .dev-lifecycle-stage
Valid stages: setup, implement, simplify, design-critique, qa, review, ship, cleanup.
This file is NOT committed — it's for recovery if you fail mid-lifecycle.

Lifecycle:
1. cd {TASK_WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC, focus on Issue {N}, implement its tasks
4. Run the project test suite — all tests must pass
5. Commit implementation changes
6. Invoke pm:simplify — fix findings, run tests, commit
7. If UI changes: invoke /design-critique if available, else skip
8. If UI changes: dispatch QA agent per implementation-flow.md
9. If SIZE is M/L/XL: invoke pm:review on the branch, fix all high-confidence findings, commit
   If SIZE is XS/S: run code scan (single reviewer per implementation-flow.md)
10. Run full test suite as final verification
11. Push branch, create PR, squash merge via merge-loop, cleanup worktree and branch
12. **Before exiting**, write the result file:
    On success:
      {"status":"merged","issue_id":"{ISSUE_ID}","pr":<N>,"merge_sha":"<sha>","files_changed":<N>}
    On block:
      {"status":"blocked","issue_id":"{ISSUE_ID}","reason":"<one-line reason>"}

Do NOT pause for confirmation — the RFC is the contract. Execute it.
Do NOT exit before writing the result file. The orchestrator reads it to advance the plan.
```

4. **Dispatch as subprocess in the background.** Per-issue subprocesses run for hours (CI watches, multi-round review fixes). Synchronous Bash invocations will hit the harness timeout (Bash tool sync max is ~10 min in Claude Code) and kill the subprocess prematurely. Always background-dispatch.

   **Claude runtime:**
   ```text
   Bash(
     command: "bash ${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh \\
       --runtime claude \\
       --worktree {TASK_WORKTREE_PATH} \\
       --prompt-file {pm_state_dir}/runs/issue-{N}/prompt.txt \\
       --result-file {pm_state_dir}/runs/issue-{N}/result.json \\
       --log-file {pm_state_dir}/runs/issue-{N}/log.txt",
     run_in_background: true
   )
   ```
   Returns a shell ID immediately. The subprocess runs uninterrupted in user context.

   **Codex runtime:** detach the process via shell (`nohup ... &` or equivalent) and capture the PID. Same `dispatch-issue.sh` invocation, just `--runtime codex`.

5. **Wait for the result file to appear** without burning context on active polling.

   **Claude runtime:** use `Monitor` with an until-loop watching for the result file:
   ```text
   Monitor(
     command: "until [ -f {pm_state_dir}/runs/issue-{N}/result.json ]; do sleep 30; done"
   )
   ```
   The harness fires a notification when the loop exits. No active polling, no orchestrator-context burn during the long wait.

   **Codex runtime / fallback:** check periodically using a low-frequency shell loop the runtime allows (e.g., a 30-second sleep cadence inside an `until` block). The same condition — result file existence — terminates the wait.

   The wait can take minutes to hours. That is expected. Do NOT add a hard timeout; the subprocess decides completion by writing the result file or escalating via Blocked.

6. **Read result and interpret:**

   ```bash
   STATUS=$(jq -r '.status' "{pm_state_dir}/runs/issue-{N}/result.json")
   case "$STATUS" in
     merged)  PR=$(jq -r '.pr' ...); SHA=$(jq -r '.merge_sha' ...); ;;
     blocked) REASON=$(jq -r '.reason' ...); halt-and-escalate ;;
     *)       treat as crashed; surface log to user ;;
   esac
   ```

   If the background dispatch process exited but no result file exists (subprocess crashed before writing), treat as blocked with reason `"subprocess crashed — see {log-file}"`. Detect this by checking whether the background shell ID is still alive when the Monitor loop times out, OR by adding an OR-clause to the wait: `until [ -f result.json ] || ! kill -0 $DISPATCH_PID 2>/dev/null; do sleep 30; done`.

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
# Valid values: setup, implement, simplify, design-critique, qa, review, ship, cleanup
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
  → subprocess: implements → simplify → design critique → QA → review → merge → cleanup
  → subprocess writes .pm/runs/issue-{N}/result.json (status: merged | blocked) and exits
  → orchestrator reads result.json, checkpoints, syncs main, dispatches next

Orchestrator runs Step 09 (retro) once after all tasks complete.
```

## Done-when

**Single-task:** Code and tests committed on the feature branch, test suite passes, session file updated. Implementation agent has returned — orchestrator proceeds to Step 06.

**Multi-task:** All per-task subprocesses have written `result.json` with `status: merged` or `status: blocked`. Each task's branch is merged (or marked failed) and its worktree cleaned up. Session file `## Tasks` table reflects final status. Orchestrator proceeds to Step 09 (retro) — Steps 06–08 are skipped since per-task subprocesses handled them.
