---
type: backlog-issue
id: PM-023
title: "Public Hosted Demo Dashboard"
outcome: "PM's dogfooded dashboard is hosted publicly (GitHub Pages / productmemory.io) as a distribution lever and SEO play"
status: idea
parent: null
children: []
labels:
  - "gtm"
priority: high
evidence_strength: strong
scope_signal: medium
strategic_fit: "GTM (Section 5): Product-led, community-driven distribution"
competitor_gap: unique
dependencies: []
created: 2026-03-14
updated: 2026-03-14
---

## Outcome

A public, read-only version of PM's own dogfooded dashboard is hosted online and linked from the README. Potential users can see exactly what PM produces — landscape with positioning map, competitor profiles, strategy, research topics, and backlog — before installing. Building in public as a distribution strategy.

## Signal Sources

- `pm/strategy.md` § 5 GTM: "Product-led, community-driven. Users discover PM through plugin marketplaces, GitHub, word-of-mouth, and content marketing."
- `pm/landscape.md` § Keyword Landscape: "ai product discovery" at KD 3 — a public dashboard page could rank for this.
- `pm/competitors/pm-skills-marketplace/profile.md` § Strengths: PM Skills Marketplace grew via newsletter-led distribution. PM needs its own distribution lever.
- `pm/competitors/chatprd/profile.md`: ChatPRD's template library is a top-of-funnel SEO play.

## Competitor Context

- **PM Skills Marketplace:** README with screenshots. No live demo.
- **ChatPRD:** Limited free tier (3 chats) as the "demo." No public showcase of output quality.
- **Productboard Spark:** 150 free credits as trial. No public knowledge base demo.

## Implementation Approach

1. Static export mode for the dashboard server — generates deployable HTML from `pm/` directory.
2. Host on GitHub Pages or productmemory.io — zero cost.
3. GitHub Action rebuilds static site on push to main.
4. README integration: "See it in action" section with screenshot and link.
5. SEO targeting: "ai product discovery" (KD 3), "ai tools for product discovery" (KD 3).

## Open Questions

- Full static site or curated showcase?
- Should competitor profiles be included or kept private?
- Relationship with PM-013 (`pm:example`) — the public site could be a hosted version of the same dashboard.

## Notes

Deferred from PM-013 rescope. Original PM-013 was this feature; rescoped to local `pm:example` command for lower effort. This idea preserves the distribution/SEO angle.
