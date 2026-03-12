---
type: backlog-issue
id: "PM-057"
title: "Remove commands — skill-only architecture"
outcome: "Users interact with PM through seamless skill auto-activation instead of memorizing slash command syntax"
status: done
parent: null
children:
  - "remove-commands-infrastructure"
  - "remove-commands-documentation"
labels:
  - "architecture"
  - "developer-experience"
priority: medium
research_refs:
  - pm/research/remove-commands/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

PM activates the right workflow automatically based on what the user is trying to do — no command syntax to learn or remember. The using-pm skill, already preloaded at session start via SessionStart hook, routes every request to the correct skill. Commands were redundant wrappers around this same routing; removing them eliminates a maintenance layer and aligns PM with the proven Superpowers architecture pattern.

## Acceptance Criteria

1. Zero command files exist in `commands/` directory (directory itself removed)
2. All 23 skills remain invokable via the `Skill` tool
3. `plugin.json` manifests (Claude + Cursor) contain no `"commands"` key
4. `using-pm` skill routing table has an explicit entry for every workflow previously accessible via a command, and each entry routes to the same skill that the deleted command delegated to
5. Smoke test: given a fresh session with no prior PM invocation, a user requesting each of the 5 core workflows (research, groom, dev, pr, review) receives skill-based routing from using-pm with no `/pm:*` syntax in any AI response — verifying natural-language activation, not just plumbing
6. All workflow gaps identified during command removal (sync inline logic, view script path, merge routing) are resolved before `commands/` is deleted

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

Superpowers v5.0.5 (the most mature Claude Code plugin) has adopted skills-only architecture with deprecated command stubs. PM goes further with a clean break — no stubs, no gradual deprecation. Research across 18 plugins shows skills-dominant is the mature pattern; commands-only plugins are limited to simple utilities.

## Technical Feasibility

Feasible as scoped. All infrastructure for command-free operation already exists: SessionStart hook preloads using-pm, skills contain all logic, commands are thin wrappers. Two commands have inline logic requiring attention: `sync.md` (rsync workflow) and `view.md` (direct script invocation with different args than the view skill). No architectural changes needed — this is a subtraction initiative. Commands-only plugins in the ecosystem (commit-commands, code-review) are limited to simple utilities — PM's prior architecture placed it in that category despite having 20+ skills.

## Research Links

- [Plugin invocation patterns — commands vs skills](pm/research/remove-commands/findings.md)

## Notes

- Follow-on: skill files that surface `/pm:*` command syntax in user-visible strings (setup, strategy, groom, pr, dev-epic) should be updated in a separate pass
- The `merge` command routes to a specific section within `merge-watch/SKILL.md` — verify `using-pm` routing handles this correctly

## Backlog Conflicts

- **PM-055 (groom-centric-messaging):** ACs 6-8 update `commands/groom.md`, `commands/research.md`, and `commands/setup.md` — files this initiative deletes. PM-055's README rewrite (ACs 1-2) also conflicts with PM-059's README rewrite. **Resolution:** PM-055's groom-centric intent should be incorporated into PM-059's documentation rewrite — position groom and research as primary entry points in the skill-only README, not via command descriptions. PM-055's ACs 6-8 (command file updates) become obsolete.
- **PM-021 (pm-example-command-skill):** Plans to create `commands/example.md` using `commands/view.md` as a template. Directly invalidated — must be updated to reference skill structure instead, or closed.
- **PM-046 (manifest unification, done) and PM-047 (skill colocation, done):** Reference "17 commands" in their text. No action needed (shipped), but mental model is stale.
