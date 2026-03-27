---
name: using-pm
description: Use at session start — establishes how to find and use all plugin skills, requiring Skill tool invocation before implementation
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

# Using Plugin Skills

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Always invoke the relevant skill via the `Skill` tool before acting** — even if you think you know what to do.

## Entry Points (start here)

These are the skills you invoke directly. Most other skills are called internally by these.

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Any new feature, bug fix, refactor, or test backfill | `pm:dev` | Master orchestrator — full lifecycle from intake to merge |
| Multiple related issues / epic | `pm:dev-epic` | Orchestrates sub-issues with parallel dispatch |
| Groom backlog issues / product discovery | `pm:groom` | Convert ideas into sprint-ready issues |
| Research a topic, competitor, or market | `pm:research` | Landscape mapping, competitor deep-dives, quick questions |
| Product strategy or strategy deck | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| Ready to push / create PR / merge | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |
| Batch bug resolution from cycle | `pm:bug-fix` | Triage all bugs, get approval, fix sequentially |

## Sub-Skills (called by orchestrators)

These are rarely invoked directly — they're called by `dev`, `ship`, or `groom` at the right stage.

| Skill | Called by | Purpose |
|-------|----------|---------|
| `pm:brainstorming` | dev (M/L/XL) | Explores intent and design before code |
| `pm:writing-plans` | dev (M/L/XL) | Creates implementation plan from spec |
| `pm:tdd` | dev (all sizes) | Test-first discipline |
| `pm:subagent-dev` | dev (all sizes) | Dispatches parallel agents for plan execution |
| `pm:debugging` | dev (when tests fail) | Root cause investigation before any fix |
| `pm:review` | ship | Multi-perspective code review (code + PM + design + edge-cases) |
| `pm:receiving-review` | ship | Verify feedback before implementing suggestions |
| `pm:design-critique` | dev (UI changes) | Multi-agent visual critique with screenshots |

## Utilities

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Generate feature ideas | `pm:ideate` | Mines knowledge base for ranked opportunities |
| Import customer evidence | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| Audit research freshness | `pm:refresh` | Check for staleness, patch without losing content |
| Open dashboard | `pm:view` | Launch PM knowledge base dashboard |
| Sync source to cache | `pm:sync` | Dev loop without publish cycle |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## The Rule

**Invoke relevant skills BEFORE any response or action.** If there's even a chance a skill applies, invoke it. If it turns out to be wrong for the situation, you don't need to follow it.

## Quick Decision Guide

| User says | Invoke |
|-----------|--------|
| "I have an idea" | `pm:groom` → then `pm:dev` for implementation |
| "Research Y" | `pm:research` (use `quick` mode for fast inline questions) |
| "Build X" | `pm:dev` (triggers brainstorming internally for M/L/XL) |
| "Fix this bug" | `pm:dev` (triggers debugging internally) |
| "Ship it" / "Push this" | `pm:ship` |
| "Merge this PR" | `pm:ship` (invoke with `/merge` for manual merge without polling) |
| "Should we do X?" | `pm:research quick` |
| "What should we build?" | `pm:ideate` |

## Red Flags

These thoughts mean STOP — you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /ship runs review gates before push |
| "I'll skip brainstorming, it's obvious" | Obvious features have unexamined assumptions |

## Instruction Priority

Plugin skills override default behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority
