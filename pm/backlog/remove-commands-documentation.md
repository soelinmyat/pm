---
type: backlog-issue
id: "PM-059"
title: "Update documentation for skill-only invocation model"
outcome: "All project documentation accurately reflects the skill-only architecture — new users and AI contributors understand how PM works without encountering dead command references"
status: done
parent: "remove-commands"
children: []
labels:
  - "documentation"
priority: medium
research_refs:
  - pm/research/remove-commands/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

README.md, GEMINI.md, and AGENTS.md are updated to reflect skill-only invocation. New users learn that PM auto-activates the right workflow — no command syntax to memorize. AI contributors (guided by AGENTS.md) understand the skill-only architecture and won't attempt to recreate deleted command files.

## Acceptance Criteria

1. `README.md` "Get Started" section replaced with natural-language invocation model — describes what users can do, not what commands to type
2. `README.md` no longer contains any `/pm:*` or `/dev:*` slash command syntax
3. `GEMINI.md` fully updated to remove all `/pm:*` and `/dev:*` slash command references (extends through the knowledge base section, not just the first 64 lines)
4. `AGENTS.md` "Runtime behavior" rules and change rules no longer reference `commands/` as a runtime surface or source of truth — this prevents AI contributors from recreating the deleted layer
5. `AGENTS.md` contributor guidance reflects skill-only architecture — instructs agents to work with skills, not commands. Includes rationale: commands would break Cursor/Codex compatibility since skills are the universal cross-platform format
6. `README.md` and marketplace description include an explicit statement of the form "PM activates the right workflow automatically — no commands to memorize" positioned before install instructions
7. `.codex/INSTALL.md` updated to remove `commands/` from the symlink reference list (currently at line 58: "agents/, commands/, hooks/, scripts/, and templates/")
8. No orphaned `/pm:*` or `/dev:*` command references remain in any `.md` file in the repository root or `docs/` directory (skill-internal references tracked separately as follow-on)

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

PM Skills Marketplace relies heavily on explicit command invocation (36 commands across 65 skills). PM's docs update can frame skill-auto-activation as a differentiator: "PM activates the right workflow automatically — you never need to remember a command." This makes the architectural advantage visible at the README/marketplace level where install decisions happen.

## Technical Feasibility

**Build-on:**
- All documentation files are standard markdown — straightforward text editing
- Competitive review suggested framing skill-auto-activation as a product claim in docs

**Build-new:**
- New "Get Started" content describing conversational/natural invocation
- New AGENTS.md contributor rules for skill-only architecture (include rationale: AI contributors that recreate commands break Cursor/Codex compatibility)
- Updated `.codex/INSTALL.md` symlink reference list

**Risks:**
- External references (blog posts, tutorials) using `/pm:*` syntax will silently break — not controllable, but the clean break is deliberate
- Coordinate this update with PM-058 merge to minimize the window of stale docs

**Sequencing:**
- Depends on PM-058 (infrastructure) being merged first — docs should reflect the actual state of the codebase

## Research Links

- [Plugin invocation patterns](pm/research/remove-commands/findings.md)

## Notes

- Decomposition pattern: Workflow Steps — documentation follows infrastructure changes
- Competitive strategist flagged opportunity: use docs update to make skill-auto-activation a visible product claim, not just a silent cleanup
- Follow-on concern: skill files that internally surface `/pm:*` syntax (setup, strategy, groom, pr, dev-epic) are excluded from this scope — track as separate issue if needed
