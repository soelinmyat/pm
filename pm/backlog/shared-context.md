---
type: backlog-issue
id: "PM-068"
title: "Shared Context: Remote Knowledge Base"
outcome: "Users can access their PM knowledge base from any machine, and later share it with teammates"
status: drafted
parent: null
children:
  - "shared-context-project-bootstrap"
  - "shared-context-storage-abstraction"
  - "shared-context-api-auth"
  - "shared-context-s3-backend"
  - "shared-context-postgres-metadata"
  - "shared-context-cli-commands"
  - "shared-context-project-detection"
  - "shared-context-team-sharing"
  - "shared-context-hosted-dashboard"
  - "shared-context-billing"
  - "shared-context-changelog-restore"
  - "shared-context-deployment"
labels:
  - "epic"
  - "infrastructure"
  - "monetization"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

Users can push their local `pm/` knowledge base to a cloud hub and pull it on any machine. In v1, a second user can join the project and benefit from the shared knowledge — making every teammate's agent sessions smarter from day one.

## Acceptance Criteria

1. v0: Single user can `pm login`, `pm push`, `pm pull` across machines.
2. v0: Project auto-detected from git remote URL.
3. v0: S3 versioning protects against accidental overwrites.
4. v1: Second user can join a project via invite link.
5. v1: Team dashboard available as hosted web app (read-only).
6. v1: Billing enforced — free solo, $10/mo flat for up to 5 members, $100/mo flat for up to 20 members. Not per-seat — flat rate per tier.

## Architecture

```
Plugin (CLI)  ── HTTPS API ──  PM Hub (Node.js)  ── S3 (versioned)
                                     │
                               Postgres (metadata)
```

- S3: one bucket, `users/{id}/projects/{id}/pm/` prefixes
- Postgres: users, projects, user_projects (v0); + changelog, billing (v1)
- Auth: GitHub OAuth device flow → JWT
- Dashboard: read-only view layer, all writes via CLI

## Pricing

| Tier | Price | Members | Projects |
|------|-------|---------|----------|
| Solo | Free | 1 | Unlimited |
| Team | $10/mo | Up to 5 | Unlimited |
| Scale | $100/mo | Up to 20 | Unlimited |

## Success Criteria (90 days post-v0)

- 10+ users running `pm push` on real projects
- 3+ users accessing from multiple machines
- Zero data loss incidents

## Competitor Context

No AI coding tool shares product knowledge today. Every competitor shares coding context only:
- **Cursor** ($40/user): `.cursor/rules/` in git. No knowledge base.
- **GitHub Copilot** ($19-39/user): Copilot Spaces for coding context. Not product knowledge.
- **Claude Code** ($150/user premium): CLAUDE.md in git. No shared product brain.
- **Windsurf** ($40/user): Rules + 50 Google Docs (beta). No structured knowledge base.
- **Tabnine** ($39-59/user): Enterprise Context Engine for code topology. Not product decisions.

PM would be the first tool to share research, strategy, competitive intel, and groomed issues across a team. The combination of shared product knowledge + dev lifecycle integration + editor-native is not trivially copyable.

## Research Links

- [Shared Context Research](pm/research/shared-context/findings.md)
- [Thinking Artifact](pm/thinking/shared-context.md)

## Notes

- v0 validates demand before v1 investment (scope review feedback)
- Dashboard must stay read-only — protects editor-native positioning (competitive review)
- Agent-as-merge-layer is a marketable differentiator (competitive review)
- Storage abstraction is foundational — must ship first (EM review)
