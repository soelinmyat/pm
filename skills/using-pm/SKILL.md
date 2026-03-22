---
name: using-pm
description: Use at session start — establishes how to find and use all plugin skills, requiring Skill tool invocation before implementation
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

# Using Plugin Skills

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Always invoke the relevant skill via the `Skill` tool before acting** — even if you think you know what to do.

## When to Invoke Which Skill

### Development Skills

| Trigger | Skill | Why |
|---------|-------|-----|
| Any new feature, bug fix, refactor, or test backfill | `dev:dev` | Master orchestrator — handles the full lifecycle |
| Multiple related issues / epic | `dev:dev-epic` | Orchestrates sub-issues with parallel dispatch |
| Creative work — new features, components, UI changes | `dev:brainstorming` | Explores intent and design before code |
| Multi-step task with spec or requirements | `dev:writing-plans` | Produces an implementation plan before code |
| Implementing any feature or bugfix | `dev:tdd` | Test-first discipline — write test, watch fail, implement |
| Independent tasks that can parallelize | `dev:subagent-dev` | Dispatches parallel agents for plan execution |
| Bug, test failure, or unexpected behavior | `dev:debugging` | Root cause investigation before any fix |
| Code review feedback received | `dev:receiving-review` | Technical rigor — verify before implementing suggestions |
| Ready to push / create PR | `dev:pr` | Review, push, PR, CI monitor + auto-fix |
| Multi-perspective code review | `dev:review` | Code + PM + design + edge-case review |
| Design quality check on running app | `dev:design-critique` | Multi-agent visual critique with screenshots |
| PR readiness monitoring | `dev:merge-watch` | Polls gates, auto-merges when ready |
| Merge a PR manually (no polling) | `dev:merge-watch` | Manual merge without polling loop — merge a PR, delete remote branch, clean up local branch and worktree. Follow the `# /merge` section |
| Batch bug resolution from cycle | `dev:bug-fix` | Triage all bugs, get approval, fix sequentially |

### Product Skills

| Trigger | Skill | Why |
|---------|-------|-----|
| **Groom backlog issues (primary entry point)** | `pm:groom` | Convert ideas into sprint-ready issues — start here for product work |
| **Research a topic or competitor (primary entry point)** | `pm:research` | Landscape mapping, competitor deep-dives |
| Product strategy work or generate strategy deck | `pm:strategy` | Positioning, strategic bets, GTM, strategy presentation |
| Generate feature ideas | `pm:ideate` | Idea generation from strategy + research |
| Ad-hoc deep research question | `pm:dig` | Focused research on a specific question |
| Import customer evidence | `pm:ingest` | Import files, transcripts, feedback |
| Audit research freshness | `pm:refresh` | Check for staleness, patch without losing content |
| Open dashboard / browse accumulated artifacts | `pm:view` | Launch the PM knowledge base dashboard to browse landscape, strategy, competitors, and backlog |
| Sync source to cache for testing | `pm:sync` | Immediate dev loop without publish cycle |
| First-time project configuration (optional) | `pm:setup` | Bootstrap knowledge base and integrations |

## The Rule

**Invoke relevant skills BEFORE any response or action.** If there's even a chance a skill applies, invoke it. If it turns out to be wrong for the situation, you don't need to follow it.

## Skill Priority

When multiple skills could apply:

1. **Product entry points first** (groom, research) — these are the primary starting points for product work
2. **Process skills second** (brainstorming, debugging, writing-plans) — these determine HOW to approach the task
3. **Implementation skills third** (tdd, subagent-dev) — these guide execution
4. **Lifecycle skills fourth** (pr, review, merge-watch) — these handle shipping

"I have an idea" → groom first, then dev for implementation.
"Research Y" → research for landscape, dig for a focused question.
"Build X" → brainstorming first, then tdd for implementation.
"Fix this bug" → debugging first, then tdd for the fix.
"Ship it" → pr for the full push + review flow.

## Red Flags

These thoughts mean STOP — you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /pr runs review gates before push |
| "I'll skip brainstorming, it's obvious" | Obvious features have unexamined assumptions |

## Instruction Priority

Plugin skills override default behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority
