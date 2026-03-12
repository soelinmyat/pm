# Gemini CLI Tool Mapping

Tool mapping table for translating Claude Code tool calls to Gemini CLI equivalents.

| Claude Code Tool | Gemini Equivalent | Notes |
|------------------|-------------------|-------|
| Read | `read_file` | Same semantics. Read file contents by path. |
| Write | `write_file` | Same semantics. Write/create file with content. |
| Edit | `edit_file` | Same semantics. Patch/modify existing files. |
| Bash | `run_shell_command` | Same semantics. Execute shell commands. |
| Glob | `list_directory` | Pattern-based file listing. |
| Grep | `search_in_files` | Content search across files. |
| Agent | (not available) | Fall back to sequential workflows. No subagent support. |
| WebSearch | `google_search` | Same semantics. Search the web. |
| WebFetch | `read_url` | Same semantics. Fetch and process URL content. |
| Skill | `activate_skill` | Gemini's skill invocation mechanism. |

## Platform-Specific Notes

### No Subagent Support
- Gemini CLI does not support multiagent spawning
- When Agent tool would be used, fall back to sequential workflows
- Useful for competitor profiling: run searches sequentially instead of parallel dispatch
- Document sequential steps clearly in prompts

### Skill Invocation
- `activate_skill` used to invoke Gemini skills
- Similar to Claude Code's Skill tool but different invocation semantics
- Refer to Gemini documentation for skill registry and naming conventions

### Tool Name Mappings
All read/write/search operations have direct or equivalent Gemini mappings:
- File operations: `read_file`, `write_file`, `edit_file`
- Search operations: `search_in_files`, `list_directory`
- Web operations: `google_search`, `read_url`
- Shell: `run_shell_command`

### Configuration
- No special configuration flags needed
- Tools available by default in Gemini CLI environment
- Check Gemini documentation for authentication (Google API keys, etc.)

### Sequential Workflows
When translating Claude Code's multiagent patterns:
```
Claude Code (parallel):
  - Spawn Agent 1 (research)
  - Spawn Agent 2 (research)
  - Coordinate results

Gemini (sequential):
  - Run search 1 with google_search
  - Run search 2 with google_search
  - Merge results in prompt
```
