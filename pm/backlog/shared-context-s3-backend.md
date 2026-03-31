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

An `S3StorageProvider` implements the storage interface from PM-069. Files are stored in a versioned S3 bucket with prefix structure `users/{id}/projects/{id}/pm/`. Any overwritten file can be restored to a previous version.

## Acceptance Criteria

1. `S3StorageProvider` implements the full `StorageProvider` interface (read, write, list, exists, stat, delete).
2. Single S3 bucket with versioning enabled.
3. Files stored at `users/{user_id}/projects/{project_id}/pm/{path}` keys.
4. Previous versions retained automatically by S3 versioning.
5. `listVersions(path)` method returns version history for a file.
6. `readVersion(path, versionId)` retrieves a specific version.
7. Lifecycle policy: delete versions older than 90 days (configurable).
8. Works with both AWS S3 and Cloudflare R2 (S3-compatible API).
9. Integration tests verify read/write/list/version operations against a real bucket (or localstack for CI).

## Technical Feasibility

**Build-new:** `@aws-sdk/client-s3` integration. This is the first external dependency in the project — introduces `node_modules` and `package.json`.

**Risk:** The zero-dependency posture breaks. S3 SDK pulls 20+ transitive deps. Consider using the S3 REST API directly with `node:https` + SigV4 signing to minimize dependencies. Trade-off: more code but no `node_modules`.

## Research Links

- [Sync protocol research](pm/research/shared-context/findings.md)

## Notes

- R2 is S3-compatible and has a generous free tier (10GB). Consider as default.
- Bucket name: `pm-hub-{environment}` (e.g., `pm-hub-production`).
- Depends on PM-069 (storage abstraction interface).
- PM-076 (hosted dashboard) and PM-078 (changelog/restore) depend on this.
