---
type: backlog-issue
id: "PM-071"
title: "S3 storage backend (versioned)"
outcome: "Knowledge base files are stored in S3 with automatic versioning for rollback"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "storage"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

S3 serves as the durable storage layer for all knowledge base files. The API server (PM-070) reads/writes S3 and maintains a server-side cache (memory/Redis) for fast serving. Terminals never talk to S3 directly — they go through the API via the MCP server.

## Acceptance Criteria

1. S3 module provides: `readFile`, `writeFile`, `listFiles`, `deleteFile`, `listVersions`, `readVersion`.
2. Single S3 bucket with versioning enabled.
3. Files stored at `/ws-{id}/pm/{path}` keys.
4. Previous versions retained automatically by S3 versioning.
5. `listVersions(path)` returns version history for a file.
6. `readVersion(path, versionId)` retrieves a specific version.
7. Lifecycle policy: delete versions older than 90 days (configurable).
8. Works with both AWS S3 and Cloudflare R2 (S3-compatible API).
9. ETag returned on every read/write — used by API for conflict detection on diff-based edits.
10. Server-side cache layer sits between API and S3: reads served from cache (~5-10ms), cache invalidated on writes.
11. Integration tests verify read/write/list/version operations against a real bucket (or localstack for CI).

## Technical Feasibility

**Build-new:** `@aws-sdk/client-s3` integration. Lives in the `product-memory` repo (private), not the plugin repo.

**Risk:** S3 GET latency (50-200ms) per operation. Mitigated by server-side cache — first read hits S3, subsequent reads from memory/Redis. Small `.md` files mean the whole workspace fits in <50MB of cache.

## Research Links

- [Sync protocol research](pm/research/shared-context/findings.md)

## Notes

- R2 is S3-compatible and has a generous free tier (10GB). Consider as default.
- Bucket name: `pm-hub-{environment}` (e.g., `pm-hub-production`).
- S3 is the **storage layer**, API + cache is the **serving layer**. Terminals never hit S3 directly.
- PM-076 (hosted dashboard) and PM-078 (changelog/restore) depend on this.
