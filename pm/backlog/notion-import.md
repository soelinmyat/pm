---
type: backlog-issue
title: "Notion Import"
outcome: "PMs can ingest Notion pages (PRDs, specs, meeting notes) as context for research and grooming"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "integration"
priority: high
evidence_strength: strong
scope_signal: medium
strategic_fit: "Priority 1: Depth of product context"
competitor_gap: partial
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

PMs can point `/pm:ingest` at a Notion page URL and have its content normalized into research topics or strategy inputs. Existing product knowledge in Notion becomes part of the persistent knowledge base without manual copy-paste.

## Signal Sources

- `pm/competitors/matrix.md`: Product Memory has no Notion integration. ChatPRD has native Notion + MCP. Spark has URL pasting.
- `pm/competitors/chatprd/features.md`: ChatPRD's Notion MCP connector can search pages, read content, and create new pages.
- `pm/strategy.md` § 6: Input source expansion is Priority 1.

## Competitor Context

- **ChatPRD:** Native Notion integration + Notion MCP connector. Can search, read, and create Notion pages from within chat.
- **Productboard Spark:** Supports pasting Notion URLs into chat — auto-transforms into visual chips with content added to context.
- **PM Skills Marketplace:** No integrations.

Product Memory would normalize Notion content into structured markdown — more persistent than ChatPRD's session context, more structured than Spark's URL pasting.

## Dependencies

None. Could use Notion MCP if available, or Notion API directly.

## Open Questions

- Auth: Notion API token vs. Notion MCP server (if user has one configured)?
- Scope: individual pages, databases, or both?
- Handling nested pages and linked databases?
