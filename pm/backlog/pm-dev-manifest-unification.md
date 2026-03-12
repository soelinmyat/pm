---
type: backlog-issue
id: "PM-046"
title: "Unify plugin manifests for Claude Code, Cursor, and Codex"
outcome: "A single set of manifests allows the merged plugin to be installed on Claude Code, Cursor, and Codex with all 23 skills and 17 commands available on each platform."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "infrastructure"
  - "multi-platform"
priority: high
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

One plugin, three platforms. Product engineers on Claude Code, Cursor, or Codex install the same plugin and get the same workflow capabilities. Version number is unified and consistent across all manifests.

## Acceptance Criteria

1. `.claude-plugin/plugin.json` lists all 23 skills, 17 commands, 1 agent, and merged hooks under a unified plugin name and version.
2. `.cursor-plugin/plugin.json` mirrors the Claude Code manifest with Cursor-specific fields (agents, hooks explicitly listed).
3. `.claude-plugin/marketplace.json` updated with unified name, description, and version.
4. `gemini-extension.json` updated with merged name/version. `GEMINI.md` (the context file it references) updated to include dev skill routing alongside existing PM skill routing.
5. `.codex/INSTALL.md` updated with symlinks for all 23 skills (9 pm-* + 14 dev-*).
6. All manifests share the same version number.
7. Plugin name decision made and applied consistently (e.g., "pm" staying as-is, or rename to reflect product engineer identity).
8. Dev's stale marketplace.json (v0.1.1 vs plugin.json v0.3.2) inconsistency is resolved before merge.
9. Repository decision: target repo for the merge is `github.com/soelinmyat/pm` (or renamed). `check-setup.sh` line 71 `REPO_URL` updated to match. Dev's git history preservation strategy decided (squash merge vs history import).

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

PM already supports 4 platforms (Claude Code, Cursor, Codex, Gemini CLI) — more than any competitor. Dev only supports Claude Code. The merge extends dev's platform reach immediately through PM's existing multi-platform infrastructure.

## Technical Feasibility

PM already maintains 4 manifests in sync (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `gemini-extension.json`). Dev has only `.claude-plugin/plugin.json`. Build-on: PM's existing multi-manifest convention and version bump process (documented in memory: all 3 manifests must be updated together). Build-new: Cursor manifest for dev skills, updated Codex install guide with 14 additional symlinks. Risk: Dev's `marketplace.json` is at v0.1.1 while its `plugin.json` is at v0.3.2 — must reconcile before merge.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- Version scheme decision needed: PM is at v1.0.21, dev at v0.3.2. Options: continue PM's version (v1.1.0), or reset (v2.0.0) to signal the merged identity.
- Codex symlinks need `dev-` prefix to avoid namespace collision with generic names like `review` or `debug`.
