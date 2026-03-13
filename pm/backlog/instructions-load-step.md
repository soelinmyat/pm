---
type: backlog-issue
id: PM-018
title: "Instructions Load Step in All Skills"
outcome: "Every PM skill reads pm/instructions.md (shared) and pm/instructions.local.md (personal) after prerequisite checks, applying user preferences to output"
status: done
parent: "custom-instructions"
children: []
labels:
  - "extensibility"
  - "output-quality"
priority: high
research_refs:
  - pm/research/custom-instructions/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

Every PM skill reads `pm/instructions.md` (shared team instructions) and `pm/instructions.local.md` (personal overrides) after prerequisite checks and before doing work. The instructions are injected as additional context so the LLM adjusts its output to match the user's terminology, writing style, output format, and tracked competitors. Users stop repeating the same context every session.

## Acceptance Criteria

1. `groom/SKILL.md` includes an instructions load step after prerequisite checks, before Phase 1.
2. All 7 remaining skills (`research/SKILL.md`, `strategy/SKILL.md`, `ideate/SKILL.md`, `dig/SKILL.md`, `ingest/SKILL.md`, `refresh/SKILL.md`, `setup/SKILL.md`) include the same load step.
3. `agents/researcher.md` includes the load step.
4. The load step explicitly states the override hierarchy: "strategy.md wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure)."
5. The load step states: "Instructions do not override skill hard gates (strategy check, research-before-scope, etc.)."
6. If neither instructions file exists, the skill proceeds normally with no warning or error.
7. If only one file exists, it is used without requiring the other.
8. The load step wording is identical across all skills for consistency.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

- **PM Skills Marketplace:** No customization mechanism. Skills produce generic framework output regardless of team context.
- **ChatPRD:** Has "Projects" with saved instructions and files — similar concept but cloud-only, locked behind Pro+, not file-based or version-controlled.
- **Productboard Spark:** Has organizational memory but not user-editable instruction files.

No competitor offers local, file-based instruction customization for PM tools.

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** Every skill already has a prerequisite file-read pattern (e.g., `pm/strategy.md`, `.pm/config.json`, `.pm/.groom-state.md`). The instructions load step follows the same idiom — check if file exists, read it, use it as context.
- **Build-new:** A new step in each SKILL.md defining the two-file read pattern and override semantics in prose. No runtime, parser, or schema needed — freeform markdown read by the LLM.
- **Risk:** Hard gate leakage — if a user writes "skip strategy check," the LLM sees that alongside the hard gate. Mitigated by explicit prose in the load step stating hard gates are non-negotiable. The SKILL.md instruction is closer to execution and more explicit.
- **Sequencing:** Nail the exact wording in `groom/SKILL.md` first (most-used skill), then propagate to all others. This ensures consistency.

## Research Links

- [Custom Instructions for AI Tools](pm/research/custom-instructions/findings.md)

## Notes

- The load step is prose instructions in SKILL.md, not code. The LLM reads both files and applies preferences. Merge logic is LLM-interpreted, not deterministic.
- Context window cost: a 200-line instructions file is low-cost individually but compounds across long grooming sessions. Not blocking for v1.
- Template wording should be established in groom SKILL.md first, then copy-pasted to all other skills for consistency.
