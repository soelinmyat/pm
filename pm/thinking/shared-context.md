---
type: thinking
topic: "Product Memory — Shared Knowledge Hub"
slug: shared-context
created: 2026-03-30
updated: 2026-04-03
status: active
promoted_to: null
---

# Product Memory — Shared Knowledge Hub

## Problem
PM's knowledge base (research, strategy, groomed issues, customer evidence) is local-only. Teammates can't benefit from each other's work. This blocks async product collaboration and limits PM to a solo tool — which also blocks monetization.

## Product framing
**Product Memory** — the shared brain your team builds up over time that any AI terminal can tap into. Your AI terminal forgets everything between sessions. Product Memory doesn't.

Not an AI product. A **workflow product that makes AI terminals useful for product work.** The AI comes from Claude Code, Codex, or whatever terminal the user brings. Product Memory provides the accumulated knowledge, opinionated workflows, and structured process.

**Positioning:** "The AI product engineer — from idea to merged PR." An execution engine for product development, powered by whatever AI terminal you use.

## Direction
**Hosted hub** — a cloud API + S3 storage with server-side caching that holds the shared `pm/` knowledge base. Terminals connect via MCP server (5 tools). No local sync or cache — API is always the source of truth.

## Architecture (revised 2026-04-03)

```
┌─────────────────┐     ┌─────────────────┐
│  Claude Code     │     │  Codex / other   │
└───────┬─────────┘     └───────┬──────────┘
        │                       │
        ▼                       ▼
┌──────────────────────────────────────────┐
│     MCP Server (local or hosted)          │
│  5 tools: list, read, create, edit,       │
│  delete — maps pm/ paths to API calls     │
└───────────────────┬──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│         API Bridge (Node.js)              │
│  - auth (workspace + user, JWT)           │
│  - path guardrails (enforce folder        │
│    structure)                              │
│  - conflict detection (ETag/version)      │
│  - server-side cache (memory/Redis)       │
│  - rejects on conflict → returns both     │
│    versions for AI-assisted merge         │
└───────────────────┬──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│              S3 (durable storage)         │
│  /ws-{id}/pm/{structured folders}/        │
│  + version metadata per file              │
│  S3 versioning enabled for rollback       │
└───────────────────┬──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│         Postgres (metadata only)          │
│  users, workspaces, billing, changelog    │
└──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│          Web Dashboard                    │
│  reads .md via API, renders rich UI       │
│  read-only for v1 (view layer)            │
└──────────────────────────────────────────┘
```

**Key architectural decisions (revised):**

| Decision | Old (March 30) | New (April 3) | Why |
|----------|----------------|---------------|-----|
| Terminal bridge | CLI commands (`pm push/pull`) | MCP server (5 tools) | Terminal-agnostic. Works with any AI that speaks MCP. No plugin changes needed. |
| Sync model | Pull on skill start, push after writes | No local sync. API is source of truth. | Eliminates cache invalidation, staleness, sync bugs. Simpler. |
| Write mechanism | Full file PUT | Diff-based edit | Smaller payloads, granular conflict detection (two edits to different sections = no conflict) |
| Caching | Client-side (.pm/cache/) | Server-side (memory/Redis in API) | One cache to manage, not N clients. API serves ~5-10ms reads. S3 is just durable storage. |
| Search | Not addressed | Not needed — AI terminal is the search engine | Terminal calls `list`, reads file names, picks relevant ones, reads content. The AI does the searching. |

**MCP tool surface (5 tools):**

| Tool | Purpose |
|------|---------|
| `list(folder?)` | Returns file names + paths in a folder |
| `read(path)` | Returns full file content |
| `edit(path, diff)` | Apply diff — API handles conflict detection |
| `create(path, content)` | New file — API enforces path guardrails |
| `delete(path)` | Remove file (with guardrails) |

**Serving layer vs storage layer:**
- S3 is the **storage layer** — cheap, durable, versioned, never loses data
- API + cache is the **serving layer** — fast reads (~5-10ms), handles auth, validates paths
- Terminals never talk to S3 directly

**Conflict resolution:**
- API detects conflicts via ETag/version mismatch on edit
- Rejects stale write, returns both versions (current + attempted)
- Terminal's AI merges the two versions intelligently
- Terminal resubmits merged version
- Agent-as-merge-layer — no conflict UI needed

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
| Team | $10/mo flat | Up to 5 members, shared knowledge base, web dashboard |
| Scale | $100/mo flat | Up to 20 members |

No feature gating. Solo is fully functional. Not per-seat — flat rate per tier.

**Infra cost:** ~$5-10/mo (Railway/Fly) + free R2/S3 tier + free Neon Postgres tier. Near zero at small scale.

## Key design decisions
- **Seamless onboarding.** Install plugin, login, work. Agent sessions are immediately smarter.
- **Agent-as-merge-layer.** No conflict UI. AI terminal reads both versions, merges intelligently, resubmits.
- **MCP-first.** Terminal connects via MCP, not custom CLI commands. Any AI terminal that speaks MCP works.
- **No local cache.** API is source of truth. Server cache handles performance. Eliminates sync complexity.
- **Diff-based writes.** Smaller payloads, granular conflicts, matches how AI terminals already work.
- **No permissions at launch.** All-or-nothing access. Add later.
- **Cross-repo.** Workspace → projects hierarchy. Each repo maps to a project. Strategy can span projects.
- **No git on server.** S3 + Postgres is simpler. Git stays on the client side.
- **S3 versioning for safety.** Free undo. Agent overwrites a file badly? Restore previous version.
- **Dashboard stays read-only.** All writes come from terminals. Protects editor-native positioning.

## Complexity estimate
Not complex. The whole system is auth + file CRUD + S3 + a cache layer.

| Component | What it is | Lines (est.) |
|-----------|-----------|-------------|
| API server + S3 + cache | 5 endpoints, Redis/memory cache | ~500-800 |
| Auth + workspace routing | GitHub OAuth, JWT, workspace resolution | ~300-400 |
| MCP server (5 tools) | Thin HTTP client wrapping the API | ~200-300 |
| Web dashboard | Adapt existing dashboard code | Existing |

Weekend-to-week build. One server (or Lambdas), one S3 bucket, optionally Redis.

## Killer workflows
- You groom → teammate's `/dev` picks up groomed issues with full context
- Teammate researches → your grooming auto-benefits from their findings
- You write strategy → everyone's Claude sessions align to same priorities
- Agent accidentally overwrites research → restore previous S3 version
- Switch from Claude Code to Codex → same Product Memory, different terminal

## Research backing
Full findings at `pm/research/shared-context/findings.md` (26 sources across 5 areas).

Key findings:
1. No AI tool shares product knowledge — only coding context (rules in git)
2. CRDTs/OT overkill for async agent collaboration — diff + ETag conflict detection is sufficient
3. Flat-rate $10-100/mo aligns with market (Linear $8-16, Notion $10-18)
4. GitHub OAuth device flow is the CLI standard (Vercel, gh, Copilot)
5. Zero-config team detection from git remote is a greenfield differentiator

## Repo structure (landed)

| Repo | What | Visibility |
|------|------|-----------|
| **pm** (current) | Plugin + MCP server (local/remote router) | Open source |
| **product-memory** (new) | API bridge + S3 + Postgres + web dashboard | Private |

- Plugin stays open source — drives adoption, builds trust
- MCP server lives in the plugin repo, routes to local filesystem OR remote API based on config
- Product Memory server is a separate private repo — the monetizable backend
- Solo/local use works without the server (current behavior, free forever)
- Team/multi-machine use requires the server (paid tiers)
- Open-core model: free client, paid cloud (same as Sentry, GitLab, PostHog)

## Open questions
- Self-hosted option for enterprise? Plan architecturally even if not offered at launch.
- E2E encryption? Adds trust but complexity.
- Migration path from local pm/ → hub? One-time upload, hub becomes source of truth.
- Agent write batching? Multiple concurrent agents could create noise.

## Next step
Create the `product-memory` repo and build the API server (~1000-1500 lines, weekend build).
