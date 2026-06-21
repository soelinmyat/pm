# Persona Runtime Mapping

This reference defines how to execute the PM workflow in the two supported runtimes:

- `claude`
- `codex`

The workflow stays the same. Only the execution mechanics change.

## Runtime Selection

Every stateful PM session should record:

```yaml
runtime: claude | codex
```

Set it when the session file is first created. Reuse the same runtime for the entire session.

If the runtime is not yet recorded:
- Use `claude` when the session is running in Claude Code
- Use `codex` when the session is running in Codex

Do not switch runtimes mid-session unless the user explicitly starts over.

## Capability Flags

```yaml
capabilities:
  delegation: true | false
```

| Runtime | delegation |
|---------|------------|
| `claude` | true |
| `codex` | false by default, true when delegation is allowed for the session |

For additional tool/skill requirements, read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md`.

## Persona Intent Labels

Flow docs use `@persona` references to indicate which persona perspective to apply. There are 7 personas — each is **both** a `@name` label inlined into prompts AND a callable plugin agent registered as `pm:<name>`:

| Persona | Plugin agent | Focus |
|---|---|---|
| `@developer` | `pm:developer` | implementation, debugging, TDD |
| `@staff-engineer` | `pm:staff-engineer` | architecture, code review, maintainability, integration |
| `@adversarial-engineer` | `pm:adversarial-engineer` | risk assessment, attack surface analysis |
| `@tester` | `pm:tester` | QA, edge cases, test coverage, assertion-driven testing |
| `@designer` | `pm:designer` | UX review, design system compliance, visual quality |
| `@product-manager` | `pm:product-manager` | scope validation, JTBD clarity, outcome coverage |
| `@strategist` | `pm:strategist` | competitive intelligence, positioning, differentiation |

Plugin agent bodies live at `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`. Reference docs (longer guidance and methodology) live at `${CLAUDE_PLUGIN_ROOT}/personas/<name>.md` and are injected into prompts via the step loader when the runtime can't dispatch to a plugin agent.

## Claude Adapter

All dispatches use fresh, short-lived agents:

```text
Agent(description=..., subagent_type=..., prompt=...)
```

**Pick `subagent_type` by intent:**

| Intent | `subagent_type` |
|---|---|
| Persona-led review or work matching one of the 7 personas | `pm:<persona>` (e.g. `pm:strategist`, `pm:adversarial-engineer`) |
| Code search / file location | `Explore` |
| Generic task with no matching persona | `general-purpose` |

Prefer `pm:*` whenever the task maps to a persona — telemetry shows specialized agents finish 2-5× faster than `general-purpose` for the same review work. Reserve `general-purpose` for tasks that don't fit any persona.

When `subagent_type: pm:<persona>` is used, the agent's system message already establishes the persona — the prompt should focus on the task, scope, and inputs. Do not also inline the `@<persona>` body.

No `team_name`. The result returns directly to the orchestrator.

When dispatching multiple review agents in parallel, send all `Agent(...)` calls in a single assistant response so Claude runs them together.

## Codex Adapter

### Codex inline execution

Use this when `capabilities.delegation = false`.

Rules:
- Run the stage in the main agent context
- Preserve continuity through the session file, plan files, spec files, and checkpoint entries

This is the default Codex fallback. It must always be supported.

### Codex delegated execution

Use this when `capabilities.delegation = true`.

Use `spawn_agent(...)` for each dispatch. Collect results with `wait_agent(...)`.
Each agent is short-lived — no agent reuse across phases.

## Subprocess Dispatch

Use this when an agent must own a long, multi-stage lifecycle without bailing back to the orchestrator — e.g., implement-through-merge for one issue, where the work spans CI watches and multi-round review-comment loops.

In-process dispatch (`Agent(...)` / `spawn_agent(...)`) inherits implicit "return promptly to parent" pressure. On work that takes hours and waits on external systems (CI, human review), sub-agents tend to return after creating the PR and dump the merge-loop work onto the orchestrator. A subprocess is a top-level run with no parent — it must complete the lifecycle or escalate explicitly via the result file before exiting.

Both runtimes support this via their non-interactive CLI:

| Runtime | Command |
|---------|---------|
| `claude` | `claude -p --model opus --dangerously-skip-permissions` (reads prompt from stdin) |
| `codex`  | `codex exec --full-auto -C <worktree> -` (reads prompt from stdin) |

**Model pinning:** the `claude` subprocess pins `--model opus`. A spawned subprocess does not inherit the orchestrator's model selection — without `--model` it resolves the config default (often Sonnet), silently downgrading implementation quality. The `opus` alias tracks the latest Opus **only on the direct Anthropic API** (Opus 4.8 as of mid-2026); on Bedrock/Vertex/Foundry it pins an older Opus, and on Claude-on-AWS it pins 4.7. Opus 4.8 is also no longer the single most capable model (Fable 5 sits above it), so this pin is a deliberate cost/latency choice, not "the strongest model available."

**Claude subscription behavior.** Anthropic paused the previously announced 2026-06-15 Agent SDK credit split. For now, Claude Agent SDK usage, `claude -p`, and third-party Agent SDK app usage still draw from the user's normal Claude subscription usage limits; the separate monthly Agent SDK credit is not active. On an API key, pay-as-you-go billing continues as before.

Because the separate credit is paused, subprocess dispatch is **not** gated by `PM_ALLOW_SUBPROCESS`. `dispatch-issue.sh` starts the Claude subprocess directly. The dispatcher still detects normal usage-limit, usage-credit, quota, and rate-limit rejections in the subprocess log and emits a clear `blocked` result instead of an opaque crash.

The orchestrator dispatches via `${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh`, which abstracts the runtime. The agent writes its final structured result to a JSON file the orchestrator reads after the subprocess exits.

### Placeholder resolution

`prompt.txt` may carry two `${...}` placeholders that the subprocess cannot resolve on its own — it has no `CLAUDE_PLUGIN_ROOT` env var, and a relative path written from inside the worktree resolves differently than the orchestrator expects. `dispatch-issue.sh` rewrites both to absolute paths before the subprocess runs:

| Placeholder | Resolved to |
|-------------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | the plugin root, derived from the dispatcher's own location |
| `${RESULT_FILE}` | the absolute form of the `--result-file` argument |

Write these two placeholders **literally** into `prompt.txt` — do not hand-expand them, and do not escape them away. The dispatcher is the single source of truth.

### Result contract

Every subprocess agent MUST write its result file — referenced in the prompt as `${RESULT_FILE}` — before exiting. Schema:

```json
{
  "status": "merged",
  "issue_id": "PM-145.1",
  "pr": 1067,
  "merge_sha": "abc123def456",
  "files_changed": 31
}
```

Or, when escalating:

```json
{
  "status": "blocked",
  "issue_id": "PM-145.1",
  "reason": "CI lint failure recurred after 3 fix attempts on src/foo.ts:42"
}
```

**Crash-safety:** `dispatch-issue.sh` registers an EXIT trap that leaves a stub blocked result behind if the agent exits without writing one (covers normal exit codes, SIGTERM, SIGINT). It also writes `dispatch.pid` next to `result.json` so the orchestrator can detect SIGKILL (which bypasses traps) via a liveness check in its wait loop. Either way the orchestrator's `until [ -f result.json ]` style wait terminates.

Orchestrator handling:
- `status=merged` + `pr` + `merge_sha` → success, advance plan
- `status=blocked` + `reason` → halt epic, surface to user
- Result file missing AND dispatcher PID dead → subprocess crashed (SIGKILL); treat as blocked with crash reason from the log

### Dispatch shape

Subprocesses run for hours. Synchronous Bash calls hit harness timeouts (Claude's Bash tool sync max ≈ 10 min) and would kill the subprocess prematurely. **Always background-dispatch and wait via notification on the result file.**

**Step 1 — background dispatch:**

Claude runtime:
```text
Bash(
  command: "bash ${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh \\
    --runtime claude \\
    --worktree $WORKTREE_PATH \\
    --prompt-file .pm/runs/issue-$N/prompt.txt \\
    --result-file .pm/runs/issue-$N/result.json \\
    --log-file    .pm/runs/issue-$N/log.txt",
  run_in_background: true
)
```

Codex runtime: detach via shell (`nohup ... &`, capture PID) — same `dispatch-issue.sh` call with `--runtime codex`.

**Step 2 — wait via a bounded heartbeat with a forced state sentinel:**

The Claude Code harness does not guarantee Monitor notifications fire on long runs — `claude -p` subprocesses span hours and Monitor has been observed to silently stall. Cap each Monitor invocation at 900s. The Monitor command itself prints a `DISPATCH_STATE=` sentinel on its final stdout line — that sentinel is the orchestrator's branch instruction for the next turn.

Claude runtime:
```text
Monitor(
  command: "PID_FILE=.pm/runs/issue-$N/dispatch.pid; RESULT=.pm/runs/issue-$N/result.json; end=$(($(date +%s) + 900)); until [ -f \"$RESULT\" ] || { [ -f \"$PID_FILE\" ] && ! kill -0 \"$(cat \"$PID_FILE\")\" 2>/dev/null; } || [ $(date +%s) -ge $end ]; do sleep 30; done; if [ -f \"$RESULT\" ]; then echo DISPATCH_STATE=done; cat \"$RESULT\"; elif [ -f \"$PID_FILE\" ] && ! kill -0 \"$(cat \"$PID_FILE\")\" 2>/dev/null; then echo DISPATCH_STATE=crashed; else echo DISPATCH_STATE=tick; fi"
)
```

Monitor's final stdout line is one of:
- `DISPATCH_STATE=done` (followed by result.json contents) → parse status, advance on `merged`, halt on `blocked`
- `DISPATCH_STATE=crashed` → dispatcher PID dead with no result file (SIGKILL bypassed EXIT trap); halt and escalate
- `DISPATCH_STATE=tick` → 900s elapsed, subprocess still running; re-arm the same Monitor command

**Critical orchestrator discipline:** after every Monitor return, the orchestrator MUST locate the `DISPATCH_STATE=` sentinel and branch on it BEFORE any other action. Re-firing Monitor without reading the sentinel — the natural failure mode if Monitor is mentally tagged as a "wait" primitive — burns 15 min per tick and learns nothing. The sentinel exists precisely because pseudocode like `if file_exists then advance else re-arm` is too easily skipped by an orchestrator under context pressure.

A 3-hour subprocess produces ~12 ticks; each is a cheap state check. Bounded and predictable, vs. unbounded idle wedging on a dropped notification.

Codex runtime / fallback: same command in a foreground shell.

**Step 3 — read result:**

```bash
[ -f .pm/runs/issue-$N/result.json ] || {
  echo "Subprocess crashed without result; treat as blocked"; exit 1;
}
jq -r '.status' .pm/runs/issue-$N/result.json
```

The orchestrator builds the prompt (per-issue brief: RFC path, issue scope, lifecycle instructions, **including the path the agent must write `result.json` to**), writes it to `prompt.txt`, background-dispatches via Bash, waits via Monitor, and reads `result.json`. Full transcript stays in `log.txt` for inspection.

### When to use subprocess dispatch

- Multi-task implementation: each task owns implement → simplify → review → ship → merge
- Single tasks expected to run >30 min wall time (CI-heavy, multi-round review fixes)
- Any phase that includes long waits on external systems

### When NOT to use subprocess dispatch

- Short orchestrator-owned stages (intake, workspace setup, retro)
- Parallel review fan-out (multiple reviewers at once) — use in-process Agent / spawn_agent for that
- Single-task XS/S work that fits cleanly in one short agent return

## How Flow Docs Should Read

Flow docs should describe the persona intent and dispatch, then point here for runtime execution.

Good:

```text
Dispatch a fresh @developer agent to write the RFC. After approval, dispatch a fresh @developer agent for implementation with the RFC as input.
Use the current runtime's instructions from agent-runtime.md.
```

## Minimal Examples

### Claude agent dispatch

```text
Agent(description="Write RFC for {slug}", prompt="You are a @developer. ...")
```

### Codex delegated agent dispatch

```text
spawn_agent(agent_type="worker", ...)
wait_agent([agent_id])
```

### Codex inline fallback

```text
1. Write the RFC inline in the main context
2. Save RFC path + summary to the session file
3. After approval, continue implementation inline from the saved RFC
```

### Subprocess dispatch (runtime-agnostic)

```bash
# Build the per-issue prompt (orchestrator). The heredoc is single-quoted so
# ${CLAUDE_PLUGIN_ROOT} and ${RESULT_FILE} land literally — dispatch-issue.sh
# resolves them to absolute paths before the subprocess runs.
cat > .pm/runs/issue-1/prompt.txt <<'EOF'
Implement and ship PM-145 Issue 1.
RFC: pm/backlog/rfcs/qr-download-unified.html
Worktree: .worktrees/qr-issue-1
Branch: feat/qr-issue-1

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full lifecycle.
Own everything from impl through merged PR. Do NOT exit until merged or blocked.

Before exiting, write your result JSON to ${RESULT_FILE} (schema in agent-runtime.md).
EOF

# Dispatch (orchestrator). Claude paused the separate Agent SDK credit split,
# so `claude -p` currently draws from normal subscription usage limits.
bash \${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh \
  --runtime claude \
  --worktree .worktrees/qr-issue-1 \
  --prompt-file .pm/runs/issue-1/prompt.txt \
  --result-file .pm/runs/issue-1/result.json

# Read result (orchestrator)
jq -r '.status' .pm/runs/issue-1/result.json
```
