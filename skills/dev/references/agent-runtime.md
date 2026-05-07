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

Flow docs use `@persona` references to indicate which persona perspective to apply. There are 7 personas:

- `@developer` — implementation, debugging, TDD
- `@staff-engineer` — architecture, code review, maintainability, integration
- `@adversarial-engineer` — risk assessment, attack surface analysis
- `@tester` — QA, edge cases, test coverage, assertion-driven testing
- `@designer` — UX review, design system compliance, visual quality
- `@product-manager` — scope validation, JTBD clarity, outcome coverage
- `@strategist` — competitive intelligence, positioning, differentiation

These are intent labels, not a guarantee that the runtime has a built-in specialized agent for each one. The persona file content (from `${CLAUDE_PLUGIN_ROOT}/personas/`) is injected into agent prompts via the step loader.

## Claude Adapter

All dispatches use fresh, short-lived agents:

```text
Agent(description=..., prompt=...)
```

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
| `claude` | `claude -p --dangerously-skip-permissions` (reads prompt from stdin) |
| `codex`  | `codex exec --full-auto -C <worktree> -` (reads prompt from stdin) |

The orchestrator dispatches via `${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh`, which abstracts the runtime. The agent writes its final structured result to a JSON file the orchestrator reads after the subprocess exits.

### Result contract

Every subprocess agent MUST write `<result-file>` before exiting. Schema:

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

Orchestrator handling:
- `status=merged` + `pr` + `merge_sha` → success, advance plan
- `status=blocked` + `reason` → halt epic, surface to user
- Result file missing → subprocess crashed; treat as blocked with crash reason from the log

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

**Step 2 — wait for result file via notification:**

Claude runtime (preferred — no orchestrator-context burn during the wait):
```text
Monitor(
  command: "until [ -f .pm/runs/issue-$N/result.json ] || ! kill -0 $DISPATCH_PID 2>/dev/null; do sleep 30; done"
)
```

The OR-clause catches subprocess crashes (process exited without writing the result file). Notification fires when either condition becomes true.

Codex runtime / fallback: same `until` loop in a foreground shell at the runtime's allowed cadence.

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
# Build the per-issue prompt (orchestrator)
cat > .pm/runs/issue-1/prompt.txt <<EOF
Implement and ship PM-145 Issue 1.
RFC: pm/backlog/rfcs/qr-download-unified.html
Worktree: .worktrees/qr-issue-1
Branch: feat/qr-issue-1

Read \${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full lifecycle.
Own everything from impl through merged PR. Do NOT exit until merged or blocked.

Before exiting, write .pm/runs/issue-1/result.json with the schema in agent-runtime.md.
EOF

# Dispatch (orchestrator)
bash \${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-issue.sh \
  --runtime claude \
  --worktree .worktrees/qr-issue-1 \
  --prompt-file .pm/runs/issue-1/prompt.txt \
  --result-file .pm/runs/issue-1/result.json

# Read result (orchestrator)
jq -r '.status' .pm/runs/issue-1/result.json
```
