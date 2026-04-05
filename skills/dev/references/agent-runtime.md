# Agent Runtime Mapping

This reference defines how to interpret the `Agent()`, `SendMessage()`, and `TeamCreate()` pseudo-code used throughout dev skill flow files. The pseudo-code is agent-agnostic. Each runtime maps it to its own tool surface.

## Pseudo-code Format

```
TeamCreate({
  team_name: "dev-{slug}",               // Creates persistent team for agent lifecycle
  description: "Dev session for {ISSUE_ID}"
})
```

```
Agent({
  description: "Short task summary",     // REQUIRED for Claude Code
  name: "dev-{slug}",                    // Makes agent addressable for resume
  team_name: "dev-{slug}",              // Joins the team (persistent lifecycle)
  subagent_type: "pm:developer",         // Specialized agent type
  prompt: "..."                          // Task instructions
})
```

```
SendMessage({
  to: "dev-{slug}",                      // Teammate name (NOT agentId)
  content: "..."                          // Resume instructions
})
```

## Runtime Mapping

| Pseudo-code | Claude Code | Codex |
|-------------|------------|-------|
| `TeamCreate({ team_name, description })` | **TeamCreate tool**. Creates team + task list. Required before spawning persistent agents. | N/A (implicit) |
| `Agent({ description, name, team_name, subagent_type, prompt })` | **Agent tool** with all 5 params. Agent joins team as teammate. Goes **idle** (not terminated) after returning. | `spawn_agent` |
| `Agent({ description, subagent_type, prompt })` (no name/team) | **Agent tool** without `name`/`team_name`. Short-lived sub-agent, result returns directly. | `spawn_agent` (ephemeral) |
| `SendMessage({ to, content })` | **SendMessage tool** with `to: "dev-{slug}"` (teammate name) and `message: "{content}"`. Must be fetched first via `ToolSearch`. | `resume_agent` + `send_input` |
| Multiple `Agent()` in sequence labeled "parallel" | Send all Agent tool calls **in a single message** (parallel execution). | `spawn_agent` x N (parallel) |

## Claude Code: Critical Notes

1. **`description` is required.** Every `Agent()` call must include a 3-5 word `description`. The pseudo-code in flow files includes it. If missing, add one based on context.

2. **Teams are required for persistent agents.** Standalone named agents (no `team_name`) terminate when they return — SendMessage cannot reach a dead process. Team members go **idle** after returning, keeping their full context alive. Always create a team before spawning an agent you intend to resume.

3. **Use teammate name for SendMessage, not agentId.** With teams, `to` is the agent's `name` (e.g., `"dev-{slug}"`), not an opaque agentId. This is simpler and reliable.

4. **`SendMessage` is a deferred tool.** Before first use, fetch it: `ToolSearch({ query: "select:SendMessage" })`. `TeamCreate` is also deferred — fetch both: `ToolSearch({ query: "select:TeamCreate,SendMessage" })`. Only needs to be fetched once per session.

5. **SendMessage parameter mapping.** The pseudo-code uses `content` but the actual SendMessage tool uses `message`. Map accordingly:
   - Pseudo-code `to: "dev-{slug}"` → Tool `to: "dev-{slug}"`
   - Pseudo-code `content: "..."` → Tool `message: "..."`
   - Also include `summary: "Resume dev-{slug} for implementation"` (required for string messages)

6. **Teammate idle state is normal.** After the agent finishes planning and goes idle, the system sends an idle notification. This is expected — the agent is waiting, not dead. SendMessage wakes it up.

7. **Named agents preserve context.** The resumed teammate sees its entire Phase 1 transcript (codebase exploration, planning) when it starts Phase 2. This is why planning and implementation use the SAME named agent.

8. **Do NOT inline M/L/XL work.** When the flow says to spawn a named `pm:developer` agent for planning, you MUST use the Agent tool. Do not plan inline in the orchestrator. The agent needs to explore the codebase, and that context must be preserved for implementation.

9. **Parallel dispatch = one message.** When the flow says "dispatch 3 agents in parallel," send all 3 Agent tool calls in a single response. Do not send them sequentially.

10. **Shutdown teammates when done.** After the developer agent returns from implementation (merged or blocked), send a shutdown: `SendMessage({ to: "dev-{slug}", message: { type: "shutdown_request" } })`. This cleanly terminates the agent process.

## Resume Flow (Claude Code)

```
# Step 0: Fetch deferred tools (once per session)
ToolSearch({ query: "select:TeamCreate,SendMessage" })

# Step 1: Create team for persistent agent lifecycle
TeamCreate({
  team_name: "dev-{slug}",
  description: "Dev session for {ISSUE_ID}"
})

# Step 2: Spawn developer as teammate for planning
Agent({
  description: "Plan {ISSUE_ID} implementation",
  name: "dev-{slug}",
  team_name: "dev-{slug}",
  subagent_type: "pm:developer",
  prompt: "Phase 1 — Planning..."
})
# Agent returns PLAN_COMPLETE, then goes IDLE (not terminated)
# You'll receive an idle notification — this is expected

# Between phases: RFC review happens in orchestrator

# Step 3: Resume teammate for implementation
SendMessage({
  to: "dev-{slug}",
  summary: "Resume dev-{slug} for implementation",
  message: "Phase 2 — Implementation approved. Go implement. ..."
})
# Teammate wakes up with full Phase 1 context preserved
# Wait for completion or idle notification with results

# Step 4: Shutdown after completion
SendMessage({
  to: "dev-{slug}",
  message: { type: "shutdown_request" }
})
```
