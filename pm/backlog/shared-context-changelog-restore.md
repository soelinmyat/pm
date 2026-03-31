---
type: backlog-issue
id: "PM-078"
title: "Changelog + pm restore"
outcome: "Users can see who changed what and when, and restore any file to a previous version"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "safety"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

Every file write is logged in a Postgres changelog table. Users can view history and restore previous versions of any file using S3 versioning.

## Acceptance Criteria

1. Every `PUT /files/{path}` appends a row to `changelog`: timestamp, user_id, project_id, file_path, action (create/update/delete), file_hash, previous_hash.
2. `pm log {path}` shows changelog for a file: who, when, action.
3. `pm log` (no path) shows recent changelog for the entire project.
4. `pm restore {path}` lists available versions (from S3), user picks one, restores it.
5. `pm restore {path} --version {id}` restores a specific version directly.
6. `pm diff {path}` shows diff between local and latest remote version.
7. Restore creates a new version (not a rollback — preserves full history).

## Technical Feasibility

**Build-on:** PM-071 (S3 versioning — versions already retained), PM-072 (Postgres — add changelog table).

**Build-new:** Changelog write middleware in API, `pm log`/`pm restore`/`pm diff` CLI commands, S3 version listing.

## Notes

- Depends on PM-071 (S3 backend) and PM-072 (Postgres).
- This is the safety net that gives users confidence to let agents write freely.
- Changelog schema should support future `pm:insights` analysis (per memory: project_insights_command.md).
