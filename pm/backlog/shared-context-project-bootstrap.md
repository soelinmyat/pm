---
type: backlog-issue
id: "PM-079"
title: "Project bootstrap: package.json, deps, local dev environment"
outcome: "Engineers can run the hub API, Postgres, and S3 locally and start building immediately"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "dx"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

The `product-memory` repo (private) has a `package.json`, dependency management, and a local dev environment (docker-compose) so any engineer can run the full API stack locally in one command.

## Acceptance Criteria

1. `package.json` initialized with project metadata. Module system: CommonJS.
2. Core dependencies declared: `jose` (JWT), `pg` (Postgres), `@aws-sdk/client-s3` (S3), `stripe` (billing, v1).
3. `docker-compose.yml` provides local Postgres and MinIO (S3-compatible) for development.
4. `npm run dev` starts the API server connected to local Postgres and MinIO.
5. `npm test` runs tests.
6. `.env.example` documents all required environment variables (S3 credentials, Postgres URL, GitHub OAuth client ID/secret, JWT signing key).
7. MinIO bucket auto-created with versioning enabled on `docker-compose up`.
8. Postgres schema migrations run automatically on server startup.

## Technical Feasibility

**Risk:** Minimal. This is a greenfield repo — no plugin distribution concerns. The plugin repo (open source) stays dependency-free. All server dependencies live in the `product-memory` repo (private).

## Notes

- This is the first thing to build in the new `product-memory` repo.
- Plugin repo (pm) stays dependency-free — only gets the MCP server addition (~200-300 lines).
- Weekend build scope: project bootstrap + API + S3 + Postgres = ~1000-1500 lines total.
