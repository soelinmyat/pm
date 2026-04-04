---
type: backlog-issue
id: PM-014
title: "Slack Feedback Ingestion"
outcome: "PMs can import customer feedback from Slack channels into the knowledge base as structured evidence"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "integration"
priority: medium
evidence_strength: moderate
scope_signal: medium
strategic_fit: "Priority 1: Depth of product context"
competitor_gap: parity
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

PMs can point `/pm:ingest` at a Slack channel export (or use Slack MCP) and have customer feedback, feature requests, and bug reports normalized into research topics. Feedback trapped in Slack becomes searchable, structured product evidence.

## Signal Sources

- `pm/strategy.md` § 6: User feedback channels named as input source to add.
- `pm/competitors/matrix.md`: Both ChatPRD (bot) and Spark (feedback intake) have Slack integration. Product Memory has nothing.

## Competitor Context

- **ChatPRD:** Slack bot for sharing documents and team notifications. AI assistant within Slack.
- **Productboard Spark:** Slack is one of 20+ native feedback intake integrations in the core platform.
- **PM Skills Marketplace:** No integrations.

Both competitors use Slack as a real-time channel. Product Memory's approach would be batch ingestion — import a channel export or use Slack MCP to pull recent messages, then normalize into evidence.

## Dependencies

None for file-based ingestion (Slack export JSON). Slack MCP would be optional for live channel access.

## Open Questions

- File-based first (Slack export JSON) or Slack MCP first?
- Filtering: how to separate signal (feature requests, feedback) from noise (chatter, reactions)?
- Thread handling: should threaded replies be grouped with parent messages?
