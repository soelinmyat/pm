---
type: backlog-issue
id: PM-002
title: "Groom Skill — Mermaid User Flow Generation"
outcome: "When a user runs /pm:groom, Phase 5 generates a Mermaid user flow diagram showing the primary user journey and embeds it in the groomed backlog issue with research citations"
status: done
parent: "prd-grade-output"
children: []
labels:
  - "output-quality"
  - "grooming"
priority: high
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

When a user runs `/pm:groom`, Phase 5 automatically generates a Mermaid user flow diagram appropriate to the feature and embeds it in the groomed backlog issue. The diagram shows the primary happy path, decision points, and error states — grounded in research and competitive context via inline citations.

## Acceptance Criteria

1. Features with user-facing workflows generate a Mermaid flowchart showing the primary happy path and key decision points
2. Error states and edge cases are represented as branching paths in the flowchart
3. Each diagram includes at least one `%% Source: pm/research/... or pm/competitors/...` citation comment linking to the research or competitor finding that informed a design decision
4. The groom skill prompts the user: "This feature involves a user workflow — I'll generate a user flow diagram. Sound right?"
5. If the feature has no user-facing workflow (e.g., infrastructure, config change), the diagram is skipped with a note: "No user flow applicable for this feature type"
6. Generated Mermaid syntax is valid and renders correctly in GitHub, GitLab, and the PM dashboard

## Competitor Context

No competitor generates visual artifacts as part of grooming. ChatPRD generates text-only PRDs. Productboard Spark generates text-only briefs. The Mermaid user flow is PM's first visual artifact in groomed output.

## Research Links

- [PRD-Grade Groomed Output Research](pm/research/prd-grade-output/findings.md) — Finding 5 (Mermaid is the standard), Finding 6 (visual artifacts reduce back-and-forth)

## Notes

- Mermaid flowchart syntax is the target — widely supported, LLM-generatable, no external dependencies
- Citation trails are the defensible wrapper — Mermaid generation alone is trivially copyable; research-grounded diagrams are not
- Feature-type detection uses a lightweight user confirmation prompt, not silent auto-detection
