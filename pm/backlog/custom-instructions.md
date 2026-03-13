---
type: backlog-issue
title: "Custom Instructions"
outcome: "Users can customize PM plugin behavior via a .pm/instructions.md file that all skills respect"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "extensibility"
priority: medium
evidence_strength: moderate
scope_signal: small
strategic_fit: "Priority 2: Quality of groomed output"
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

Users create a `.pm/instructions.md` file with their preferences, conventions, and context. Every PM skill reads it and adjusts behavior accordingly — terminology, frameworks, writing style, custom PRD sections, competitors to track, and more. No code changes needed to customize PM.

## Signal Sources

- `pm/strategy.md` § 6 Priority 2: Output quality improves when grounded in team-specific conventions, not just generic best practices.
- `pm/competitors/pm-skills-marketplace/profile.md` § Weaknesses: "Output quality depends on input quality." Custom instructions solve this by front-loading context.
- Pattern precedent: CLAUDE.md, CURSOR_RULES, AGENTS.md all prove this approach works for customizing AI behavior.

## Competitor Context

- **PM Skills Marketplace:** No customization mechanism. Skills produce generic framework output regardless of team context.
- **ChatPRD:** Has "Projects" with saved instructions and files — similar concept but locked behind Pro+ and cloud-only.
- **Productboard Spark:** Has organizational memory but not user-editable instruction files.

Product Memory would offer this for free, locally, in a simple markdown file that's gitignored with the rest of `.pm/`.

## Implementation Approach

1. Add `.pm/instructions.md` as an optional file (not created by setup — users opt in).
2. Every skill checks for it after prerequisite checks, before doing work.
3. Instructions are treated as user preferences — they guide but don't override skill structure.
4. Setup skill mentions the file: "You can customize PM behavior by creating .pm/instructions.md."

## Dependencies

None.

## Open Questions

- Should it be `.pm/instructions.md` (gitignored, personal) or `pm/instructions.md` (committed, shared)?
- Or both — personal overrides shared?
- How to handle conflicts between instructions and skill logic (e.g., user says "skip strategy check" but groom has it as a hard gate)?
