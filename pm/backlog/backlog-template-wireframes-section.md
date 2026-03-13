---
type: backlog-issue
id: PM-017
title: "Backlog Template — Wireframes Section"
outcome: "The backlog issue format includes a ## Wireframes section that references the HTML wireframe file for UI features or marks N/A for non-UI features"
status: done
parent: "ui-mockups-in-groomed-output"
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

The backlog issue markdown template in both groom and ideate skills includes a `## Wireframes` section. For UI features, this section references the HTML wireframe file path. For non-UI features, it states "N/A — no user-facing workflow for this feature type." This makes the wireframe status explicit and discoverable in every groomed issue.

## Acceptance Criteria

1. `skills/groom/SKILL.md` Backlog Issue Format template includes `## Wireframes` section.
2. `skills/ideate/SKILL.md` backlog issue format includes `## Wireframes` section.
3. Phase 5 Step 1 feature-type detection instructions are updated to include wireframe generation decision.
4. For UI features, the section contains: `[Wireframe preview](pm/backlog/wireframes/{slug}.html)`.
5. For non-UI features, the section contains: "N/A — no user-facing workflow for this feature type."
6. The dashboard's `rewriteKnowledgeBaseLinks()` handles wireframe file links.

## User Flows

N/A — this is a template/format change, not a user-facing workflow.

## Competitor Context

No competitor includes wireframe references in groomed issue templates. This is a format innovation that makes visual artifacts a first-class part of the issue spec rather than an afterthought attachment.

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** The backlog template was recently extended with `## User Flows` and `## Technical Feasibility` sections (PM-004). Same pattern — add a new section.
- **Build-new:** Template text in SKILL.md. Update to `rewriteKnowledgeBaseLinks()` for wireframe paths.
- **Risk:** None. This is a documentation/template change with no runtime complexity.
- **Sequencing:** Can be done first or in parallel with PM-015/PM-016. No dependencies.

## Research Links

- [PRD-Grade Groomed Output](pm/research/prd-grade-output/findings.md)

## Notes

- Keep the section minimal — just a file reference link and brief description, not inline content.
- The dashboard iframe embed (PM-016) handles the visual rendering.
