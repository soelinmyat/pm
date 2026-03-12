---
type: backlog-issue
id: PM-005
title: "Dashboard Mermaid Rendering"
outcome: "The PM dashboard renders Mermaid code blocks in backlog issue views as interactive SVG diagrams"
status: done
parent: "prd-grade-output"
children: []
labels:
  - "dashboard"
  - "output-quality"
priority: medium
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

The PM dashboard renders Mermaid code blocks in backlog issue views as SVG diagrams, so users can visually review groomed output without leaving the browser.

## Acceptance Criteria

1. Dashboard server includes mermaid.js as a client-side dependency
2. Mermaid code blocks in backlog issue markdown are detected and rendered as SVG diagrams
3. Rendered diagrams support zoom/pan for complex flows
4. Diagrams render correctly for flowchart type (primary use case for user flows)
5. Fallback: if Mermaid parsing fails, show the raw code block with an error indicator

## Competitor Context

No competitor has a browser-based visual dashboard for groomed backlog output. This is PM's own territory. Mermaid renders natively in GitHub and GitLab, so the primary consumption path (markdown in the editor or repo) already works — the dashboard rendering is polish for the visual review experience.

## Research Links

- [PRD-Grade Groomed Output Research](pm/research/prd-grade-output/findings.md) — Finding 5 (Mermaid natively supported, single JS dependency)

## Notes

- mermaid.js is the only new client-side dependency
- Lower priority than groom skill changes — Mermaid already renders in GitHub/GitLab, so value is delivered even without dashboard rendering
- Can be shipped last without blocking the core value proposition
