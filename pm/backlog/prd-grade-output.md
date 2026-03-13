---
type: backlog-issue
title: "PRD-Grade Groomed Output"
outcome: "Groomed backlog items are complete PRD-replacement documents with wireframes, user flows, and technical context — ready for engineering handoff"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "output-quality"
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

A groomed backlog item becomes a full PRD-replacement document. Engineers can pick it up and build without back-and-forth. Includes not just text (outcome, acceptance criteria, competitor context) but visual artifacts: in-built wireframes, user flow diagrams, data model sketches, and API contract outlines — all rendered in the dashboard.

## Signal Sources

- `pm/strategy.md` § 6 Priority 2: "Each groomed ticket should be 10x better than what a PM could produce manually."
- `pm/competitors/matrix.md`: No competitor generates visual artifacts as part of grooming. ChatPRD generates PRD text. Spark generates briefs. Neither produces wireframes or flows.
- `pm/competitors/index.md` § Market Gaps #5: No strategy-to-grooming pipeline in any competitor.

## Competitor Context

- **ChatPRD:** Generates PRD text with objectives, user stories, technical requirements. No visual artifacts. No integration with research or strategy.
- **Productboard Spark:** Generates product briefs and PRDs (85-95 credits). Text-only. No wireframes or flows.
- **PM Skills Marketplace:** Has create-prd skill but output is session-scoped text, not a persistent visual document.

Product Memory would be the first to produce groomed documents with in-built visual artifacts, grounded in the persistent knowledge base.

## Implementation Approach

1. **In-built wireframes:** Structured comments in backlog markdown (similar to positioning map pattern). Dashboard server parses and renders as wireframe-style HTML/SVG.
2. **Mermaid diagrams:** User flows and data models as mermaid syntax. Dashboard adds mermaid.js rendering.
3. **Groom skill enhancement:** Phase 5 (Groom) generates visual sections based on feature type — UI features get wireframes, API features get contract outlines, data features get schema sketches.

## Dependencies

None. Dashboard server already renders custom HTML/SVG from markdown comments (positioning map, stat cards). Same pattern extends to wireframes.

## Open Questions

- Wireframe syntax: what structured comment format best balances expressiveness with simplicity?
- Which visual artifact types are most valuable? Wireframes, user flows, data models, API contracts — all of these, or start with a subset?
- Should the groom skill auto-detect which visual types to generate based on the feature, or ask the user?
