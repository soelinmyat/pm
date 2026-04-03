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

Every file write is logged in a Postgres changelog table. Users can view history and restore previous versions via API endpoints (exposed through MCP tools or dashboard).

## Acceptance Criteria

1. Every `POST /files/{path}` (create), `PATCH /files/{path}` (edit), and `DELETE /files/{path}` appends a row to `changelog`: timestamp, user_id, project_id, file_path, action (create/update/delete), file_hash, previous_hash.
2. `GET /changelog?path={path}` returns changelog for a file: who, when, action.
3. `GET /changelog` returns recent changelog for the entire workspace.
4. `GET /files/{path}/versions` lists available S3 versions for a file.
5. `GET /files/{path}?version={id}` retrieves a specific version.
6. `POST /files/{path}/restore?version={id}` restores a specific version (creates a new version — preserves full history).
7. Web dashboard shows changelog as an activity feed.

## Technical Feasibility

**Build-on:** PM-071 (S3 versioning — versions already retained), PM-072 (Postgres — add changelog table).

**Build-new:** Changelog write middleware in API, version listing/restore endpoints, dashboard activity feed.

## Notes

- Depends on PM-071 (S3 backend) and PM-072 (Postgres).
- This is the safety net that gives users confidence to let agents write freely.
- Changelog schema should support future `pm:insights` analysis (per memory: project_insights_command.md).
- No CLI commands needed — the MCP server or dashboard exposes this. Terminals can call the API endpoints directly if needed.
