---
type: topic-research
topic: Shared Context — Team Knowledge Hub
created: 2026-03-30
updated: 2026-03-30
source_origin: external
sources:
  - url: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
    accessed: 2026-03-30
  - url: https://www.notion.com/blog/data-model-behind-notion
    accessed: 2026-03-30
  - url: https://github.com/wzhudev/reverse-linear-sync-engine
    accessed: 2026-03-30
  - url: https://www.inkandswitch.com/upwelling/
    accessed: 2026-03-30
  - url: https://josephg.com/blog/crdts-are-the-future/
    accessed: 2026-03-30
  - url: https://arxiv.org/html/2409.14252v1
    accessed: 2026-03-30
  - url: https://akka.io/blog/event-sourcing-the-backbone-of-agentic-ai
    accessed: 2026-03-30
  - url: https://cursor.com/docs/context/rules
    accessed: 2026-03-30
  - url: https://docs.github.com/en/copilot/concepts/context/spaces
    accessed: 2026-03-30
  - url: https://code.claude.com/docs/en/settings
    accessed: 2026-03-30
  - url: https://workos.com/blog/best-practices-for-cli-authentication-a-technical-guide
    accessed: 2026-03-30
  - url: https://linear.app/developers/oauth-2-0-authentication
    accessed: 2026-03-30
  - url: https://www.growthunhinged.com/p/2025-state-of-saas-pricing-changes
    accessed: 2026-03-30
  - url: https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/
    accessed: 2026-03-30
  - url: https://plugins.jetbrains.com/docs/marketplace/plugin-monetization.html
    accessed: 2026-03-30
  - url: https://www.gitbook.com/features/git-sync
    accessed: 2026-03-30
  - url: https://relay.md/
    accessed: 2026-03-30
  - url: https://help.obsidian.md/Obsidian+Sync/Security+and+privacy
    accessed: 2026-03-30
---

# Shared Context — Team Knowledge Hub

## Summary

No AI coding tool has built a compelling shared product knowledge base beyond git-committed config files. The market gap is real. For PM's async, agent-driven, markdown-based knowledge base, CRDTs and OT are overkill — git + event sourcing + agent-as-merge-layer is the right architecture. Pricing should be per-seat with a generous free tier. Auth should use GitHub OAuth with device flow for CLI.

## Findings

### 1. Sync Protocol: Git + Event Sourcing Wins

CRDTs solve real-time character-level co-editing. PM doesn't need that — agents write whole files asynchronously. The overhead (16-32 bytes per character metadata, tombstone management) doesn't pay off.

**The right stack:**
- **Git as sync layer.** Agents commit changes. Git's 3-way merge handles non-conflicting edits. Git log is a free audit trail.
- **File-level granularity prevents conflicts.** Each concern gets its own file (PM already does this). Two agents editing different files = zero conflicts. This is Notion's block model applied to a filesystem.
- **Agent-as-merge-layer.** When conflicts occur, the AI agent re-reads the conflicting file and regenerates its changes against the updated state. This is a superpower humans don't have.
- **Append-only JSONL changelog** for event sourcing. Records what changed, who, and why. Enables time-travel and AI context reconstruction without a heavy event store.

**When to upgrade to CRDTs:** Only if PM needs real-time co-editing of the same document (human + agent simultaneously editing strategy.md). At that point, Eg-walker (Diamond Types / Loro) is the most promising: 1-2 orders of magnitude less memory than traditional CRDTs, loads as fast as plain text.

| Protocol | Real-time co-edit | Offline | Complexity | Our need |
|----------|------------------|---------|------------|----------|
| CRDTs (Yjs, Automerge) | Yes | Yes | High | Overkill |
| OT (Google Docs) | Yes | No | High | Irrelevant |
| Event sourcing | No | Depends | Medium | Close fit |
| Git-based | No | Yes | Low | Best fit |

### 2. No AI Tool Has Shared Product Knowledge

Every AI coding tool shares context through git-committed files. None has a centralized team knowledge layer.

| Tool | Team price | Sharing mechanism | Knowledge base |
|------|-----------|-------------------|---------------|
| Cursor | $40/user/mo | `.cursor/rules/` in git | No |
| Windsurf | $40/user/mo | `.windsurfrules` in git | 50 Google Docs (beta) |
| GitHub Copilot | $19-39/user/mo | Copilot Spaces + org instructions | Spaces (mixed content) |
| Claude Code | $150/user/mo (Premium) | CLAUDE.md in git | No |
| Tabnine | $39-59/user/mo | Enterprise Context Engine | Structured knowledge model |
| Sourcegraph Cody | $19-59/user/mo | Code search index | Multi-repo search |
| Superpowers/GStack | Free (OSS) | Git clone | No |

**Key gap:** Git-committed rules share AI behavior. Nothing shares product knowledge (research, strategy, competitive intel, groomed issues) across a team. PM would be the first.

**GitHub Copilot Spaces** is the closest attempt — mixed-content knowledge bases with RBAC. But Spaces are for coding context, not product knowledge. They replaced Knowledge Bases in Aug 2025.

**Tabnine's Enterprise Context Engine** builds a structured model of an org's software (repo structure, service architecture, dependency graphs). Closest to "shared product brain" but focused on code topology, not product decisions.

### 3. Pricing: Per-Seat with Generous Free Tier

**The macro trend:** Per-seat pricing is declining (21% → 15% of companies in 12 months). Hybrid pricing surged from 27% to 41%. But for PM's use case, per-seat is right because:
- Value scales with team size (more contributors = richer knowledge base)
- No significant compute cost to pass through (unlike AI inference)
- CFOs want predictable per-employee costs
- The team tax pattern is well-established (1.5-2x individual → team)

**Recommended model:**
- **Free:** Solo use, fully functional, no degradation. All features.
- **Team:** $10-15/seat/month. Triggered when a second person connects.
- **No enterprise tier at launch.** Add SSO/SAML/audit logging when customers ask.

**Conversion benchmarks:** Freemium self-serve median is 2-5%. Top performers hit 6-8%. PostHog's model (all features free, volume-gated) achieves higher conversion than feature-gated models.

**Plugin monetization landscape:** VS Code has no native paid extension support. JetBrains Marketplace is the only major ecosystem with built-in licensing (15% commission). The MCP ecosystem is nascent — 21st.dev monetizes an MCP server at $20/mo with usage gating. PM would need external payment infrastructure (Stripe + own auth).

| Dev tool | Individual | Team | Multiplier |
|----------|-----------|------|-----------|
| Cursor | $20/mo | $40/user/mo | 2.0x |
| GitHub Copilot | $10/mo | $19/user/mo | 1.9x |
| Linear | $8/user | $16/user | 2.0x |
| Notion | $10/user | $18/user | 1.8x |
| **PM (proposed)** | **Free** | **$10-15/user/mo** | **N/A (free → paid)** |

### 4. Auth: GitHub OAuth + Device Flow

**Recommended stack:** Custom JWT + GitHub OAuth. Simplest production-ready approach.

1. **GitHub OAuth Device Flow** for CLI auth. User gets a code, opens browser, approves. CLI polls until approved. Works in headless/SSH environments.
2. **Check org membership** via `read:org` scope or admin token to detect team.
3. **Issue short-lived JWTs** with team/org claims. Store in system keychain.
4. **Environment variable override** for CI/CD (`PM_TOKEN`).

**Device flow is the CLI standard.** Used by Vercel CLI, gh CLI, GitHub Copilot CLI. Well-documented, free.

**Zero-config team detection is a greenfield opportunity.** No mainstream tool auto-detects team membership from git remote + GitHub org. PM could: parse `git remote get-url origin` → extract `github.com/{org}/{repo}` → verify org membership via GitHub API → auto-associate team. This would be genuinely novel.

**Token storage precedence (standard pattern):**
1. `PM_TOKEN` env var (CI/CD)
2. System keychain (macOS Keychain, Linux Secret Service)
3. Fallback to `~/.pm/credentials`

**When to add a third-party auth provider:** Only if you need enterprise SSO/SAML. WorkOS AuthKit is the best fit for CLI-first tools with web dashboard plans.

### 5. Collaboration Patterns: File-Level Granularity Is Key

**The universal lesson:** Preventing conflicts (via granularity) beats resolving them (via CRDTs/OT).

| Tool | Granularity | Conflict strategy | Server role |
|------|------------|-------------------|-------------|
| Notion | Block (paragraph) | LWW per block, CRDT for offline | Authoritative |
| Linear | Property (field) | LWW per property, sync ID ordering | Authoritative |
| Figma | Property per object | LWW register | Authoritative |
| Obsidian Sync | File | diff-match-patch merge | Relay |
| GitBook | File + branch | Git merge + PR review | Git host |

**For PM's knowledge base:**
- **File-level granularity** = each concern in its own file (already done)
- **Section ownership** = if two agents edit the same file, YAML frontmatter defines who owns which section
- **Last-write-wins** for metadata fields (status, priority) with `updated_at` timestamps
- **Append-only patterns** for shared files (research findings = log-style entries, not shared paragraphs)
- **Git as sync protocol** = commit per logical change, merge via the hosted hub

**GitBook is the closest architectural precedent.** Structured markdown, git backend, branch-based changes, WYSIWYG layer (dashboard) on top. But PM is simpler — agents are the primary writers, not humans.

## Strategic Relevance

Directly supports the product strategy's vision of PM as the "only editor-native tool covering the full product lifecycle." Shared context makes PM a team tool, not just a personal productivity enhancer. This is the natural expansion from ICP (solo product engineer) to secondary segment (small squads of 2-5).

**Competitive moat:** No AI coding tool shares product knowledge. They share coding context (rules, codebase indexing). PM would own the "shared product brain" category.

## Implications

1. **Architecture is simpler than expected.** No need for CRDTs, OT, or real-time sync infrastructure. Git + a lightweight API server + agent merge logic.
2. **Auth is solved.** GitHub OAuth device flow is the standard. Zero-config team detection from git remote is a differentiator.
3. **Pricing has a clear model.** Free solo → $10-15/seat team. No feature gating — volume/team gating only.
4. **Plugin monetization requires own infra.** No major marketplace supports native paid plugins. Stripe + own auth + license checking in the plugin.
5. **The dashboard becomes the team hub.** Migrate from localhost to a hosted web app. This is both the collaboration surface and the thing that justifies payment.
6. **Start with async, add real-time later.** Git-based sync for v1. Add real-time (Eg-walker/Yjs) only if customers need simultaneous editing.

## Open Questions

1. **Self-hosted option?** Enterprise teams may want to host the hub themselves. Plan for it architecturally even if not offered at launch.
2. **Encryption at rest?** Obsidian Sync uses E2E encryption. Should PM? Adds complexity but builds trust.
3. **Migration path from local.** How does an existing solo user "upgrade" their local `pm/` to a shared hub? Copy-up once, then the hub is the source of truth?
4. **Rate limiting for agents.** Multiple agents writing concurrently could create commit noise. Batch/debounce strategy needed.
5. **Billing infrastructure.** Stripe subscription management, seat counting, trial periods — this is non-trivial to build.

## Source References

### Sync Protocols
- https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ — accessed 2026-03-30
- https://josephg.com/blog/crdts-are-the-future/ — accessed 2026-03-30
- https://arxiv.org/html/2409.14252v1 — Eg-walker paper, accessed 2026-03-30
- https://github.com/dmonad/crdt-benchmarks — CRDT benchmarks, accessed 2026-03-30
- https://akka.io/blog/event-sourcing-the-backbone-of-agentic-ai — accessed 2026-03-30
- https://mattweidner.com/2025/05/21/text-without-crdts.html — accessed 2026-03-30

### AI Tool Team Features
- https://cursor.com/docs/context/rules — accessed 2026-03-30
- https://docs.github.com/en/copilot/concepts/context/spaces — accessed 2026-03-30
- https://code.claude.com/docs/en/settings — accessed 2026-03-30
- https://docs.windsurf.com/context-awareness/overview — accessed 2026-03-30
- https://www.tabnine.com/blog/introducing-the-tabnine-enterprise-context-engine/ — accessed 2026-03-30

### Pricing
- https://www.growthunhinged.com/p/2025-state-of-saas-pricing-changes — accessed 2026-03-30
- https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/ — accessed 2026-03-30
- https://plugins.jetbrains.com/docs/marketplace/plugin-monetization.html — accessed 2026-03-30
- https://cline.bot/blog/building-the-mcp-economy-lessons-from-21st-dev-and-the-future-of-plugin-monetization — accessed 2026-03-30

### Auth Patterns
- https://workos.com/blog/best-practices-for-cli-authentication-a-technical-guide — accessed 2026-03-30
- https://linear.app/developers/oauth-2-0-authentication — accessed 2026-03-30
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps — accessed 2026-03-30

### Collaboration Architecture
- https://www.notion.com/blog/data-model-behind-notion — accessed 2026-03-30
- https://www.notion.com/blog/how-we-made-notion-available-offline — accessed 2026-03-30
- https://github.com/wzhudev/reverse-linear-sync-engine — accessed 2026-03-30
- https://www.gitbook.com/features/git-sync — accessed 2026-03-30
- https://relay.md/ — accessed 2026-03-30
- https://help.obsidian.md/Obsidian+Sync/Security+and+privacy — accessed 2026-03-30
