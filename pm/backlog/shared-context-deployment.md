---
type: backlog-issue
id: "PM-080"
title: "Hub deployment: Dockerfile, CI/CD, DNS"
outcome: "The hub API is running in production and accessible at api.productmemory.io"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "deployment"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

The Product Memory API server is deployed to a cloud platform. MCP servers and the web dashboard can connect to it. DNS is configured.

## Acceptance Criteria

1. Dockerfile builds the API server (Node.js, production deps only).
2. Deployed to Railway or Fly.io with auto-deploy on push to main of the `product-memory` repo.
3. Environment variables configured: S3 credentials (R2), Postgres URL (Neon), GitHub OAuth secrets, JWT signing key, Redis URL (if used), Stripe keys (v1).
4. DNS configured: `api.productmemory.io` points to the deployment.
5. HTTPS via platform-provided TLS (no manual cert management).
6. Health check endpoint: `GET /health` returns 200 with service status.
7. Logging: structured JSON logs to platform's log drain.
8. CI pipeline: tests run before deploy. Failed tests block deployment.

## Technical Feasibility

**Build-new:** Dockerfile, fly.toml or railway.json, GitHub Actions workflow, DNS records.

**Risk:** Neon Postgres cold start (~500ms) on first query after idle. Acceptable for MCP tool calls but worth monitoring.

## Notes

- Depends on PM-070 (API server exists) and PM-079 (project bootstrap).
- v0 needs this before real users can test. Deploy early, iterate in production.
- Consider Fly.io for wake-on-request (no idle charges) or Railway for simplicity.
- Infra cost: ~$5-10/mo (Railway/Fly) + free R2/S3 tier + free Neon Postgres tier.
