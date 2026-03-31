---
type: backlog-issue
id: "PM-072"
title: "Postgres metadata (users, projects, user_projects)"
outcome: "Hub can track which users own which projects, enabling multi-project and future multi-user access"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "database"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

A Postgres database on Neon free tier stores user and project metadata. The API server queries it to resolve user identity, list user's projects, and map projects to S3 prefixes.

## Acceptance Criteria

1. Three tables created with migrations:
   - `users`: id (uuid), github_id (bigint unique), github_username (text), created_at
   - `projects`: id (uuid), slug (text), s3_prefix (text), created_at
   - `user_projects`: user_id (fk), project_id (fk), role (text, default 'owner'), created_at
2. `GET /projects` returns all projects for the authenticated user.
3. `POST /projects` creates a new project (derives slug from request, generates S3 prefix).
4. User record created automatically on first login (upsert on github_id).
5. Schema migrations run on server startup (simple SQL files, no ORM).
6. Connection pooling configured for serverless (Neon's serverless driver or `pg` with pool).
7. All queries parameterized (no SQL injection).

## Technical Feasibility

**Build-new:** Schema, migrations, query layer. First database dependency in the project. Use `pg` (node-postgres) — minimal, well-tested, no ORM overhead.

**Risk:** Neon free tier has cold start latency (~500ms first query after idle). Acceptable for a CLI tool but worth noting.

## Research Links

- [Shared Context Research](pm/research/shared-context/findings.md)

## Notes

- No dependencies on PM-069 or PM-070 — can be built in parallel.
- v1 adds tables: `changelog`, `billing_subscriptions`, `invite_tokens`.
- Neon free tier: 0.5GB storage, 100 hours compute/month. More than enough.
- PM-073 (CLI commands) and PM-074 (project detection) depend on this.
