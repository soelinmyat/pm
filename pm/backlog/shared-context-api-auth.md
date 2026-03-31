---
type: backlog-issue
id: "PM-070"
title: "API server + GitHub OAuth device flow"
outcome: "Plugin can authenticate users via GitHub and make authenticated API calls to the hub"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "auth"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

A hosted API server accepts authenticated requests from the PM plugin. Users authenticate via GitHub OAuth device flow — get a code, open browser, approve. The plugin stores a JWT in the system keychain and uses it for all subsequent API calls.

## Acceptance Criteria

1. API server runs as a Node.js HTTP service with JSON endpoints.
2. `POST /auth/device` initiates GitHub OAuth device flow, returns `device_code` + `user_code` + `verification_uri`.
3. `POST /auth/token` polls GitHub for token exchange, issues a PM JWT on success.
4. JWT contains: `user_id`, `github_id`, `github_username`, `exp`.
5. Auth middleware validates JWT on all `/files/*` endpoints. Returns 401 on invalid/expired tokens.
6. `GET /files/{path}` returns file content from storage provider.
7. `PUT /files/{path}` writes file content to storage provider (authenticated).
8. `LIST /files/?prefix={prefix}` returns file listing.
9. `DELETE /files/{path}` removes a file (authenticated).
10. `PM_TOKEN` environment variable bypasses device flow for CI/CD.
11. Token storage precedence: `PM_TOKEN` env var > system keychain (macOS Keychain / Linux secret-tool) > `~/.pm/credentials` file fallback. Each level is a testable AC.
12. HTTPS enforced in production. CORS configured for dashboard origin.
13. GitHub OAuth web flow (browser redirect) for v1 dashboard auth: `GET /auth/login` redirects to GitHub, `GET /auth/callback` exchanges code for token, sets session cookie. Requires same GitHub OAuth App with both device and web flow enabled, or a second app. This enables PM-076 (hosted dashboard).

## Technical Feasibility

**Build-on:** server.js hand-rolled HTTP patterns. `node:crypto` for JWT signing (use `jose` library for validation).

**Build-new:** GitHub OAuth app registration, device flow endpoints, JWT issuance, auth middleware, file CRUD endpoints.

**Risk:** First external dependencies introduced to the project (GitHub OAuth needs HTTPS calls). Keep dependency count minimal — `jose` for JWT is sufficient, use `node:https` for GitHub API calls.

## Research Links

- [Auth patterns research](pm/research/shared-context/findings.md)

## Notes

- GitHub OAuth App must be registered at github.com/settings/applications.
- Device flow is the CLI standard (used by Vercel, gh, Copilot).
- Token storage: macOS Keychain via `security` CLI, Linux via `secret-tool`, fallback to `~/.pm/credentials`.
- Depends on PM-069 (storage abstraction) for file endpoints.
