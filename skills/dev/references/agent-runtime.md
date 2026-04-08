# Agent Runtime Mapping

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

Within a runtime, behavior may still depend on available capabilities.

Use these booleans in planning and dispatch decisions:

```yaml
capabilities:
  delegation: true | false
  persistent_workers: true | false
  dashboard_input: true | false
```

Recommended defaults:

| Runtime | delegation | persistent_workers | dashboard_input |
|---------|------------|--------------------|-----------------|
| `claude` | true | true | false unless explicitly enabled |
| `codex` | false by default, true when delegation is allowed for the session | same as `delegation` | false unless explicitly enabled |

For additional tool/skill requirements, read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md`.

## Intent Labels

Flow docs may continue to use the existing `pm:*` labels as intent names:

- `pm:developer`
- `pm:product-manager`
- `pm:strategist`
- `pm:engineering-manager`
- `pm:ux-designer`
- `pm:product-director`
- `pm:qa-tester`
- `pm:code-reviewer`
- `pm:adversarial-engineer`
- `pm:test-engineer`
- `pm:staff-engineer`
- `pm:system-architect`
- `pm:integration-engineer`
- `pm:design-director`
- `pm:qa-lead`
- `pm:design-system-lead`
- `pm:edge-case-tester`
- `general-purpose`

These are intent labels, not a guarantee that the runtime has a built-in specialized agent for each one.

## Claude Adapter

Use Claude-native teammate mechanics when the flow needs a persistent worker.

### Persistent worker

Use:

```text
TeamCreate(...)
Agent(name=..., description=..., team_name=..., subagent_type=..., prompt=...)
SendMessage(...)
```

Rules:
- Create the team before the first persistent worker in that session
- Use a stable `name` for each resumable worker
- Use `SendMessage` to resume the same worker later
- Shut the worker down explicitly when the flow is done

### Claude critical notes

These details are required for reliable Claude execution:
- Include `description` on `Agent(...)` calls. Keep it short and concrete, usually 3-5 words.
- Before the first `TeamCreate(...)` or `SendMessage(...)` in a session, run `ToolSearch({ query: "select:TeamCreate,SendMessage" })` so Claude loads the deferred teammate tools.
- `SendMessage(...)` uses `message`, not `content`. When passing a plain string message, also include a short `summary`.
- When dispatching multiple Claude review workers in parallel, send all `Agent(...)` calls in a single assistant response so Claude actually runs them together.
- Persistent Claude workers often sit idle after planning. That is normal. Resume them with `SendMessage(...)`; do not treat idle state as failure.

### Short-lived review worker

Use:

```text
Agent(description=..., subagent_type=..., prompt=...)
```

No `team_name`. The result returns directly to the orchestrator.

## Codex Adapter

Codex supports the same workflow in two ways:

- inline execution when delegation is not enabled
- delegated execution when delegation is enabled for the session

Both are valid Codex executions.

### Codex inline execution

Use this when `capabilities.delegation = false`.

Rules:
- Run the stage in the main agent context
- Preserve continuity through the session file, plan files, spec files, and checkpoint entries
- Do not pretend that a named worker exists
- When a flow says "resume the same worker", read the prior artifact and continue inline from that state

This is the default Codex fallback. It must always be supported.

### Codex delegated execution

Use this when `capabilities.delegation = true`.

### Persistent worker

Use Codex agent tools:

```text
spawn_agent(...)
wait_agent(...)
send_input(...)
resume_agent(...)
close_agent(...)
```

Rules:
- Spawn once for the planning phase
- Save the returned `agent_id` in the session file
- Reuse the same `agent_id` for implementation
- Treat the Claude-style worker name as logical metadata only
- Resume by `agent_id`, not by name
- Close the worker explicitly when done

Recommended state shape:

```yaml
workers:
  dev-main:
    logical_name: dev-{slug}
    agent_id: "<codex-agent-id>"
    phase: planning | implementing | complete
```

### Short-lived review worker

Use `spawn_agent(...)` with the minimum context needed for that review.

Rules:
- Do not persist review workers unless the flow explicitly needs re-verification with the same worker
- Collect results with `wait_agent(...)`
- Close them when they are no longer needed

## Intent-to-Execution Mapping in Codex

Use this table when Codex is delegating work:

| Intent label | Preferred Codex execution |
|--------------|---------------------------|
| `pm:developer` | persistent `worker` agent |
| `pm:engineering-manager` | `explorer` agent |
| `pm:adversarial-engineer` | `explorer` agent |
| `pm:test-engineer` | `explorer` agent |
| `pm:staff-engineer` | `explorer` agent |
| `pm:system-architect` | `explorer` or `default` agent |
| `pm:integration-engineer` | `explorer` or `default` agent |
| `pm:design-director` | `default` agent |
| `pm:qa-lead` | `default` agent |
| `pm:product-manager` | `default` agent |
| `pm:strategist` | `default` agent |
| `pm:ux-designer` | `default` agent |
| `pm:product-director` | `default` agent |
| `pm:qa-tester` | `default` agent |
| `pm:code-reviewer` | `default` agent |
| `pm:design-system-lead` | `default` agent |
| `pm:edge-case-tester` | `default` agent |
| `general-purpose` | `default` agent |

If the runtime does not support a specialized persona, keep the intent in the prompt and use the nearest execution type above.

## How Flow Docs Should Read

Flow docs should describe the worker intent and continuity requirement, then point here for runtime execution.

Good:

```text
Dispatch a persistent developer worker for planning. Reuse the same worker for implementation.
Use the current runtime's instructions from agent-runtime.md.
```

Avoid embedding Claude-only mechanics directly in flow docs unless the section is explicitly marked "Claude example".

## Minimal Examples

### Claude persistent worker

```text
ToolSearch({ query: "select:TeamCreate,SendMessage" })
TeamCreate({ team_name: "dev-{slug}", description: "..." })
Agent({ name: "dev-{slug}", description: "Write plan", team_name: "dev-{slug}", subagent_type: "pm:developer", prompt: "..." })
SendMessage({ to: "dev-{slug}", summary: "Resume implementation", message: "Resume for implementation..." })
```

### Codex delegated persistent worker

```text
spawn_agent(agent_type="worker", ...)
# save returned agent_id to session file
wait_agent([agent_id])
send_input(target=agent_id, message="Resume for implementation...")
close_agent(target=agent_id)
```

### Codex inline fallback

```text
1. Write the RFC inline in the main context
2. Save RFC path + summary to the session file
3. After approval, continue implementation inline from the saved RFC
```
