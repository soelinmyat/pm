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

The project has a `package.json`, dependency management, and a local dev environment (docker-compose) so any engineer can run the full hub stack locally in one command.

## Acceptance Criteria

1. `package.json` initialized with project metadata. Module system: CommonJS (matches existing `require()` usage).
2. Core dependencies declared: `jose` (JWT), `pg` (Postgres), `@aws-sdk/client-s3` (S3), `stripe` (billing, v1).
3. `docker-compose.yml` provides local Postgres and MinIO (S3-compatible) for development.
4. `npm run dev` starts the API server connected to local Postgres and MinIO.
5. `npm test` runs existing `node:test` tests plus new infrastructure tests.
6. `.env.example` documents all required environment variables (S3 credentials, Postgres URL, GitHub OAuth client ID/secret, JWT signing key).
7. MinIO bucket auto-created with versioning enabled on `docker-compose up`.
8. Postgres schema migrations run automatically on server startup.

## Technical Feasibility

**Risk:** This is the first time the project has external dependencies. The plugin distribution via `~/.claude/plugins/cache/pm/pm/` currently copies all files. Adding `node_modules` changes the sync/install story. **Mitigation:** Hub server code lives in a separate directory (e.g., `hub/`) not synced to the plugin cache. The plugin itself stays dependency-free; only the hub server has deps.

## Notes

- Must ship before or alongside PM-069 (storage abstraction).
- Hub code should be a separate directory from plugin code to keep plugin distribution clean.
- This is where the zero-dependency posture formally ends for the server side. Plugin code stays dependency-free.
