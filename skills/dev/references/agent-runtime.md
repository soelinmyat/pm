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

Persona bodies live at `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` — a single source that both registers as callable `pm:<name>` plugin agents AND is injected inline as `@name` prompts via the step loader when the runtime can't dispatch to a plugin agent. User overrides live at `.pm/personas/<name>.md`.

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

**Model and billing (canonical — other docs point here).** The `claude` subprocess pins `--model opus`: a spawned subprocess does not inherit the orchestrator's model, so without `--model` it resolves the config default (often Sonnet) and silently downgrades implementation quality. The `opus` alias resolves to whatever Opus the account/provider maps it to — the pin is a cost/latency choice, not a claim to the single most capable model available.

Subprocess dispatch uses the account's normal model and subscription: `claude -p` draws from the account's usual Claude usage limits, so dispatch is **not** gated by `PM_ALLOW_SUBPROCESS` — the approved RFC is the execution consent. `dispatch-issue.sh` starts the subprocess directly and detects usage-limit, quota, and rate-limit stops in the subprocess log, emitting a structured `blocked` result instead of an opaque crash.

The orchestrator dispatches via `scripts/dispatch-issue.sh`, using `PM_PLUGIN_ROOT` as the runtime-neutral plugin root and `CLAUDE_PLUGIN_ROOT` as a legacy fallback alias. The script abstracts the runtime. The agent writes its final structured result to a JSON file the orchestrator reads after the subprocess exits.

### Placeholder resolution

`prompt.txt` may carry three `${...}` placeholders that the subprocess cannot resolve on its own — it has no plugin-root env var, and a relative path written from inside the worktree resolves differently than the orchestrator expects. `dispatch-issue.sh` rewrites them to absolute paths before the subprocess runs:

| Placeholder | Resolved to |
|-------------|-------------|
| `${PM_PLUGIN_ROOT}` | the plugin root, derived from the dispatcher's own location |
| `${CLAUDE_PLUGIN_ROOT}` | the same plugin root, kept for legacy prompts |
| `${RESULT_FILE}` | the absolute form of the `--result-file` argument |

Write these placeholders **literally** into `prompt.txt` — do not hand-expand them, and do not escape them away. The dispatcher is the single source of truth.

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

Subprocesses run for hours. Synchronous Bash calls hit harness timeouts (Claude's Bash tool sync max ≈ 10 min) and would kill the subprocess prematurely. **Always background-dispatch, then wait with the crash-safe helper `scripts/dispatch-wait.sh`.**

**Step 1 — background dispatch:**

Claude runtime:
```text
Bash(
  command: "PM_PLUGIN_ROOT=\"${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}\"; bash \"$PM_PLUGIN_ROOT/scripts/dispatch-issue.sh\" \\
    --runtime claude \\
    --worktree $WORKTREE_PATH \\
    --prompt-file .pm/runs/issue-$N/prompt.txt \\
    --result-file .pm/runs/issue-$N/result.json \\
    --log-file    .pm/runs/issue-$N/log.txt",
  run_in_background: true
)
```

Codex runtime: detach via shell (`nohup ... &`, capture PID) — same `dispatch-issue.sh` call with `--runtime codex`.

**Step 2 — wait via the crash-safe helper `scripts/dispatch-wait.sh`:**

The wait loop is a tested script, not hand-copied shell. `dispatch-wait.sh` runs the poll — `kill -0 $(cat dispatch.pid)` liveness OR-ed with the result-file read — inside a hard **900s ceiling per invocation**, and prints **exactly one JSON line**. It reads the pid/result contract that `dispatch-issue.sh` owns (result file plus the sibling `dispatch.pid`); it never writes `result.json` and never touches the EXIT trap.

The orchestrator's only job is to invoke it and branch on `.state`:

| Helper output | Meaning | Orchestrator action |
|---|---|---|
| `state=done` | `result.json` is exactly one valid JSON doc; `.result` carries it | Parse `.result` — advance on `status=merged`, halt + surface `reason` on `status=blocked` |
| `state=crashed` | dispatcher PID dead with no result (SIGKILL bypassed the EXIT trap), never started, recycled to an unrelated PID, or an unparseable result | Halt epic and escalate — point at `log.txt` |
| `state=running` | 900s elapsed, subprocess still alive | Re-invoke the exact same helper call — this is the heartbeat |
| output missing or unparseable (no JSON line) | the helper itself failed to print a verdict — should not happen | Treat as `crashed` — halt and escalate |
| `done` but `.result.status` ∉ {`merged`, `blocked`} | subprocess wrote an out-of-contract status | Treat as `blocked` — halt and surface the raw result |

Claude runtime — run the helper under Monitor so the ≤900s wait survives the Bash sync timeout:
```text
Monitor(
  command: "PM_PLUGIN_ROOT=\"${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}\"; bash \"$PM_PLUGIN_ROOT/scripts/dispatch-wait.sh\" --result-file .pm/runs/issue-$N/result.json"
)
```

<HARD-RULE>
After every helper return, read `.state` and branch on it BEFORE doing anything else. `running` is the **only** state that re-invokes — never reflexively re-fire the helper without first reading `.state`. Re-firing on `done`/`crashed` (or without looking) burns a full ceiling and learns nothing. The sentinel moved from a grepped string to a JSON field, but the model failure it guards — mentally tagging the wait as a fire-and-forget "wait" primitive and re-firing on reflex — did not go away with it.
</HARD-RULE>

`done` and `crashed` are terminal for the wait. A 3-hour subprocess produces ~12 `running` returns before terminating in `done` or `crashed` — bounded and predictable, vs. unbounded idle wedging on a dropped notification. On `done`, `.result` already holds the parsed `result.json` (schema above) — there is no separate read step.

Codex runtime / fallback: run the same `dispatch-wait.sh` invocation in a foreground shell and branch on `.state`.

The orchestrator builds the prompt (per-issue brief: RFC path, issue scope, lifecycle instructions, **including the path the agent must write `result.json` to**), writes it to `prompt.txt`, background-dispatches via Bash, then waits via `dispatch-wait.sh` and branches on `.state`. Full transcript stays in `log.txt` for inspection.

### When to use subprocess dispatch

- Multi-task implementation: each task owns implement → review → ship → merge
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
# ${PM_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_ROOT}, and ${RESULT_FILE} land literally —
# dispatch-issue.sh resolves them to absolute paths before the subprocess runs.
cat > .pm/runs/issue-1/prompt.txt <<'EOF'
Implement and ship PM-145 Issue 1.
RFC: pm/backlog/rfcs/qr-download-unified.html
Worktree: .worktrees/qr-issue-1
Branch: feat/qr-issue-1

Read ${PM_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full lifecycle.
Own everything from impl through merged PR. Do NOT exit until merged or blocked.

Before exiting, write your result JSON: write ${RESULT_FILE}.tmp then mv it onto
${RESULT_FILE} (atomic — the orchestrator's wait must never read a half-written file).
Schema in agent-runtime.md.
EOF

PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"

# Dispatch in the BACKGROUND — subprocesses run for hours, so a synchronous call
# would hit the Bash sync timeout and kill the subprocess.
# (Claude runtime: Bash(..., run_in_background: true).)
bash "$PM_PLUGIN_ROOT/scripts/dispatch-issue.sh" \
  --runtime claude \
  --worktree .worktrees/qr-issue-1 \
  --prompt-file .pm/runs/issue-1/prompt.txt \
  --result-file .pm/runs/issue-1/result.json &

# Wait via the crash-safe helper and branch on .state — never read result.json
# directly; the helper validates it and classifies done/crashed/running.
# (Claude runtime: run each dispatch-wait call under Monitor so the ≤900s wait
# survives the Bash sync timeout.)
while :; do
  verdict="$(bash "$PM_PLUGIN_ROOT/scripts/dispatch-wait.sh" \
    --result-file .pm/runs/issue-1/result.json)"
  case "$(printf '%s' "$verdict" | jq -r '.state')" in
    running) continue ;;                                    # heartbeat — re-invoke
    done)    printf '%s' "$verdict" | jq '.result'; break ;; # parse .result, advance
    crashed) echo "subprocess crashed — halt, see log"; break ;;
  esac
done
```
