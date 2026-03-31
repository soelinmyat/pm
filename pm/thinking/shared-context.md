---
type: thinking
topic: "Shared Context — Team Knowledge Hub"
slug: shared-context
created: 2026-03-30
status: active
promoted_to: null
---

# Shared Context — Team Knowledge Hub

## Problem
PM's knowledge base (research, strategy, groomed issues, customer evidence) is local-only. Teammates can't benefit from each other's work. This blocks async product collaboration and limits PM to a solo tool — which also blocks monetization.

## Direction
**Hosted hub** — a cloud API + S3 storage that holds the shared `pm/` knowledge base. Every teammate's plugin connects to it. The experience is identical to solo PM today, except the knowledge base is shared.

**Core framing:** Shared context, agent-first, human-readable. Not a dashboard to look at — the shared context that makes every teammate's agent smarter.

## Architecture (landed)

```
Plugin (CLI)  ── HTTPS API ──  PM Hub (Node.js)  ── S3 (versioned, one bucket)
                                     │               teams/{id}/projects/{id}/pm/
                                     │
Browser       ── HTTPS ──────  Dashboard (same server, reads from S3)
                                     │
                               Postgres (metadata only)
```

**Storage:** One S3 bucket, prefixed by team/project. Versioning enabled for free rollback. No git on server. No document DB.

| What | Where |
|------|-------|
| All pm/ files (markdown, HTML) | S3 (versioned) |
| Team/user records, billing | Postgres |
| File index (path, hash, who, when) | Postgres |
| Changelog | Postgres |

**Sync protocol:** Not git, not CRDTs. Simple REST API.
- Plugin pulls latest files on skill start
- Agent merges locally before pushing (agent-as-merge-layer)
- `PUT /files/{path}` stores new version, logs to changelog

**Versioning (3 layers):**
1. **Changelog** (always on) — every write logged: who, what, when
2. **S3 versioning** (always on) — every overwrite keeps previous version, restore with one API call
3. **Snapshots** (user-triggered, later) — named full-state backups before risky operations

**Dashboard:** Same server.js code deployed as hosted web app. Solo users keep localhost. Team users get `app.pm-tool.com/{team}`. Same code, different data source (S3 API vs local filesystem).

## Auth (landed)

1. `pm login` → GitHub OAuth device flow → JWT
2. Auto-detect team from git remote + GitHub org membership (novel — no tool does this)
3. `pm team create` → creates team in Postgres + S3 prefix + invite link
4. `pm team join {code}` → adds teammate
5. `PM_TOKEN` env var override for CI/CD
6. Tokens stored in system keychain (macOS Keychain, Linux Secret Service)

## Pricing (landed)

| Tier | Price | What |
|------|-------|------|
| Free (solo) | $0 | All features, no limits, local knowledge base |
| Team | $10-15/seat/mo | Shared knowledge base, cross-repo strategy, team dashboard (web) |

No feature gating. Solo is fully functional. Team is triggered when a second person connects. No enterprise tier at launch.

**Infra cost:** ~$5-10/mo (Railway/Fly) + free R2/S3 tier + free Neon Postgres tier. Near zero at small scale.

## Key design decisions
- **Seamless onboarding.** Install plugin, login, work. Agent sessions are immediately smarter.
- **Agent-as-merge-layer.** No conflict UI. Agent reads current state, merges intelligently, pushes.
- **No permissions at launch.** All-or-nothing access. Add later.
- **Cross-repo.** Team → projects hierarchy. Each repo maps to a project. Strategy can span projects.
- **No git on server.** S3 + Postgres is simpler. Git stays on the client side.
- **S3 versioning for safety.** Free undo. Agent overwrites a file badly? Restore previous version.

## Killer workflows
- You groom → teammate's `/dev` picks up groomed issues with full context
- Teammate researches → your grooming auto-benefits from their findings
- You write strategy → everyone's Claude sessions align to same priorities
- Agent accidentally overwrites research → `pm restore` recovers previous version

## Research backing
Full findings at `pm/research/shared-context/findings.md` (26 sources across 5 areas).

Key findings:
1. No AI tool shares product knowledge — only coding context (rules in git)
2. CRDTs/OT overkill for async agent collaboration — git-level merge is sufficient
3. Per-seat $10-15/mo aligns with market (Linear $8-16, Notion $10-18)
4. GitHub OAuth device flow is the CLI standard (Vercel, gh, Copilot)
5. Zero-config team detection from git remote is a greenfield differentiator

## Open questions
- Self-hosted option for enterprise? Plan architecturally even if not offered at launch.
- E2E encryption? Adds trust but complexity.
- Migration path from local pm/ → hub? Copy-up once, hub becomes source of truth?
- Agent write batching? Multiple concurrent agents could create noise.
- Offline mode? Local cache with sync-on-reconnect?

## Next step
Groom this into implementation issues.
