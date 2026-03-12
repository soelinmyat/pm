---
type: backlog-issue
id: "PM-047"
title: "Colocate all 23 skills and 17 commands into a single plugin tree"
outcome: "All PM and dev skills live in one repository under one skills/ directory, with all commands dispatching correctly via ${CLAUDE_PLUGIN_ROOT}."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "infrastructure"
  - "merge"
priority: high
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

The merged plugin's `skills/` directory contains all 23 skills (9 PM + 14 dev) and `commands/` contains all 17 commands (9 PM + 8 dev). Every skill and command resolves correctly through `${CLAUDE_PLUGIN_ROOT}`. No renaming needed — zero naming collisions confirmed by EM review.

## Acceptance Criteria

1. All 14 dev skills copied into `skills/`: brainstorming, bug-fix, debugging, design-critique, dev, dev-epic, merge-watch, pr, receiving-review, review, subagent-dev, tdd, using-dev, writing-plans.
2. All 8 dev commands copied into `commands/`: bug-fix, dev-epic, dev, merge-watch, merge, pr, review, sync.
3. Every command file's `${CLAUDE_PLUGIN_ROOT}/skills/{name}/SKILL.md` reference resolves correctly in the merged tree.
4. Cross-plugin `${CLAUDE_PLUGIN_ROOT}` references resolve correctly — specifically: `dev-epic` and `dev` referencing `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/` and `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md`.
5. PM skills with internal symlinks (to `../../agents`, `../../commands`, etc.) continue to work.
6. Dev skills get equivalent symlink infrastructure added for Codex compatibility. Audit first: `brainstorming/scripts/` has real content (local server) — do not overwrite with symlink.
7. `ls skills/` shows all 23 directories. `ls commands/` shows all 17 files.
8. End-to-end smoke test: at least one cross-plugin skill chain resolves correctly (e.g., `pm:research` output is readable from a `dev:dev-epic` session via the `research_location` path).
9. Dev's `docs/` directory reviewed — any content merged into PM's `docs/` or explicitly excluded. No orphaned documentation remains.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

claude-skills (192+ skills) uses a flat skill directory model but with no integration depth — skills are independent and share no state. Compound Engineering Plugin colocates dev skills but deliberately excludes PM workflows. This merge preserves the PM→dev pipeline integration (cross-plugin skill chains that share `.pm/` state) while using the same flat-directory simplicity. The integration depth is the differentiator, verified by end-to-end smoke test (AC #8).

## Technical Feasibility

EM confirmed zero naming collisions and identical command dispatch patterns. Both plugins use `${CLAUDE_PLUGIN_ROOT}/skills/{name}/SKILL.md` exclusively — no hardcoded absolute paths. Build-on: identical directory structure in both plugins. Build-new: symlink infrastructure in dev skill directories (PM skills have symlinks to `../../agents`, `../../commands`, etc. for Codex; dev skills don't). Risk: low — this is file copy + symlink creation with no behavior changes.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- This is the bulk of the merge — produces a working combined plugin when paired with manifest unification.
- Dev's `docs/` directory content (if any) should be reviewed for merge into PM's `docs/`.
