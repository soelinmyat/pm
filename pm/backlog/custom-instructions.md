---
type: backlog-issue
id: PM-007
title: "Custom Instructions"
outcome: "Users customize PM plugin behavior via pm/instructions.md (shared) and pm/instructions.local.md (personal) that all skills respect"
status: done
parent: null
children:
  - "instructions-load-step"
  - "instructions-gitignore-setup"
  - "instructions-documentation"
labels:
  - "extensibility"
  - "output-quality"
priority: medium
research_refs:
  - pm/research/custom-instructions/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

Users create `pm/instructions.md` (shared, committed) and/or `pm/instructions.local.md` (personal, gitignored) with their preferences, conventions, and context. Every PM skill reads these files and adjusts behavior accordingly — terminology, writing style, output format, competitors to track, and more. Personal overrides shared on format preferences; strategy.md wins on strategic decisions. No code changes needed to customize PM.

## Signal Sources

- `pm/strategy.md` § 6 Priority 2: Output quality improves when grounded in team-specific conventions, not just generic best practices.
- `pm/competitors/pm-skills-marketplace/profile.md` § Weaknesses: "Output quality depends on input quality." Custom instructions solve this by front-loading context.
- Pattern precedent: CLAUDE.md, CURSOR_RULES, AGENTS.md all prove this approach works for customizing AI behavior.
- `pm/research/custom-instructions/findings.md`: Custom instructions are a universal AI pattern; no PM competitor offers local file-based customization.

## Competitor Context

- **PM Skills Marketplace:** No customization mechanism. Skills produce generic framework output regardless of team context.
- **ChatPRD:** Has "Projects" with saved instructions and files — similar concept but locked behind Pro+ and cloud-only.
- **Productboard Spark:** Has organizational memory but not user-editable instruction files.

PM is the first editor-native PM tool with local, free, user-editable instructions — the "CLAUDE.md for your product."

## Scope

**In scope:**
- `pm/instructions.md` — shared team instructions (committed)
- `pm/instructions.local.md` — personal overrides (gitignored via `*.local.md`)
- Override hierarchy: personal > shared; strategy.md > instructions for strategic decisions; hard gates never overridden
- Every skill reads instructions after prerequisite checks, before doing work
- Setup mentions the file as opt-in customization
- Commented template for discoverability

**Out of scope:**
- UI for editing instructions (users edit markdown directly)
- Structured/YAML parsing (freeform markdown like CLAUDE.md)
- Overriding skill hard gates (strategy check, research-before-scope stay non-negotiable)
- Instruction validation or conflict detection (v1 keeps it simple)
- Per-skill instruction files (one file covers all skills)
- Instructions drift detection (future: PM suggests updates based on accumulated context)

## Success Criteria

At 90 days, users who create pm/instructions.md report output that matches their team conventions without per-session corrections.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** Every skill already has prerequisite file-read pattern (`pm/strategy.md`, `.pm/config.json`, `.pm/.groom-state.md`). Same idiom. Setup already handles gap-aware onboarding.
- **Build-new:** Instructions load step in 8 SKILL.md files, `pm/*.local.md` gitignore entry, setup mention, documentation.
- **Risk:** Hard gate leakage (LLM-interpreted, mitigated by explicit prose). Existing projects need manual gitignore update. LLM merge logic is non-deterministic for subtle conflicts.
- **Sequencing:** Gitignore first → groom SKILL.md as template → propagate to all skills → setup → documentation → version bump.

## Research Links

- [Custom Instructions for AI Tools](pm/research/custom-instructions/findings.md)

## Notes

- Resolved: file location is `pm/instructions.md` (shared) + `pm/instructions.local.md` (personal). The `.pm/` hidden folder approach was rejected for discoverability reasons.
- Resolved: conflict handling — strategy.md wins on strategy, instructions win on format.
- Resolved: hard gates are non-negotiable — documented in every skill's load step.
- Future opportunity: instructions drift detection — PM suggests updates to instructions based on accumulated research and strategy context.
