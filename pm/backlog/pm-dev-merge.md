---
type: backlog-issue
id: "PM-044"
title: "Merge PM and Dev plugins into a unified product engineer workflow tool"
outcome: "A single installable plugin gives product engineers end-to-end structured workflows from idea through shipped code, with zero manual handoff between stages."
status: done
parent: null
children:
  - "pm-dev-strategy-rewrite"
  - "pm-dev-manifest-unification"
  - "pm-dev-skill-colocation"
  - "pm-dev-hook-merge"
  - "pm-dev-state-unification"
  - "pm-dev-groom-handoff"
  - "pm-dev-codex-install"
labels:
  - "epic"
  - "infrastructure"
  - "product-engineer"
priority: high
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

Product engineers install one plugin and get the full lifecycle: research → strategy → grooming → brainstorming → TDD → implementation → code review → PR → merge. Context compounds across stages — research informs grooming, grooming shapes implementation, implementation references competitive analysis. No manual handoff, no context switching between tools.

## Acceptance Criteria

1. A single `plugin.json` manifest installs all 23 skills and 17 commands on Claude Code.
2. Cursor and Codex manifests/install guides cover the same skill set.
3. Groomed issues (bar_raiser.verdict == "ready" or "ready-if") automatically skip brainstorm and spec review in dev:dev-epic and dev:dev.
4. SessionStart hook runs both PM setup checks and dev context preloading.
5. Dev state lives under `.pm/` alongside groom sessions and research state.
6. Strategy.md reflects new positioning: product engineer workflow tool with updated goals and non-goals.
7. No existing PM or dev skill behavior is broken by the merge — verified by running 3 representative skill invocations (1 PM, 1 dev, 1 cross-plugin) before and after merge and comparing response quality.
8. Baseline measurement established before merge ships: count steps for groomed vs ungroomed issues through current dev flow.
9. Upgrade path documented for existing standalone PM users.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor offers an integrated research→strategy→grooming→implementation→review→merge pipeline. The structural gap (per Martin Fowler's Kiro analysis): spec-driven tools assume "a developer would do all this analysis" without making explicit who does the upstream product work. Kiro can't detect spec quality — it assumes specs exist. Compound Engineering deliberately chose not to extend into research/strategy. MetaGPT defines multi-agent roles but is a research framework, not a production plugin. The groom→dev handoff (PM-050) is the structural answer to all three gaps: it provides the upstream product work, detects its completion, and adapts dev ceremony accordingly.

## Technical Feasibility

Feasible with caveats per EM review. Zero naming collisions across all 23 skills and 17 commands. Identical command dispatch patterns (`${CLAUDE_PLUGIN_ROOT}/skills/{name}/SKILL.md`). Main caveats: dev state files currently at project root need migration to `.pm/`, groom handoff heuristic needs formalization, and PM has internal symlinks in skill directories that dev lacks.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- Strategy override: Non-Goal #1 ("PM ends at the groomed ticket") overridden. Rationale: agentic coding blurs PM/engineer roles.
- New positioning: "Structured workflows for the product engineer, on top of whatever AI coding assistant they already use."
- Goals: (1) Build valuable products, (2) Build efficiently, (3) Manage cognitive load.
- Non-Goals: (1) Not a platform/model/infra tool — workflow layer only, (2) Not enterprise PM — scales to squad, not org.
