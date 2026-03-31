---
type: backlog-issue
id: "PM-083"
title: "Dogfooding showcase — real PM artifacts on landing page"
outcome: "Visitors see concrete proof that PM manages its own product lifecycle — real groom proposals, dashboard views, and research findings displayed as screenshots with captions, making the dogfooding claim verifiable and compelling"
status: drafted
parent: "landing-page"
children: []
labels:
  - "gtm"
  - "marketing"
priority: medium
research_refs:
  - pm/research/landing-page/findings.md
created: 2026-03-31
updated: 2026-03-31
---

## Outcome

The dogfooding section of productmemory.com shows 3 real screenshots of PM output — a groom proposal, the knowledge base dashboard, and a research finding — each with a caption explaining what it is and that PM generated it for itself. Visitors can see what PM actually produces, not just read about it.

## Acceptance Criteria

1. 3 screenshots captured from real PM usage: (a) a groom proposal HTML, (b) the dashboard home view, (c) a research findings page.
2. Screenshots are high-quality PNGs, cropped to content area (no browser chrome), saved to `site/images/`.
3. Each screenshot has a caption: bold title + one-sentence description mentioning PM self-management.
4. Dogfooding section heading: "Built with Product Memory" with subtitle: "This plugin manages its own product lifecycle. Here's what that looks like."
5. Screenshots are displayed in a responsive 3-column grid (stacks to 1-column on mobile).
6. Images are optimized for web (compressed, reasonable file size — under 200KB each).
7. At least one caption references that the landing page itself was groomed by PM (e.g., "This landing page was researched and groomed by Product Memory").

## User Flows

N/A — content addition to existing page, no new user interaction flow.

## Wireframes

[Wireframe preview](pm/backlog/wireframes/landing-page.html) — see "Dogfooding" section.

## Competitor Context

PostHog is the dogfooding gold standard — they show real internal usage, not mockups. No PM competitor (ChatPRD, Productboard Spark, Compound Engineering) shows their product managing its own lifecycle. PM's story is uniquely strong: the entire product lifecycle (research, strategy, grooming, backlog) is self-managed.

## Technical Feasibility

- **Build-on:** Dashboard screenshots already exist in repo root (`dashboard-home-redesigned.png`, etc.). Groom proposal HTMLs exist at `pm/backlog/proposals/`. The `site/index.html` from PM-082 has a placeholder section ready for this content.
- **Build-new:** Capture 3 curated screenshots, optimize for web, add to `site/images/`, update the dogfooding section HTML in `site/index.html`.
- **Risk:** Screenshots go stale as the product evolves. Consider a note in the issue to refresh screenshots each release, or accept that V1 screenshots are "good enough" for months.
- **Sequencing:** Depends on PM-082 (the page must exist first). Can ship immediately after.

## Decomposition Rationale

Split from PM-082 (Major Effort pattern) because curating real screenshots is a different kind of work — it requires running the product, selecting representative output, and capturing/cropping images. The MVP page (PM-082) delivers full value without this section; this issue adds the trust signal.

## Research Links

- [Landing Page Research](pm/research/landing-page/findings.md)

## Notes

- When PM-023 (Public Hosted Demo Dashboard) ships, add a "See it live" link to this section.
- The meta-story is compelling: "This landing page was researched by PM, groomed by PM, and built through PM's dev workflow." Lean into it.
