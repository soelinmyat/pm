---
type: backlog-issue
id: PM-020
title: "Instructions Documentation"
outcome: "The plugin includes documentation explaining the instructions feature: file locations, example content, override hierarchy, and limitations"
status: idea
parent: "custom-instructions"
children: []
labels:
  - "extensibility"
  - "documentation"
priority: medium
research_refs:
  - pm/research/custom-instructions/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

Users who want to customize PM can find clear documentation explaining what instructions files do, where they live, what to put in them, how the override hierarchy works, and what instructions cannot do. The documentation positions `pm/instructions.md` as "the CLAUDE.md for your product" — a framing the ICP already understands.

## Acceptance Criteria

1. Documentation covers file paths: `pm/instructions.md` (shared, committed) and `pm/instructions.local.md` (personal, gitignored).
2. Documentation explains the purpose: customize terminology, writing style, output format, competitors to track, and other preferences.
3. A full example instructions file is provided with realistic content.
4. Override hierarchy is documented: personal overrides shared; strategy.md wins for strategic decisions; instructions win for format preferences; hard gates are never overridden.
5. Limitations are documented: instructions cannot disable strategy checks, research requirements, or other safety gates.
6. Documentation is accessible from the plugin README or a dedicated doc file.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor documents a custom instructions feature because none offers one. ChatPRD's "Projects" feature has minimal documentation. PM's explicit documentation of the override hierarchy and limitations is a trust signal for the ICP.

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** The plugin already has README.md and skill documentation.
- **Build-new:** A documentation section or file explaining the instructions feature.
- **Risk:** None. This is a documentation change.
- **Sequencing:** Should be done after PM-018 and PM-019 so the documentation reflects actual implemented behavior.

## Research Links

- [Custom Instructions for AI Tools](pm/research/custom-instructions/findings.md)

## Notes

- The "CLAUDE.md for your product" framing (from competitive review) is a strong onboarding hook — use it in the documentation.
- Consider including a "What NOT to put in instructions" section (don't duplicate strategy.md, don't try to override safety gates).
