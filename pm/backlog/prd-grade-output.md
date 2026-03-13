---
type: backlog-issue
id: PM-001
title: "PRD-Grade Groomed Output (v1: User Flows + EM Feasibility Review)"
outcome: "Groomed backlog items include Mermaid user flow diagrams, an EM feasibility review grounded in the codebase, and research-cited visual artifacts — making every groomed ticket a coding-agent-ready spec that replaces standalone PRDs"
status: done
parent: null
children:
  - "groom-mermaid-user-flows"
  - "groom-em-feasibility-review"
  - "backlog-format-extension"
  - "dashboard-mermaid-rendering"
labels:
  - "output-quality"
  - "grooming"
  - "differentiation"
priority: high
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

Groomed backlog items become complete product specs. Engineers (or coding agents) can pick them up and build without requesting additional wireframes, specs, or feasibility checks. Each groomed ticket includes:

- A Mermaid user flow diagram showing the primary happy path, decision points, and error states — cited back to research and competitive findings
- A Technical Feasibility section produced by an EM persona that scanned the actual codebase — surfacing what exists, what's missing, and what's risky
- The standard groomed output (outcome, acceptance criteria, competitor context, customer evidence) already produced by the groom skill

No competitor produces visual artifacts or codebase-grounded feasibility reviews as part of grooming. This is the clearest differentiation story for PM's grooming output quality.

## Acceptance Criteria

1. The groom skill (Phase 5) generates a Mermaid user flow diagram for features with user-facing workflows
2. The groom skill dispatches an EM persona agent that scans the codebase and counsels the user on technical feasibility
3. Generated diagrams include inline citation comments referencing research findings or competitor gaps
4. The dashboard renders Mermaid diagrams natively in backlog issue views via mermaid.js
5. Backlog issue markdown template includes `## User Flows` and `## Technical Feasibility` sections
6. 90-day success metric: >80% of groomed items include at least one Mermaid user flow
7. Qualitative success: users report reduced clarification rounds before build starts

## Competitor Context

- **ChatPRD:** Generates PRD text (objectives, user stories, technical requirements). No visual artifacts. No codebase context. No research grounding.
- **Productboard Spark:** Generates product briefs (85-95 credits). Text-only. No codebase access.
- **PM Skills Marketplace:** Has create-prd skill but output is session-scoped text. No persistent knowledge base, no codebase scan.
- **CodeGuide:** Generates PRDs + wireframes + user flows (40K+ users), but for project bootstrapping, not ongoing product management. No strategy alignment, no competitive evidence layer.

PM would be the first tool to produce groomed documents with embedded visual artifacts and codebase-grounded feasibility reviews, all inside the editor.

## Research Links

- [PRD-Grade Groomed Output Research](pm/research/prd-grade-output/findings.md)

## Notes

- Wireframes (structured HTML comments) deferred to v2 — format needs design iteration
- API contracts and data models excluded — crosses into implementation territory (non-goal #1)
- Positioning: "Coding-agent-ready groomed tickets — the input format a coding agent can act on without translation"
- Phase 4.5 becomes a three-agent review: Product Manager, Competitive Strategist, and Engineering Manager
