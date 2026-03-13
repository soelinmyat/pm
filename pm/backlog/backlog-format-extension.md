---
type: backlog-issue
id: PM-004
title: "Backlog Issue Format Extension"
outcome: "The backlog issue markdown template supports user flow and technical feasibility sections for consistent, parseable groomed output"
status: done
parent: "prd-grade-output"
children: []
labels:
  - "output-quality"
  - "grooming"
priority: medium
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

The backlog issue markdown template includes `## User Flows` and `## Technical Feasibility` sections so groomed output has a consistent, parseable structure for both human and dashboard consumption.

## Acceptance Criteria

1. Backlog issue template (in groom skill Phase 5) includes `## User Flows` section (after `## Acceptance Criteria`) containing a Mermaid code block when applicable, or "N/A — no user-facing workflow for this feature type" when skipped
2. Backlog issue template includes `## Technical Feasibility` section (after `## User Flows`) containing the EM review findings with file path references
3. Existing backlog issues without these sections remain valid — the format is additive, not breaking
4. The dashboard correctly renders backlog issues with and without the new sections

## Competitor Context

No competitor has a structured, extensible backlog issue format with visual artifact sections. ChatPRD outputs PRD documents. PM Skills Marketplace outputs session text. PM's markdown-based format is version-controlled, parseable, and renderable in the dashboard.

## Research Links

- [PRD-Grade Groomed Output Research](pm/research/prd-grade-output/findings.md) — Finding 6 (PRD best practices recommend visual sections)

## Notes

- Format is additive — does not break existing backlog issues
- Wireframes section reserved for v2 when the structured comment format is designed
