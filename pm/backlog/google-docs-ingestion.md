---
type: backlog-issue
id: PM-010
title: "Google Docs Ingestion"
outcome: "PMs can import product docs, meeting notes, and specs from Google Docs into the knowledge base via /pm:ingest"
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
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

PMs can point `/pm:ingest` at a Google Doc URL (or folder) and have its content normalized into the knowledge base — as research topics, customer evidence, or strategy inputs. No more copy-pasting from Google Docs into chat.

## Signal Sources

- `pm/strategy.md` § 6: Strategy explicitly names Google Docs as an input source to add.
- `pm/competitors/matrix.md`: No competitor does structured Google Docs ingestion. ChatPRD has Google Drive for file storage, not content normalization.

## Competitor Context

- **ChatPRD:** Google Drive integration for file storage and access — but files are uploaded as context blobs, not parsed into structured research artifacts.
- **Productboard Spark:** No Google Docs integration. Supports Notion/Confluence URL pasting.
- **PM Skills Marketplace:** No integrations of any kind.

Product Memory would be the first to normalize Google Docs content into a structured, persistent knowledge base.

## Dependencies

None. The ingest skill already handles file-based ingestion. This extends it to a new source type.

## Open Questions

- Auth: Google OAuth vs. service account vs. public doc URLs only?
- Scope: individual docs, folders, or both?
- Format: how to handle Google Docs formatting (headings, tables, comments) during normalization?
