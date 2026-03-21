---
type: backlog-issue
id: "PM-049"
title: "Unify dev state files into .pm/ directory"
outcome: "All plugin state — PM sessions, groom sessions, dev implementation state — lives under .pm/, making the state directory the single source of truth for the product engineer's workflow."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "infrastructure"
  - "state-management"
priority: medium
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

Dev's implementation state files (`.dev-state-*.md`, `.dev-epic-state-*.md`) move from the project root into `.pm/dev-sessions/`. The `.pm/` directory becomes the unified runtime state for the entire lifecycle. This also enables the groom→dev handoff to read from a predictable location.

## Acceptance Criteria

1. Dev state files write to `.pm/dev-sessions/{slug}.md` instead of `.dev-state-{slug}.md` at project root.
2. Dev epic state files write to `.pm/dev-sessions/epic-{slug}.md` instead of `.dev-epic-state-{slug}.md`.
3. All dev skills that reference state file paths are updated. Full audit list (8-9 files per EM review): dev/SKILL.md, dev-epic/SKILL.md, dev-epic/references/state-template.md, dev/context-discovery.md, dev/references/custom-instructions.md, review/SKILL.md, pr/SKILL.md, merge-watch/SKILL.md, design-critique/SKILL.md. Also update dev-epic's cleanup loop (lines 507-514) which iterates over `.dev-epic-state-*.md .dev-state-*.md` at wrap-up.
4. `.gitignore` pattern updated: `.pm/` covers all state (no separate `.dev-state-*` pattern needed). Also add `dev/instructions.local.md` pattern from dev's `.gitignore`.
5. Graceful migration: during transition, skills check both `.pm/dev-sessions/{slug}.md` and legacy `.dev-state-{slug}.md` at project root. If legacy file found but new-path file not found, read from legacy. New writes always go to `.pm/dev-sessions/`. No one-time migration script needed — existing sessions complete at old path, new sessions use new path.
6. `.pm/config.json` remains the shared config for Linear and other integrations.
7. State files in `.pm/dev-sessions/` are committed alongside code in the repo — the product engineer's full lifecycle state is version-controlled, not siloed in a cloud service.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor has a unified, version-controlled state directory spanning product discovery and implementation. Productboard Spark is a standalone SaaS silo that cannot write back to the system of record. Compound Engineering Plugin tracks state per-session but does not persist across PM and dev phases. The competitive advantage is not just "we persist state" — it's "we persist state in the repo, version-controlled, visible to the team, no external silo." This is structural and hard to replicate by cloud-first competitors.

## Technical Feasibility

Build-on: PM's `.pm/` structure is clean and extensible (already has `groom-sessions/`, `sessions/`, `evidence/`, `config.json`). Dev's `.gitignore` already patterns for `.dev-state-*.md`. Build-new: Path changes across 5+ dev skill files. Migration logic to check both old and new locations. Risk: This is the highest-effort scope item — touching dev's core state management. EM flagged this is "not just colocate work." Each skill file that references state paths needs careful editing and testing.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- The EM suggested keeping dev state at project root as a scope reduction. This issue commits to full unification. If implementation proves too risky, fallback: keep at root, document as known inconsistency, revisit later.
- Dev state should NOT include sprint tracking or velocity data — this would violate Non-Goal #2.
