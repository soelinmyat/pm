---
type: backlog-issue
id: "PM-068"
title: "Product Memory: Remote Knowledge Base"
outcome: "Users can access their PM knowledge base from any machine via MCP, and share it with teammates"
status: drafted
parent: null
children:
  - "shared-context-project-bootstrap"
  - "shared-context-storage-abstraction"
  - "shared-context-api-auth"
  - "shared-context-s3-backend"
  - "shared-context-postgres-metadata"
  - "shared-context-cli-commands"
  - "shared-context-project-detection"
  - "shared-context-team-sharing"
  - "shared-context-hosted-dashboard"
  - "shared-context-billing"
  - "shared-context-changelog-restore"
  - "shared-context-deployment"
labels:
  - "epic"
  - "infrastructure"
  - "monetization"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-04-03
---

## Outcome

Any AI terminal (Claude Code, Codex, future) can read/write the team's product knowledge base via MCP. No local sync — API is source of truth. Shared across machines and teammates.

## Acceptance Criteria

1. v0: MCP server with 5 tools (list, read, create, edit, delete) connects terminal to API.
2. v0: API bridge with auth, path guardrails, server-side cache, diff-based writes with conflict detection.
3. v0: S3 as durable storage with versioning. API + cache as serving layer (~5-10ms reads).
4. v0: GitHub OAuth device flow → JWT. Project auto-detected from git remote URL.
5. v1: Second user can join a project via invite link.
6. v1: Web dashboard available as hosted app (read-only).
7. v1: Billing enforced — free solo, $10/mo flat for up to 5 members, $100/mo flat for up to 20 members.

## Architecture

```
Terminal → MCP Server (5 tools) → API Bridge (auth, cache, conflict detection) → S3 + Postgres
                                       ↓
                                  Web Dashboard (read-only)
```

- **MCP server:** 5 tools — list, read, create, edit (diff-based), delete. Thin HTTP client.
- **API bridge:** Auth, path guardrails, server-side cache (memory/Redis), ETag conflict detection.
- **S3:** Durable storage. One bucket, `/ws-{id}/pm/` prefixes. Versioning enabled.
- **Postgres:** Users, workspaces, billing, changelog. Metadata only.
- **No local cache.** API is always the source of truth.
- **Conflict resolution:** API rejects stale writes → returns both versions → AI terminal merges.

## Pricing

| Tier | Price | Members | Projects |
|------|-------|---------|----------|
| Solo | Free | 1 | Unlimited |
| Team | $10/mo | Up to 5 | Unlimited |
| Scale | $100/mo | Up to 20 | Unlimited |

## Success Criteria (90 days post-v0)

- 10+ users with MCP server connected on real projects
- 3+ users accessing from multiple machines
- Zero data loss incidents

## Competitor Context

No AI coding tool shares product knowledge today. Every competitor shares coding context only:
- **Cursor** ($40/user): `.cursor/rules/` in git. No knowledge base.
- **GitHub Copilot** ($19-39/user): Copilot Spaces for coding context. Not product knowledge.
- **Claude Code** ($150/user premium): CLAUDE.md in git. No shared product brain.
- **Windsurf** ($40/user): Rules + 50 Google Docs (beta). No structured knowledge base.
- **Tabnine** ($39-59/user): Enterprise Context Engine for code topology. Not product decisions.

Product Memory would be the first tool to share research, strategy, competitive intel, and groomed issues across a team — accessible from any AI terminal via MCP.

## Research Links

- [Shared Context Research](pm/research/shared-context/findings.md)
- [Thinking Artifact](pm/thinking/shared-context.md)

## Notes

- v0 validates demand before v1 investment
- Dashboard stays read-only — all writes from terminals
- Agent-as-merge-layer is a marketable differentiator
- MCP-first design makes it terminal-agnostic (Claude Code, Codex, any future tool)
- Weekend-to-week build complexity: ~1000-1500 lines total for API + MCP server
