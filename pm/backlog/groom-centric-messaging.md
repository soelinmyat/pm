---
type: backlog-issue
id: "PM-055"
title: "Groom-centric messaging and routing"
outcome: "New users discover PM and immediately understand that /pm:groom is where to start — README, routing guide, hooks, and command descriptions all point to groom and research as the two hero entry points"
status: done
parent: "groom-hero"
children: []
labels:
  - "onboarding"
  - "documentation"
priority: high
research_refs:
  - pm/research/groom-hero/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

Every surface a user encounters — README, session start message, command palette, routing guide — positions `/pm:groom` and `/pm:research` as the two primary entry points. Setup is mentioned as optional configuration, not a first step. The mental model shifts from "setup → research → strategy → groom" to "groom (or research) → everything else on-demand."

## Acceptance Criteria

1. README "Get Started" section leads with `/pm:groom <your idea>` as the first command. `/pm:setup` is mentioned later as "optional: configure integrations."
2. README command table reorganized: "Core Commands" (groom, research, dev, dev-epic) at top, "Supporting Commands" (setup, strategy, ideate, dig, ingest, refresh, view) below.
3. `skills/using-pm/SKILL.md` routing table reordered: groom and research listed first in the PM skills section with a note marking them as primary entry points.
4. `skills/using-pm/SKILL.md` "Skill Priority" section updated to reflect groom-first ordering for product work.
5. `hooks/check-setup.sh` setup warning text changed from warning language to hint language (e.g., "Tip: run /pm:setup to configure integrations like Ahrefs and Linear" instead of "Warning: setup not complete").
6. `commands/groom.md` description updated to reflect its role as the primary entry point (e.g., "Start here — turn an idea into ready-to-build issues").
7. `commands/research.md` description updated similarly.
8. `commands/setup.md` description updated to reflect its optional nature (e.g., "Optional — configure integrations and preferences").
9. GEMINI.md and `.codex/INSTALL.md` "Getting Started" or equivalent sections updated to lead with `/pm:groom <idea>` as the first command, matching README changes in AC #1. `/pm:setup` documented as optional advanced configuration in both files.
10. `/pm:setup` remains fully functional and is clearly documented as an optional advanced path for configuring Linear, Ahrefs, and custom preferences — the escape hatch is preserved, not buried.

## User Flows

N/A — documentation/messaging changes, no user interaction flow.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

Superpowers eliminated all commands in favor of auto-activated skills — zero friction entry. gstack has no required sequence, each command is independent. Evil Martians (2026) identifies "works out of the box" as a trust signal for developer tool adoption. PM's current README starting with `/pm:setup` fails this test.

## Technical Feasibility

- **Build-on:** README is a standalone markdown file. `using-pm/SKILL.md` is a routing table. `check-setup.sh` warning is already non-blocking (accumulated in `$WARNINGS`, no exit). All are contained text edits.
- **Build-new:** Nothing structural. Pure content rewrites.
- **Risk:** `using-pm/SKILL.md` is injected at session start via the `session-start` hook — changes are immediately visible to all users at next session. No staging mechanism. Also, GEMINI.md and .codex/INSTALL.md need coordinated updates.
- **Sequencing:** No hard dependencies, but best done after PM-053 and PM-054 so the messaging accurately describes the auto-bootstrap behavior.

## Research Links

- [Groom-Centric Entry Point](pm/research/groom-hero/findings.md)

## Notes

- Decomposition rationale: Workflow Steps pattern — this is the messaging layer that shapes how users discover and understand the new hierarchy. Split from dashboard because these are static content changes while dashboard is runtime code.
- PM reviewer noted: "README rewrite is a marketing decision disguised as a scope item" — treat the README copy as a deliberate editorial decision about positioning, not just a formatting change.
