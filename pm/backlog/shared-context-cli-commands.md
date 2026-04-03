---
type: backlog-issue
id: "PM-073"
title: "MCP server: 5 tools for remote knowledge base access"
outcome: "Any AI terminal can read/write the shared knowledge base via MCP tools — no sync, no local cache"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "mcp"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-04-03
---

## Outcome

An MCP server with 5 tools (list, read, create, edit, delete) connects any AI terminal to the Product Memory API. No local sync or cache — the API is always the source of truth. The MCP server is a thin HTTP client that routes tool calls to the API.

## Acceptance Criteria

1. MCP server exposes 5 tools: `list(folder?)`, `read(path)`, `create(path, content)`, `edit(path, diff)`, `delete(path)`.
2. `list` returns file names + paths in a folder (recursive optional).
3. `read` returns full file content from the API.
4. `create` sends new file content — API enforces path guardrails (research/ , backlog/, strategy/, etc.).
5. `edit` sends a diff — API applies it, rejects on ETag conflict, returns both versions for AI merge.
6. `delete` removes a file (API enforces guardrails).
7. MCP server supports two modes via config: `remote` (calls API) or `local` (reads/writes local `pm/` filesystem — current behavior).
8. Mode detected from `.pm/config.json` — if `hub` key exists with API URL + token, use remote. Otherwise local.
9. `pm login` skill still needed — initiates GitHub OAuth device flow, stores JWT, writes hub config to `.pm/config.json`.
10. All tools fail gracefully without auth: return error "Not connected to Product Memory. Run pm login first."
11. MCP server is stateless — no local cache, no sync state, no conflict resolution logic (that's in the API + terminal).

## Technical Feasibility

**Build-on:** Existing MCP patterns in Claude Code plugin ecosystem. `.pm/config.json` for project settings.

**Build-new:** MCP server (~200-300 lines), HTTP client for API calls, config detection logic.

**Risk:** Minimal. MCP server is a thin wrapper. The complexity lives in the API (PM-070), not here.

## Research Links

- [Shared Context Research](pm/research/shared-context/findings.md)

## Notes

- Depends on PM-070 (API + auth), PM-071 (S3 backend).
- Replaces the old push/pull/status CLI commands — no sync model needed.
- Works with Claude Code, Codex, and any future MCP-compatible terminal.
- Local mode preserves current solo experience with zero changes.
