---
type: backlog-issue
id: "PM-076"
title: "Hosted dashboard (read-only, reads from S3)"
outcome: "Team members can view the shared knowledge base in a browser without running a local server"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "dashboard"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

The existing dashboard server deploys as a hosted web app. It reads from S3 instead of the local filesystem, serving the team's shared knowledge base at a URL like `app.productmemory.io/{project-slug}`. Dashboard is read-only — all writes go through the CLI.

## Acceptance Criteria

1. Dashboard reads files via the Product Memory API (using ApiStorageProvider from PM-069), NOT directly from S3.
2. Auth required — GitHub OAuth web flow (not device flow) for browser login.
3. Project selection: user sees their projects, picks one.
4. All existing dashboard pages work: home, KB, research, competitors, backlog, strategy deck.
5. Dashboard is strictly read-only. No edit, create, or delete actions in the UI.
6. Deployed to Railway/Fly with a custom domain.
7. Solo users keep localhost dashboard (zero change to current experience — LocalStorageProvider).

## Technical Feasibility

**Build-on:** `scripts/server.js` — entire dashboard rendering pipeline. PM-069 (storage abstraction) makes the fs→API swap possible.

**Build-new:** GitHub OAuth web flow (browser redirect, not device flow), ApiStorageProvider implementation, project picker UI, deployment config.

## Notes

- Dashboard reads from API (server-side cached, ~5-10ms) — not directly from S3.
- Competitive review condition: dashboard must stay read-only to protect editor-native positioning.
- This is the visible product surface that justifies payment for teams.
- Depends on PM-069 (storage abstraction) and PM-070 (API).
