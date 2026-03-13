---
type: backlog-issue
id: PM-006
title: "UI Mockups in Groomed Output (v2)"
outcome: "Groomed backlog items for UI features include visual mockups or wireframes — extending the PRD-grade output with screen layout previews"
status: idea
parent: "prd-grade-output"
children: []
labels:
  - "output-quality"
  - "grooming"
  - "v2"
priority: medium
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

When a groomed feature involves UI, the output includes a visual mockup or wireframe showing the proposed screen layout. Engineers and coding agents can see what to build, not just read about it. This completes the PRD-grade output vision started in v1 (Mermaid user flows + EM feasibility review).

## Signal Sources

- v1 grooming session: wireframes were scoped out because the structured comment format needs design iteration — the format question is the main blocker
- `pm/research/prd-grade-output/findings.md` Finding 4: AI wireframing tools (UX Pilot, Figma AI, MockFlow) exist but are disconnected from product context
- `pm/competitors/matrix.md`: No competitor generates visual wireframes as part of grooming

## Competitor Context

- **CodeGuide:** Generates wireframes from plain language but for project bootstrapping, not ongoing PM
- **UX Pilot / Figma AI / MockFlow:** Standalone wireframe generators with no product strategy or research context
- **ChatPRD / Spark / PM Skills Marketplace:** Text-only output, no visual artifacts

## Open Questions

- What format for wireframes? Options: structured HTML comments (dashboard renders as SVG), Mermaid (limited for layouts), ASCII art (universal but crude), Pencil MCP integration (.pen files)
- Should the dashboard render wireframes inline or link to an external tool?
- Auto-detect UI features and generate wireframes, or require explicit user request?
- What level of fidelity? Lo-fi boxes-and-labels vs. styled components?

## Dependencies

- v1 PRD-grade output shipped and validated (Mermaid user flows proving value)
- Wireframe format decision made

## Notes

- Pick up after v1 proves value and user feedback confirms demand for visual mockups
- Pencil MCP integration is a potential shortcut — generates real design files rather than inventing a new format
