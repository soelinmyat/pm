# Multi-task dispatch (task_count > 1)

Loaded by Step 05 (`skills/dev/steps/05-implementation.md`) **only** when `task_count > 1`. Sequential implementation, one task at a time. Each task gets a fresh @developer agent in its own worktree, dispatched as a **subprocess** (`scripts/dispatch-issue.sh`) that owns the full lifecycle implement → design-critique → QA → review → ship → merge. The orchestrator coordinates: create worktree, build prompt, background-dispatch, wait via `scripts/dispatch-wait.sh`, checkpoint, sync main, next.

See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` § Subprocess Dispatch for the dispatch/wait machinery — the pid/result contract, placeholder resolution, and the `dispatch-wait.sh` branch table are defined canonically there.

**Non-interactive discipline.** This runs under Step 05's Continuous Execution HARD-RULE: once the RFC is approved, the orchestrator proceeds through every task without pausing for user input — no "Ready to execute?" prompts, no confirmation dialogs, no options menus. Never pause for confirmation, never treat silence as approval, never skip a gate to avoid asking. The only stops are the ones Step 05 enumerates that apply here (test failures unresolved after 3 attempts, QA verdict **Blocked**, or a per-task subprocess that returns `blocked`) — Step 08-class stops (merge conflicts, CI failures, human review feedback) are handled inside each subprocess, not by the orchestrator. In headless Loop Worker Mode there is no user at all — take the documented default when one exists and it is safe, otherwise park the card as needs-human.

## Environment readiness check

Before dispatching the first implementation agent, check whether any task touches mobile code (React Native/Expo). If so, ensure Metro is running:

```bash
# Only needed when tasks include mobile changes
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)
sleep 3
```

Skip if no task touches mobile code. Log in the state file whether Metro was started.

## Skip fully-implemented tasks

If the RFC reported 0 tasks for a sub-issue (all ACs already implemented with tests), mark it as "Already implemented" in the state file and skip to the next one.

## Claude subscription usage note

Each task spawns a background `claude -p` subprocess that draws from the account's normal Claude usage limits — see `dev/references/agent-runtime.md` § Subprocess Dispatch (Model and billing) for the canonical statement. Do not pause for a subprocess cost opt-in and do not require `PM_ALLOW_SUBPROCESS`: the approved RFC is the execution consent. If a subprocess hits a usage, quota, or rate limit, `dispatch-issue.sh` writes a `blocked` result and the orchestrator follows the branch table below.

## Sequential execution

For each task (Issue section) in dependency order from the RFC:

1. **Create worktree:**
   ```bash
   git worktree add .worktrees/{task-slug} -b feat/{task-slug} origin/{DEFAULT_BRANCH}
   ```
   Then prime it with the loop bootstrap helper — copies gitignored-but-required env/spec files and runs `worker.bootstrap_command`, reusing the same `pm/loop/config.json` keys as the loop worker (a silent no-op when the repo has no loop config):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/worktree-bootstrap.js \
     --git-root "$(git rev-parse --show-toplevel)" \
     --worktree "$(git rev-parse --show-toplevel)/.worktrees/{task-slug}" \
     --pm-dir {pm_dir}
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
14. **Before exiting**, write your structured result to ${RESULT_FILE}. Write it
    atomically — write ${RESULT_FILE}.tmp then `mv` it onto ${RESULT_FILE} — so the
    orchestrator's wait never reads a half-written file:
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
   Returns a shell ID immediately. The subprocess runs uninterrupted in user context. If Claude reports a usage, quota, or rate-limit stop, the dispatcher writes a blocked result for the orchestrator to surface.

   Immediately record the dispatch time — crash reconciliation uses it to reject a stale (pre-dispatch) merge of a reused slug:
   ```bash
   date -u +%Y-%m-%dT%H:%M:%SZ > {pm_state_dir}/runs/issue-{N}/dispatched-at
   ```

   **Codex runtime:** detach the process via shell (`nohup ... &` or equivalent) and capture the PID. Same `dispatch-issue.sh` invocation, just `--runtime codex`.

5. **Wait via `scripts/dispatch-wait.sh`.** The wait can take hours. Do NOT hand-roll the poll loop — the tested helper runs it (`kill -0 $(cat dispatch.pid)` liveness + result-file read) under a hard **900s ceiling per invocation** and prints exactly one JSON line. See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` § Subprocess Dispatch for the machinery.

   **Claude runtime** — run the helper under Monitor so the ≤900s wait survives the Bash sync timeout:
   ```text
   Monitor(
     command: "PM_PLUGIN_ROOT=\"${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}\"; bash \"$PM_PLUGIN_ROOT/scripts/dispatch-wait.sh\" --result-file {pm_state_dir}/runs/issue-{N}/result.json"
   )
   ```

   **Codex runtime / fallback:** same `dispatch-wait.sh` invocation in a foreground shell.

6. **Branch on `.state` BEFORE anything else.** Read the single JSON line the helper printed and execute exactly one row of the contract. Never reflexively re-invoke the helper without first reading `.state` — `running` is the only state that re-invokes; re-firing on `done`/`crashed` (or without looking) burns a full ceiling and learns nothing (see `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` § Subprocess Dispatch HARD-RULE).

   | Helper output | Next action |
   |---|---|
   | `state=done` | `.result` carries the parsed `result.json`. On `status=merged`: checkpoint, sync main, advance to next task. On `status=blocked`: halt epic, surface `reason` to user. |
   | `state=crashed` | **Reconcile with GitHub before halting** (see "Crash reconciliation" below): if the task's PR already merged, treat as done and advance; otherwise halt epic and escalate: "subprocess crashed without a valid result — see `{log-file}`". |
   | `state=running` | Re-invoke the exact same helper call. The heartbeat is uncapped — a 6-hour subprocess ≈ 24 re-invocations, all expected. |
   | output missing or unparseable (no JSON line) | Treat as `crashed` — halt and escalate. |
   | `done` but `.result.status` ∉ {`merged`, `blocked`} | Treat as `blocked` — halt, surface the raw result. |

   `running` is the **only** state that re-invokes; `done` and `crashed` are terminal for the wait. Each per-task subprocess owns the full lifecycle for its task — implement through merge — without bailing to the orchestrator. The orchestrator's role is reduced to: build prompt, background-dispatch, wait via the helper, branch, advance plan.

   **Crash reconciliation (GitHub state).** A `crashed` state means the subprocess exited without a valid `result.json` — but the work may already be merged (an agent can complete the PR and then die before writing its result). Do **not** trust `state=MERGED` alone: `gh pr view <branch>` resolves by head-ref *name*, so a reused slug can surface a PRIOR PR that was squash-merged and its branch deleted. Run the reconciliation gate, which advances only when the merge is provably **this** task's work — merged strictly after dispatch **and** the merged PR's head OID equals this worktree's HEAD:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/pr-state.js reconcile \
     --branch feat/{task-slug} \
     --worktree {TASK_WORKTREE_PATH} \
     --dispatched-at "$(cat {pm_state_dir}/runs/issue-{N}/dispatched-at)"
   ```

   It prints a JSON decision (with retry on transient 5xx / gateway / timeout built in):

   - `{"advance":true,"prNumber":N,…}` → the task is actually **done**. Synthesize the missing result — write `{pm_state_dir}/runs/issue-{N}/result.json` as `{"status":"merged","issue_id":"{ISSUE_ID}","pr":N}` using the returned `prNumber` (so the later event-extraction `gh pr view {PR_NUMBER}` resolves) — then checkpoint the task complete, sync main, and advance to the next task, exactly as the `status=merged` row does.
   - `{"advance":false,"reason":…}` (not merged, merge predates dispatch, head-OID mismatch, or GitHub unreachable) → **halt the epic** and escalate as before. Never advance on a non-`advance` result — `UNKNOWN`/unreachable is never merged.

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

## Per-task lifecycle tracking

Each per-task agent must track its lifecycle progress so recovery agents know where to resume. Before starting each lifecycle step, the agent writes its current stage to a tracking file in the worktree:

```bash
echo "{stage}" > {TASK_WORKTREE_PATH}/.dev-lifecycle-stage
# Valid values: setup, implement, design-critique, qa, review, ship, cleanup
```

This file is NOT committed — it's a transient marker for recovery. It lives in the worktree and is removed during cleanup.

## Agent failure recovery

If an implementation agent fails (API overload, timeout, 529 errors):

1. Check git state in the worktree: `git log --oneline -5`, `git status`, `git diff --stat`
2. **Read lifecycle stage:** `cat {TASK_WORKTREE_PATH}/.dev-lifecycle-stage 2>/dev/null || echo "unknown"`. This tells you which lifecycle step the previous agent was executing when it failed.
3. Update state file with failure and last known lifecycle stage
4. Dispatch a fresh recovery agent with the RFC path, git state, last lifecycle stage, and instruction to resume from that stage (not from the beginning). Include: "Previous agent reached stage: {stage}. Resume from there. Do not re-run earlier stages."
5. Max 3 total attempts per task. After 3 failures, mark as "Failed" and continue to next.

Track retry count and last lifecycle stage per task in the state file.

When every task is merged, control returns to Step 05, which proceeds to Step 09 (retro) — Steps 07–08 are handled inside each subprocess.
