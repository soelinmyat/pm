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

A hosted API server (the Product Memory API) accepts authenticated requests from MCP servers and the web dashboard. Users authenticate via GitHub OAuth device flow from their terminal. The API handles auth, path guardrails, server-side caching, and diff-based writes with conflict detection.

## Acceptance Criteria

1. API server runs as a Node.js HTTP service with JSON endpoints. Lives in the `product-memory` repo (private).
2. `POST /auth/device` initiates GitHub OAuth device flow, returns `device_code` + `user_code` + `verification_uri`.
3. `POST /auth/token` polls GitHub for token exchange, issues a PM JWT on success.
4. JWT contains: `user_id`, `github_id`, `github_username`, `exp`.
5. Auth middleware validates JWT on all `/files/*` endpoints. Returns 401 on invalid/expired tokens.
6. `GET /files/?folder={prefix}` returns file listing for a folder.
7. `GET /files/{path}` returns full file content + ETag header.
8. `POST /files/{path}` creates a new file. API validates path matches allowed folder structure (research/, backlog/, strategy/, thinking/, etc.).
9. `PATCH /files/{path}` applies a diff. Requires `If-Match` ETag header. Returns 409 + both versions on conflict.
10. `DELETE /files/{path}` removes a file (with path guardrails).
11. Server-side cache (memory/Redis): reads served from cache (~5-10ms), invalidated on writes. S3 is only hit on cache miss.
12. `PM_TOKEN` environment variable bypasses device flow for CI/CD.
13. Token storage precedence: `PM_TOKEN` env var > system keychain (macOS Keychain / Linux secret-tool) > `~/.pm/credentials` file fallback.
14. HTTPS enforced in production. CORS configured for dashboard origin.
15. GitHub OAuth web flow (browser redirect) for v1 dashboard auth: `GET /auth/login` redirects to GitHub, `GET /auth/callback` exchanges code for token, sets session cookie. Enables PM-076 (hosted dashboard).

## Technical Feasibility

**Build-new:** GitHub OAuth app registration, device flow endpoints, JWT issuance, auth middleware, file CRUD + diff endpoints, path validation, server-side cache layer. ~500-800 lines for the core API.

**Risk:** Diff application on the server needs to be reliable. Use a simple line-based diff format that maps to how AI terminals already produce edits. Keep it minimal — not a full patch format.

## Research Links

- [Auth patterns research](pm/research/shared-context/findings.md)

## Notes

- GitHub OAuth App must be registered at github.com/settings/applications.
- Device flow is the CLI standard (used by Vercel, gh, Copilot).
- Token storage: macOS Keychain via `security` CLI, Linux via `secret-tool`, fallback to `~/.pm/credentials`.
- This is the core of the Product Memory server — most other issues depend on it.
- Conflict detection via ETag: terminal sends `If-Match` with the ETag from its last read. If file changed since, API returns 409 + both versions. Terminal's AI merges and resubmits.
