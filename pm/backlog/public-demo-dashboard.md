---
type: backlog-issue
id: PM-013
title: "Public Demo Dashboard"
outcome: "Users can see a live demo of PM's knowledge base dashboard before installing, showcasing the plugin's own dogfooded data"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "gtm"
priority: high
evidence_strength: strong
scope_signal: medium
strategic_fit: "Priority 2: Quality of groomed output"
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

A public, read-only version of PM's own dogfooded dashboard is hosted (e.g., on productmemory.io or GitHub Pages) and linked from the README. Potential users can see exactly what PM produces — landscape with positioning map, competitor profiles, strategy, research topics, and a backlog with ideas flowing through the pipeline. Building in public as a distribution strategy.

## Signal Sources

- `pm/strategy.md` § 5 GTM: "Product-led, community-driven. Users discover PM through plugin marketplaces, GitHub, word-of-mouth, and content marketing."
- `pm/landscape.md` § Keyword Landscape: "ai product discovery" at KD 3 — a public dashboard page could rank for this.
- `pm/competitors/pm-skills-marketplace/profile.md` § Strengths: PM Skills Marketplace grew via newsletter-led distribution. PM needs its own distribution lever — a live demo is more compelling than a README.
- `pm/competitors/chatprd/profile.md`: ChatPRD's template library is a top-of-funnel SEO play. A public demo dashboard serves the same purpose for Product Memory.

## Competitor Context

- **PM Skills Marketplace:** README with screenshots. No live demo.
- **ChatPRD:** Limited free tier (3 chats) as the "demo." No public showcase of output quality.
- **Productboard Spark:** 150 free credits as trial. No public knowledge base demo.

A public demo dashboard would be unique — no competitor shows their actual product intelligence output publicly.

## Implementation Approach

1. **Static export:** Add a build command that exports the dashboard as static HTML from the current `pm/` directory.
2. **Host on GitHub Pages** or productmemory.io — zero cost.
3. **Auto-update:** GitHub Action rebuilds the static site on push to main, keeping the demo current with the latest dogfooded data.
4. **README integration:** Add a "See it in action" section with a screenshot and link to the live demo.
5. **SEO opportunity:** The public dashboard pages can target low-competition keywords ("ai product discovery", "ai competitive analysis tool").

## Dependencies

None for static export. The dashboard server already renders all the HTML — just needs a static export mode.

## Open Questions

- Should it be a full static site or a single-page screenshot gallery?
- How to handle sensitive data if the dogfooded knowledge base contains anything private? (Currently it doesn't — all public research.)
- Should the demo link to individual competitor profiles or keep those private?
