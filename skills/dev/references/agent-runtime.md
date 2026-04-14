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
