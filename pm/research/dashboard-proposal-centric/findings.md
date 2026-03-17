---
type: topic-research
topic: Dashboard Proposal-Centric Redesign
created: 2026-03-16
updated: 2026-03-16
source_origin: external
sources:
  - url: https://support.productboard.com/hc/en-us/articles/25194993652627-Initiative-management-in-Productboard
    accessed: 2026-03-16
  - url: https://www.uxpin.com/studio/blog/dashboard-design-principles/
    accessed: 2026-03-16
  - url: https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards
    accessed: 2026-03-16
  - url: https://dashboarddesignpatterns.github.io/
    accessed: 2026-03-16
  - url: https://amir-rozenberg.medium.com/how-to-build-a-complete-product-story-on-one-view-and-align-your-organization-with-productboard-494f65bc3db5
    accessed: 2026-03-16
  - url: https://www.lazarev.agency/articles/dashboard-ux-design
    accessed: 2026-03-16
  - url: https://www.notionland.co/templates/product-discovery-system
    accessed: 2026-03-16
  - url: https://yetidistro.com/product-discovery-template
    accessed: 2026-03-16
---

# Dashboard Proposal-Centric Redesign

## Summary

The dominant pattern in product tools is "initiative-centric" — a mid-level artifact (between strategy and tasks) that groups related work and tells a coherent story. Productboard's initiative management, Notion's discovery systems, and modern dashboard UX patterns all converge on the same insight: the hero artifact should be the one that connects "why" to "what," not the individual task. For PM plugin, that artifact is the proposal.

## Findings

1. **[external] Productboard's initiative model validates the proposal-as-hero pattern.** Productboard places "initiatives" between objectives (strategy) and features (tasks). Initiatives are the connective tissue — they tell the story of why a set of features exists. Their new UI includes Document boards as "single source of truth" for product documentation, integrating discovery output with delivery planning. PM's proposals serve exactly this role: they connect strategy/research to issues.

2. **[external] The "5-7 tiles" rule applies to dashboard home pages.** Dashboard UX research consistently recommends 5-7 key elements per view to avoid cognitive overload. The current PM dashboard's flat structure (research, competitors, strategy, backlog as equal peers) violates this by presenting too many entry points without hierarchy. A proposal-centric home with 3-4 primary tiles (active session, recent proposals, quick actions) would be more focused.

3. **[external] Card-based gallery layouts are the proven pattern for showcasing structured documents.** Portfolio sites, Dribbble, Figma's community, and Notion templates all use card grids with preview images/gradients to surface documents. Each card shows: title, status, key metadata, and a visual preview. This maps directly to proposal cards showing: feature name, hero gradient, verdict badges, and date.

4. **[external] The "active work" pattern belongs at the top.** Modern SaaS dashboards consistently place "what's happening now" above historical data. GitHub's dashboard leads with recent activity, Linear leads with current cycle, Productboard leads with active initiatives. PM's home should lead with the active grooming session (if any), not a static stats page.

5. **[external] Hierarchical navigation beats flat tabs for multi-level content.** Dashboard UX research shows that as content depth increases, flat navigation (equal tabs) becomes disorienting. A two-level structure — primary nav (Home, Proposals, Backlog, Knowledge Base) with secondary content within each — provides orientation without hiding content. This replaces the current flat structure where Research, Competitors, Strategy, and Backlog are all peers.

6. **[external] Productboard Spark transforms ideas into initiative briefs then into PRDs — same pipeline as PM groom.** Spark's workflow (idea → initiative brief → PRD → features) mirrors groom's flow (idea → scope → proposal → issues). The key UX learning: Spark surfaces the initiative brief prominently, not the individual features. The brief is what gets reviewed and approved. PM should do the same with proposals.

7. **[external] Document boards as integration layer.** Productboard's Document boards bring together product teams and cross-functional stakeholders in a unified space. This validates the proposal HTML presentation as the integration artifact — it embeds wireframes, flows, competitive context, and issues in one shareable view.

## Strategic Relevance

This directly supports Priority 2 (quality of groomed output). The proposal is PM's highest-quality artifact — the result of research, strategy alignment, scoping, multi-layer review, and bar raiser approval. Currently, the dashboard hides this artifact in the backlog. Making it the centerpiece would:
- Showcase PM's differentiation (no competitor produces proposals this thorough)
- Give users a reason to revisit the dashboard (proposal gallery as project portfolio)
- Create a natural sharing mechanism (send proposal URL to stakeholders)

## Implications

1. **Dashboard home should be "what's cooking" not "what do we know."** Lead with active grooming session + recent proposals. Knowledge base (research, strategy, competitors) becomes a reference shelf, not the landing page.

2. **Proposals need a gallery view — cards with hero gradient previews.** Each card shows the proposal's hero header (gradient + title) as a thumbnail, plus verdict badges and date. Click opens the full HTML presentation.

3. **Backlog should be grouped by proposal, not flat kanban.** Issues make more sense when shown under their parent proposal. The proposal provides context that individual issues lack.

4. **Navigation restructure: Home → Proposals → Backlog → Knowledge Base.** Four primary sections instead of five equal tabs. Knowledge Base contains Research, Competitors, and Strategy as sub-pages.

5. **The proposal HTML file is the shareable artifact.** It should be viewable standalone (already works) and embedded in the dashboard. The dashboard becomes a curated gallery of these artifacts.

## Open Questions

1. Should the dashboard show proposal "drafts" (in-progress grooming sessions) or only completed proposals?
2. How should proposal status flow work? (in-review → approved → shipped → archived?)
3. Should the backlog kanban still exist as a view, or is proposal-grouped the only view?
4. How do standalone backlog items (not from groom) fit in the proposal-centric model?
