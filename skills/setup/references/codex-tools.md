# Codex CLI Tool Mapping

Tool mapping table for translating Claude Code tool calls to Codex CLI equivalents.

| Claude Code Tool | Codex Equivalent | Notes |
|------------------|------------------|-------|
| Read | `read_file` | Same semantics. Read file contents by path. |
| Write | `write_file` | Same semantics. Write/create file with content. |
| Edit | `patch_file` | Different syntax (unified diff patch format). |
| Bash | `shell` | Same semantics. Execute shell commands. |
| Glob | `list_files` | Pattern-based file listing. |
| Grep | `search_files` | Content search across files. |
| Agent | `spawn_agent` | Requires `collab = true` in Codex config. Dispatches researcher agents. |
| WebSearch | `web_search` | Same semantics. Search the web. |
| WebFetch | `web_fetch` | Same semantics. Fetch and process URL content. |

## Platform-Specific Notes

### Agent Spawning
- `spawn_agent` available for multiagent workflows
- Requires `collab = true` configuration flag in Codex setup
- Useful for researcher agent dispatch in setup/research tasks

### Skill Loading
- Skills loaded via native Codex discovery mechanism
- No explicit mapping needed for skill invocation

### File System Tools
- File system operations (`read_file`, `write_file`, `list_files`) are native Codex tools
- No special configuration required
- Work identically to Claude Code equivalents

### Configuration
```yaml
# codex.yml example
collab: true  # Enable multiagent support
```
