---
type: backlog-issue
id: "PM-051"
title: "Update Codex install guide for merged plugin"
outcome: "Codex users can install all 23 skills via symlinks with a single setup process, getting both PM and dev workflows."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "infrastructure"
  - "codex"
  - "multi-platform"
priority: low
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

Codex users follow one install guide to get all 23 skills. The existing 9 `pm-*` symlinks are joined by 14 `dev-*` symlinks. Dev skill directories get the same internal symlink infrastructure that PM skills have for Codex resource discovery.

## Acceptance Criteria

1. `.codex/INSTALL.md` updated with symlink commands for all 14 dev skills: `dev-brainstorming`, `dev-bug-fix`, `dev-debugging`, `dev-design-critique`, `dev-dev`, `dev-dev-epic`, `dev-merge-watch`, `dev-pr`, `dev-receiving-review`, `dev-review`, `dev-subagent-dev`, `dev-tdd`, `dev-using-dev`, `dev-writing-plans`.
2. Dev skill directories contain symlinks to shared `agents/`, `commands/`, `hooks/`, `scripts/`, `templates/` (matching PM skill directory convention).
3. `skills/setup/references/codex-tools.md` tool mapping table still accurate for dev skills.
4. Verification section updated: test both a PM skill (`$pm-setup`) and a dev skill (`$dev-dev`).
5. All `dev-*` prefixed symlinks avoid namespace collision with Codex built-in or common skill names.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor plugin supports Codex installation. This extends the merged plugin's unique multi-platform story.

## Technical Feasibility

Build-on: PM's existing Codex install pattern (`~/.agents/skills/pm-*` symlinks) scales directly to 23 symlinks. The `codex-tools.md` tool mapping is already comprehensive. Build-new: 14 new symlink entries in INSTALL.md, symlink infrastructure in 14 dev skill directories. Risk: Low — this is documentation and symlink creation with no runtime behavior changes. PM skills already have the symlink pattern working.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- This is the last issue in the sequence — it has no runtime impact and can be done after the core merge is complete.
- Windows notes section in INSTALL.md may need updating if dev skills have different symlink requirements.
