---
type: competitor-index
created: 2026-03-13
updated: 2026-03-13
---

# Competitors

| Name | Slug | Tier | Profiled | Description |
|---|---|---|---|---|
| [PM Skills Marketplace](pm-skills-marketplace/profile.md) | pm-skills-marketplace | Direct | 2026-03-13 | Claude Code plugin with 65+ PM framework skills — same platform, same audience, different architecture |
| [ChatPRD](chatprd/profile.md) | chatprd | Adjacent | 2026-03-13 | AI PRD generation and PM coaching platform — web app + MCP, 100K+ users, $15/mo |
| [Productboard Spark](productboard-spark/profile.md) | productboard-spark | Adjacent | 2026-03-13 | Agentic AI PM agent with competitive research and knowledge base — web SaaS, $15-19/mo |

## Profiles

Each competitor has 5 files:
- `profile.md` — Company overview, positioning, pricing, strengths, weaknesses
- `features.md` — Detailed feature inventory
- `seo.md` — SEO and distribution analysis
- `sentiment.md` — User sentiment and community reception
- `api.md` — API, integration, and extensibility analysis

## Market Gaps

Capabilities absent or weak across all profiled competitors:

1. **No persistent, version-controlled knowledge base.** PM Skills Marketplace is session-scoped. ChatPRD stores documents in its cloud but without Git-like versioning. Productboard Spark has organizational memory but no export or version control. None maintain a structured, file-system-based product knowledge base that lives alongside the codebase.

2. **No automated SEO/keyword research integration.** None of the three competitors connect to SEO data sources (Ahrefs, Semrush, etc.) for market demand validation or competitive keyword analysis. Product Memory is the only tool in this space with live SEO intelligence.

3. **No multi-agent parallel research.** PM Skills Marketplace runs skills sequentially. ChatPRD is single-agent. Productboard Spark runs Jobs one at a time. PM's parallel researcher dispatch for competitor profiling is architecturally unique.

4. **No landscape or positioning visualization.** None produce market positioning maps, bubble charts, or visual competitive landscapes. All output is text or tabular.

5. **No strategy-to-grooming pipeline.** PM Skills Marketplace generates strategy frameworks per-session but doesn't connect them to feature grooming. ChatPRD generates PRDs but not from a persisted strategy. Productboard Spark generates briefs but can't write back to the system of record. Product Memory is the only tool that chains strategy → research → groom into a connected workflow.

6. **No customer evidence ingestion pipeline.** PM Skills Marketplace and ChatPRD require manual input of customer data. Productboard Spark has 20+ native feedback integrations but those belong to the core platform, not Spark. No competitor has an `ingest` command that normalizes raw evidence files into structured research.

7. **Thin analytics/data coverage.** PM Skills Marketplace has only 3 analytics skills (SQL, cohorts, A/B tests) — all template generators, none execute queries. ChatPRD has no analytics features. Productboard Spark has planned Amplitude MCP but not yet available.

See [matrix.md](matrix.md) for the full feature comparison table.
