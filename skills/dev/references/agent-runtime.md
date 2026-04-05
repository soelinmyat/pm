# Agent Runtime Mapping

This reference defines how to interpret the `Agent()` and `SendMessage()` pseudo-code used throughout dev skill flow files. The pseudo-code is agent-agnostic. Each runtime maps it to its own tool surface.

## Pseudo-code Format

```
Agent({
  description: "Short task summary",     // REQUIRED for Claude Code
  name: "dev-{slug}",                    // Makes agent addressable for resume
  subagent_type: "pm:developer",         // Specialized agent type
  prompt: "..."                          // Task instructions
})
```

```
SendMessage({
  to: "{agentId}",                        // agentId returned from Agent() spawn
  content: "..."                          // Resume instructions
})
```

## Runtime Mapping

| Pseudo-code | Claude Code | Codex |
|-------------|------------|-------|
| `Agent({ description, name, subagent_type, prompt })` | **Agent tool** with all 4 params. `description` is required (3-5 words). Returns `agentId` for resume. | `spawn_agent` |
| `Agent({ description, subagent_type, prompt })` (no name) | **Agent tool** without `name`. Short-lived sub-agent, result returns directly. | `spawn_agent` (ephemeral) |
| `SendMessage({ to, content })` | **SendMessage tool** with `to: "{agentId}"` and `message: "{content}"`. Must be fetched first via `ToolSearch`. | `resume_agent` + `send_input` |
| Multiple `Agent()` in sequence labeled "parallel" | Send all Agent tool calls **in a single message** (parallel execution). | `spawn_agent` x N (parallel) |

## Claude Code: Critical Notes

1. **`description` is required.** Every `Agent()` call must include a 3-5 word `description`. The pseudo-code in flow files includes it. If missing, add one based on context.

2. **Capture the `agentId` for resume.** When you spawn a named agent, the Agent tool returns an `agentId` in its output (e.g., `agentId: a5c0cd2a3955ce846`). You MUST capture this ID and use it as the `to` parameter in SendMessage. The `name` parameter is for human readability only. The `agentId` is the actual address.

3. **`SendMessage` is a deferred tool.** Before first use, fetch it: `ToolSearch({ query: "select:SendMessage" })`. Only needs to be fetched once per session.

4. **SendMessage parameter mapping.** The pseudo-code uses `content` but the actual SendMessage tool uses `message`. Map accordingly:
   - Pseudo-code `to: "dev-{slug}"` → Tool `to: "{agentId captured from spawn}"`
   - Pseudo-code `content: "..."` → Tool `message: "..."`
   - Also include `summary: "Resume dev-{slug} for implementation"` (required for string messages)

5. **SendMessage resumes asynchronously.** The agent is resumed in the background. The output is written to a file path returned in the SendMessage response. Read that file to get the agent's response.

6. **No team required.** Named agents + SendMessage work without TeamCreate. Verified: agent context (full transcript) is preserved across resume.

7. **Named agents preserve context.** The resumed agent sees its entire Phase 1 transcript (codebase exploration, planning) when it starts Phase 2. This is why planning and implementation use the SAME named agent.

8. **Do NOT inline M/L/XL work.** When the flow says to spawn a named `pm:developer` agent for planning, you MUST use the Agent tool. Do not plan inline in the orchestrator. The agent needs to explore the codebase, and that context must be preserved for implementation.

9. **Parallel dispatch = one message.** When the flow says "dispatch 3 agents in parallel," send all 3 Agent tool calls in a single response. Do not send them sequentially.

## Resume Flow (Claude Code)

```
# Phase 1: Spawn named agent for planning
result = Agent({
  description: "Plan {ISSUE_ID} implementation",
  name: "dev-{slug}",
  subagent_type: "pm:developer",
  prompt: "Phase 1 — Planning..."
})
# result contains: agentId: "abc123..."
# Save this agentId for Phase 2

# Between phases: RFC review happens in orchestrator

# Phase 2: Resume for implementation
# First fetch SendMessage if not already fetched:
ToolSearch({ query: "select:SendMessage" })

# Then resume:
SendMessage({
  to: "abc123...",           // the agentId, NOT the name
  summary: "Resume dev-{slug} for implementation",
  message: "Phase 2 — Implementation approved. Go implement. ..."
})
# Response written to output file path in SendMessage result
# Read that file to get the agent's implementation report
```
