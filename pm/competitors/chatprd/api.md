---
type: competitor-api
company: ChatPRD
slug: chatprd
profiled: 2026-03-13
api_available: false
sources:
  - url: https://www.chatprd.ai/product/mcp
    accessed: 2026-03-13
  - url: https://github.com/ChatPRD/chatprd-mcp
    accessed: 2026-03-13
  - url: https://intercom.help/chatprd/en/articles/11917863-mcp-model-context-protocol-integration
    accessed: 2026-03-13
  - url: https://www.chatprd.ai/blog/finally-bring-your-mcps-to-chatprd
    accessed: 2026-03-13
  - url: https://www.chatprd.ai/docs/linear-mcp-connector
    accessed: 2026-03-13
  - url: https://rywalker.com/research/chatprd
    accessed: 2026-03-13
---

# ChatPRD — API

## API Availability

**No public REST API.** ChatPRD does not expose a traditional REST or GraphQL API for customers or third-party developers. There are no documented endpoints at `chatprd.ai/api`, `api.chatprd.ai`, or `developers.chatprd.ai`. No API documentation, Swagger/OpenAPI specs, or Postman collections were found.

The integration surface is entirely via:
1. **MCP Server** (outbound) — ChatPRD exposes its functionality to MCP-compatible clients.
2. **MCP Connectors** (inbound) — ChatPRD connects to external tools via their MCP servers.
3. **Pre-built native integrations** — Linear, Notion, Slack, Google Drive, Confluence.

This means customers cannot build custom integrations beyond what ChatPRD has pre-built or what MCP supports.

## Auth Model

### MCP Server (Outbound)
- **No API key required.** The MCP endpoint at `https://app.chatprd.ai/mcp` does not require explicit API key configuration.
- Authentication appears to be handled via session/cookie after the user authenticates in their MCP client.
- Inference: The lack of explicit API key auth suggests the MCP server uses the authenticated user's session context, which limits programmatic (headless) access.

### MCP Connectors (Inbound)
- **OAuth 2.0** for Linear integration — users authorize ChatPRD to access their Linear workspace.
- Other connectors (Notion, Atlassian, GitHub, Granola) likely use OAuth as well, configured via Settings > Integrations in the ChatPRD app.

### Native Integrations
- **OAuth-based** for Linear (confirmed).
- Slack integration likely uses Slack's OAuth App framework.
- Google Drive and Notion integrations are likely OAuth-based as well (standard for these platforms).

## Core Entity Model

Based on the MCP tools exposed, ChatPRD's data model centers on these entities:

| Entity | Description | Access via MCP |
|---|---|---|
| Document | Primary artifact — PRDs, specs, user stories, and other product documents | Full: list, get, search, create, update |
| Project | Container for saved instructions, files, and context. Acts as a custom AI assistant profile | Read: list only |
| Organization | Top-level tenant for team accounts | Read: list memberships, list org documents |
| Chat | Conversation thread between user and AI | Read: list, search |
| Template | Reusable document structure — both system and custom templates | Read: list only |
| User Profile | Account info and subscription details | Read: get only |

### Notable Observations

- **Document is the first-class entity.** It has full CRUD (list, get, search, create, update) via MCP. This confirms ChatPRD's architecture is document-centric.
- **No delete operation** is exposed on any entity via MCP. Users cannot programmatically delete documents from external clients.
- **Project and Organization are read-only** via MCP — you can browse them but not create or modify them externally.
- **Chat is read-only** — conversations can be listed and searched but not created or continued via MCP.
- **No concept of Team, Member, or Permission** is exposed in the MCP entity model, even though the product supports team collaboration. Team management appears to be strictly UI-only.

## Endpoint Coverage

| Entity | List | Get | Search | Create | Update | Delete | Bulk |
|---|---|---|---|---|---|---|---|
| Document | Y | Y | Y (vector search) | Y | Y (via instructions) | N | N |
| Project | Y | N | N | N | N | N | N |
| Organization | Y | N | N | N | N | N | N |
| Org Documents | Y | N | N | N | N | N | N |
| Chat | Y | N | Y | N | N | N | N |
| Template | Y | N | N | N | N | N | N |
| User Profile | N | Y | N | N | N | N | N |

Document search uses vector search (semantic), which is notable — it suggests an embeddings-based retrieval system behind the scenes.

## Webhooks

**No webhook support documented.** There is no mention of webhook events, callback URLs, or event-driven notifications in any ChatPRD documentation. Integrations are either:
- Initiated by the user in chat (e.g., "push this to Linear").
- Triggered by explicit Linear Agent mentions (@chatprd in Linear).

This means external systems cannot react to ChatPRD events (new document created, document updated, etc.) without polling.

## Rate Limits

**Rate limits not publicly documented.** No information found about request limits, throttling behavior, or rate limit headers for the MCP endpoint. Given the session-based auth model, limits are likely tied to the user's subscription tier rather than explicit API rate limits.

## SDKs and Integrations

### Official SDKs
No official SDKs in any language. The MCP server endpoint is the only programmatic interface.

### MCP Server Configuration
The MCP server can be configured in multiple clients:

**Cursor:**
```json
{
  "mcpServers": {
    "ChatPRD": {
      "url": "https://app.chatprd.ai/mcp"
    }
  }
}
```

**Windsurf:** Uses `mcp-remote` JSON configuration.
**Claude Code:** CLI command setup.
**Claude Desktop:** `mcp-remote` JSON configuration.
**VS Code:** `settings.json` configuration.

### Native Integrations
| Integration | Direction | Capabilities |
|---|---|---|
| Linear | Bidirectional | Push PRDs as tickets, @chatprd agent creates issues from discussions, browse issues/projects/sprints |
| Notion | Bidirectional | Export docs to Notion; search pages/databases/read content via MCP connector |
| Slack | Push | Share docs, team notifications, AI assistant in Slack |
| Google Drive | Pull | File access for context |
| Confluence | Bidirectional | Export docs; query Jira issues and search pages via Atlassian MCP |
| GitHub | Pull | Browse issues, PRs, codebase for planning context via MCP connector |
| Granola | Pull | Use call transcripts as context via MCP connector |
| v0 (Vercel) | Push | Generate UI components from PRDs |
| Replit | Push | Transfer PRDs with optimized prompts for build agent |
| Lovable | Push | Generate prototypes from specs |
| Bolt.new | Push | Code generation from specs |
| Cursor | Bidirectional | "Open in Cursor" + MCP server access |

### Marketplace / Platform Presence
- No Zapier integration found.
- No Make (Integromat) integration found.
- No Workato or other iPaaS presence found.
- Listed in OpenAI's GPT Store as a custom GPT (separate from the web app).

## Architectural Signals

**Inference: Document-centric, not platform-centric.** The entity model reveals ChatPRD is fundamentally a document generation and management tool with AI as the interaction layer. There are no workflow, approval, or lifecycle entities — documents exist in a flat structure within projects and organizations.

**Inference: MCP-first integration strategy.** By choosing MCP over REST API, ChatPRD is betting on the AI-native integration paradigm. This is forward-looking but limits integration to MCP-compatible clients (currently a small ecosystem). Traditional webhook/API integrations used by enterprise iPaaS tools are not supported.

**Inference: Vector search suggests embeddings infrastructure.** The `search_documents` tool using vector search implies ChatPRD maintains an embeddings index of all user documents. This is a meaningful infrastructure investment and could enable future features like semantic duplicate detection or knowledge graph capabilities.

**Inference: Integration surface is shallow but wide.** Many integrations exist but most are single-direction (push documents out). Only Linear has meaningful bidirectional functionality with the @chatprd agent. The integration story is breadth over depth.

**Inference: No API signals "not built for integration yet."** The absence of a REST API, webhooks, and iPaaS connectors means ChatPRD cannot be embedded into enterprise workflows that require programmatic document creation, status tracking, or event-driven automation. This is a significant limitation for enterprise adoption where tools must participate in automated workflows.
