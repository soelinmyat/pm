---
type: backlog-issue
id: PM-009
title: "GitHub Issues Ingestion"
outcome: "PMs can import GitHub issues and discussions as customer evidence and feature request signals"
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
competitor_gap: partial
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

PMs can point `/pm:ingest` at a GitHub repo and have its issues and discussions normalized into research topics — feature requests become customer evidence, bug reports surface pain points, discussions reveal unmet needs. Especially valuable for open-source products where GitHub *is* the feedback channel.

## Signal Sources

- `pm/strategy.md` § 6: Issue trackers named as input source to add.
- `pm/competitors/matrix.md`: ChatPRD has GitHub MCP for browsing issues and PRs. Product Memory has nothing.
- `pm/competitors/chatprd/features.md`: ChatPRD's GitHub MCP connector lets users browse issues, PRs, and codebase when planning.

## Competitor Context

- **ChatPRD:** GitHub MCP connector for browsing — but browsing, not structured ingestion. Issues are read in conversation context, not normalized into a knowledge base.
- **Productboard Spark:** GitHub codebase connection is on their roadmap but not shipped.
- **PM Skills Marketplace:** No integrations.

Product Memory would normalize GitHub issues into structured evidence — themes, sentiment, request frequency — not just surface-level browsing.

## Dependencies

None. GitHub CLI (`gh`) is widely available. Could also use GitHub MCP if configured.

## Open Questions

- Scope: all issues, or filtered by label/milestone/date range?
- Normalization: how to categorize issues (feature request, bug, question, discussion)?
- Volume: repos with 1000+ issues need pagination and sampling strategy.
