---
name: using-pm
description: Use at session start — establishes how to find and use all plugin skills, requiring Skill tool invocation before implementation
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Purpose

Route session-start behavior and teach the runtime how to use PM skills. **Never force a PM workflow on a direct user request** — `using-pm` routes and orients, it does not hijack straightforward tasks into ceremony.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

## Hard rules

- **When work matches a skill in the tables below, invoke that skill — never perform its workflow inline without invoking it.** The skill invocation is the auditable unit: gates, state, and review evidence all key off it. Reviewing code without invoking `pm:review`, or critiquing UI without `pm:design-critique`, leaves no gate evidence and does not count.
- **Never force a PM workflow onto a direct question or an explicit user instruction** — routing discipline cuts both ways.

**Workflow:** `using-pm`

## Session Start

When this skill loads at the beginning of a new session:

1. Check the user's first message.
2. **If it's a direct question or a concrete task** — answer or route directly. Do **not** invoke `pm:start` just because `.pm/config.json` exists.
3. **If it's a session-opening request** ("start PM", "open PM", "show research", "what should I do next", or similarly general session kickoff) — check whether `.pm/config.json` exists in the project root.
4. **If `.pm/config.json` exists** — invoke `pm:start` before responding (Resume/Pulse path).
5. **If `.pm/config.json` does not exist** — print: "PM not initialized. Run /pm:start to set up." Do not invoke `pm:start`.

Once a concrete PM workflow is already active (`pm:groom`, `pm:dev`, `pm:research`, or another explicit lane), stay in that lane — don't bounce the user back through `using-pm`.

# Using Plugin Skills

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Default to invoking the relevant skill before acting** — but user instructions always take precedence.

## Entry Points (start here)

These are the skills you invoke directly. Most other capabilities are built into these as phases or references.

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Let's think about X" / "What if we" / "Brainstorm" / "I'm wondering" | `pm:think` | Structured product thinking — challenge assumptions, explore approaches, weigh tradeoffs. Promotes to groom when ready |
| "Build X" / "Fix this bug" / "Debug this" / "Not working" | `pm:dev` | Implements from an approved RFC. Prompts to run /rfc first for M+ work without one. Auto-grooms ungroomed work. |
| "I have an idea" / "Spec this" / "Write a PRD" / "Break this down" | `pm:groom` | Product discovery → proposal (PRD). 4 tiers: quick, standard, full, agent (autonomous, mature-KB-only, claude-only). No issue splitting — that's dev's job via RFC. `pm:groom ideate` for idea generation |
| "Design this" / "Write an RFC" / "Technical plan" | `pm:rfc` | Technical design (RFC) for M+ work. Generates architecture, issue breakdown, and review. Outputs an RFC. |
| "Research Y" / "Look into" / "Analyze market" / "Should we do X?" | `pm:research` | Landscape, competitors, or a saved topic deep dive. For quick factual questions, answer directly instead of creating research artifacts |
| "Strategy" / "Positioning" / "ICP" / "Product direction" | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| "Ship it" / "Push this" / "Create PR" / "Ready for review" | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |
| "Merge this PR" / "Land this" / "Fix PR comments" / "Resolve CI" | Merge workflow | Self-healing merge loop — fix CI, resolve review comments, handle conflicts, merge |

## Sub-Skills (called by orchestrators)

Rarely invoked directly — called by `dev`, `ship`, or `groom` at the right stage.

| Skill | Called by | Purpose |
|-------|----------|---------|
| `dev/references/tdd.md` | dev (all sizes) | Test-first discipline |
| `dev/references/subagent-dev.md` | dev (all sizes) | Dispatches parallel agents for plan execution |
| `dev/references/debugging.md` | dev (when tests fail) | Root cause investigation before any fix |
| `pm:review` | dev (M/L/XL), ship | Multi-agent review, 6-lens fan-out (bugs, design, edge cases, reuse, quality, efficiency — the last three absorbed from the former pm:simplify). Runtime-uniform. Tiers findings by confidence, auto-fixes high-confidence bugs. |
| `ship/references/handling-feedback.md` | dev, ship | Verify feedback before implementing suggestions |
| `rfc/references/spec-reviewers.md` | rfc (generation step) | Specialist reviewers for raw sub-issue specs before RFC |
| `rfc/references/cross-cutting-reviewers.md` | rfc (review step) | Cross-cutting concern reviewers (security, perf, ops) |
| `pm:design-critique` | dev (UI changes), standalone UI review | PM-native design review with screenshots, a11y snapshots, consistency audit, and gate manifest update |
| `dev/references/qa.md` | dev (UI changes) | QA ship gate — assertion-driven testing via Playwright MCP, health score verdict |

## Utilities

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Import feedback" / "Add evidence" / "Customer data" | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| "What's outdated?" / "Update research" / "Stale data" | `pm:refresh` | Check for staleness, patch without losing content |
| "Open pm" / "View research" / "Show knowledge base" | `pm:start` | Project pulse, onboarding |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## Instruction Priority

User instructions always take precedence over plugin skills:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority

If the user asks a direct question or wants a quick answer, give them one. Don't force a skill flow when the user doesn't want one.

## Escalation Paths

- **User wants general orientation, not a specific task:** "Want to open PM with `/pm:start`, or should I route you directly to the lane that matches what you want to do?"
- **PM is not initialized in this project:** "PM isn’t initialized here yet. Want to run `/pm:start` to set it up, or continue without PM?"
- **A concrete PM lane is clearly a better fit:** "This looks like `{skill}` work rather than session routing. I’ll switch there directly unless you want a broader PM overview first."
