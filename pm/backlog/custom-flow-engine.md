---
type: backlog-issue
id: "PM-115"
title: "Custom flow chart engine for user flow diagrams"
outcome: "User flows in proposals render as interactive, polished diagrams without Mermaid dependency"
status: idea
parent: null
labels:
  - ui
  - infrastructure
priority: low
created: 2026-04-03
updated: 2026-04-03
---

## Outcome

Flow diagrams in progressive proposals look polished and support step-through interaction. No external Mermaid dependency. The engine is data-driven — skill outputs JSON, engine renders SVG.

## Why

Mermaid flowcharts are functional but generic. A custom engine gives us:
- Interactive step-through with animations
- Pixel-accurate branch connectors (Mermaid's are auto-layouted)
- Consistent visual language matching the proposal design
- No CDN dependency

## Key challenges

- Branch layout: connecting decision nodes to multiple arms with proper T-junction lines. CSS flexbox alone can't draw diagonal/curved connector paths.
- Auto-layout: nodes need to be positioned without manual coordinates. Needs a simple top-down layout algorithm.
- SVG vs CSS: SVG gives precise line drawing but requires coordinate math. CSS is simpler but can't do angled connectors.

## Suggested approach

- SVG canvas with a simple top-down layout engine
- Nodes positioned on a grid (column/row), connectors drawn as SVG paths
- Data format: JSON array of nodes with `type`, `text`, `branches`
- Step-through mode: highlight nodes sequentially with CSS transitions
- Edge cases rendered as contextual tooltips on decision nodes

## Notes

- Prototype attempted 2026-04-03 — CSS-only branching looked broken. SVG approach needed.
- Keep Mermaid as fallback for flows the custom engine can't handle.
