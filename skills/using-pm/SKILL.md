---
name: using-pm
description: Use at session start — establishes how to find and use all plugin skills, requiring Skill tool invocation before implementation
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Session Start

When this skill loads at the beginning of a new session, invoke `pm:start` before responding to the user. This launches the dashboard, shows the project pulse, and handles onboarding if there is no knowledge base yet.

# Using Plugin Skills

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Always invoke the relevant skill before acting** — even if you think you know what to do.

## Entry Points (start here)

These are the skills you invoke directly. Most other capabilities are built into these as phases or references.

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Thinking through an idea, brainstorming, exploring options | `pm:think` | Structured product thinking — challenge assumptions, explore approaches, weigh tradeoffs. No ceremony. Promotes to groom when ready |
| Any development work (feature, bug, refactor, epic, batch bugs) | `pm:dev` | Auto-detects scope: single issue lifecycle, epic orchestration, or batch bug triage |
| Groom backlog issues / product discovery / generate ideas | `pm:groom` | Convert ideas into sprint-ready issues. 3 tiers: quick (scope + issues), standard (+ strategy + research), full (all phases). Auto-detected or say "quick/standard/full groom". Use `pm:groom ideate` for idea generation |
| Research a topic, competitor, or market | `pm:research` | Landscape, competitors, topic, or quick inline questions |
| Product strategy or strategy deck | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| Ready to push / create PR / merge | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |
| Deploy main to production | `pm:deploy` | Create PR from main to production, self-heal CI/threads/conflicts, auto-merge |
| Self-heal a PR until merged | Merge workflow | Fix CI, resolve review comments, handle conflicts, merge. On platforms with command aliases, this is exposed as `/merge`. |

## Sub-Skills (called by orchestrators)

Rarely invoked directly — called by `dev`, `ship`, or `groom` at the right stage.

| Skill | Called by | Purpose |
|-------|----------|---------|
| `pm:tdd` | dev (all sizes) | Test-first discipline |
| `pm:subagent-dev` | dev (all sizes) | Dispatches parallel agents for plan execution |
| `pm:debugging` | dev (when tests fail) | Root cause investigation before any fix |
| `pm:review` | ship | Multi-perspective code review (code + PM + design + edge-cases) |
| `pm:review` (handling-feedback ref) | dev, ship | Verify feedback before implementing suggestions |
| `pm:design-critique` | dev (UI changes) | Multi-agent visual critique with screenshots |
| `pm:qa` | dev (UI changes) | QA ship gate — assertion-driven testing via Playwright MCP, health score verdict |

## Utilities

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Import customer evidence | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| Audit research freshness | `pm:refresh` | Check for staleness, patch without losing content |
| Open dashboard / session greeting | `pm:start` | Project pulse, dashboard launch, onboarding |
| Sync source to cache | `pm:sync` | Dev loop without publish cycle |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## Shared References (consulted by skills, never invoked)

| Reference | What it covers |
|-----------|---------------|
| `references/writing.md` | Prose quality, document structure, HTML generation, slide rules |
| `references/merge-loop.md` | Self-healing merge loop — shared by the merge compatibility alias and ship skill |
| `references/review-gate.md` | Dispatch-collect-fix-loop pattern for all review gates |
| `references/visual.md` | Dashboard-first UI invocation standard |
| `references/templates/` | Strategy deck and proposal HTML templates |

## The Rule

**Invoke relevant skills BEFORE any response or action.** If there's even a chance a skill applies, invoke it. If it turns out to be wrong for the situation, you don't need to follow it.

## Skill Bookends

Every skill invocation MUST start with a plan and end with a summary.

### Opening (before any work)

After the skill is loaded but before doing anything, tell the user what's about to happen:

```
**[Skill Name]** — here's the plan:
1. [Step 1 — what you'll do first]
2. [Step 2 — what comes next]
3. [Step 3 — etc.]

I'll check in with you at [decision points]. Let's start.
```

Keep it to 3-6 steps. Use plain language. Name the gates that will run (TDD, review, design critique, etc.) so the user knows what to expect. If the skill has optional phases (e.g., design system discovery, visual companion), mention them as conditional: "If your project has a design system, I'll use it for mockups."

### Closing (after all work is done)

End every skill with a structured summary:

```
**Done.** Here's what happened:

- **What:** [1-2 sentence summary of what was accomplished]
- **Key decisions:** [Any choices made during the flow]
- **Artifacts:** [Files created/modified, PRs opened, issues created — with paths/links]
- **Gates:** [Which gates ran and their results — e.g., "Review: passed (B+)", "Design critique: skipped (no UI)", "TDD: 4 tests written"]
- **Next steps:** [What the user should do next, if anything]
```

Skip sections that don't apply. If the skill was blocked or abandoned, say what happened and why.

## Quick Decision Guide

| User says | Invoke |
|-----------|--------|
| "Let's think about X" / "What if we" / "How should we" / "I'm wondering" / "Brainstorm" | `pm:think` — structured thinking, promotes to groom when ready |
| "I have an idea" / "spec this" / "write a PRD" / "break this down" | `pm:groom` → then `pm:dev` for implementation |
| "What should we build?" / "create tickets" | `pm:groom ideate` |
| "Research Y" / "look into" / "analyze market" | `pm:research` (use `quick` mode for fast inline questions) |
| "Should we do X?" | `pm:research quick` |
| "Build X" | `pm:dev` (auto-grooms ungroomed issues at the right depth before implementation) |
| "Fix this bug" / "debug this" / "not working" / "help me debug" | `pm:dev` (triggers debugging internally; quick-grooms if issue lacks AC) |
| "Ship it" / "Push this" / "create PR" / "ready for review" | `pm:ship` |
| "Deploy" / "deploy to production" / "release" / "push to production" | `pm:deploy` — create PR from main to production, self-heal, auto-merge |
| "Merge this PR" / "land this" / "get this merged" | merge workflow — self-healing merge loop |
| "Fix the PR comments" / "Resolve CI" / "fix review feedback" | merge workflow — fixes, replies, resolves threads, merges |
| "Show dashboard" / "open pm" / "view research" | `pm:start` |
| "Import feedback" / "add evidence" / "customer data" | `pm:ingest` |
| "What's outdated?" / "update research" / "stale data" | `pm:refresh` |

## Red Flags

These thoughts mean STOP — you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "I'll just answer their question directly" | If the user is thinking aloud, invoke pm:think — don't freeform |
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /ship runs review gates before push |
| "I'll skip the design phase, it's obvious" | Obvious features have unexamined assumptions |

## Activity Analytics (opt-in)

When the project has `.claude/pm.local.md` with `analytics: true` in YAML frontmatter, skill invocations are logged automatically via a `PostToolUse` hook on the `Skill` tool.

**How it works:** The hook (`hooks/analytics-log.sh`) fires after every `Skill` tool call, checks the analytics flag, and logs `pm:` skill invocations to `.pm/analytics/activity.jsonl`. No manual logging required — skills don't need to call `pm-log.sh` themselves.

**For milestone events within a skill** (e.g., review passed, TDD completed, PR merged), skills can still log directly:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh <skill> <event> [detail]
```

Only do this after checking the flag:
```bash
ANALYTICS=$(sed -n 's/^analytics: *//p' .claude/pm.local.md 2>/dev/null | head -1)
[ "$ANALYTICS" = "true" ] && ${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh dev review_passed "score=B+"
```

**Log output:** `.pm/analytics/activity.jsonl` in the project root. Add `.pm/analytics/` to `.gitignore`.

**When analytics is off:** Hook exits immediately. No overhead, no side effects.

## Instruction Priority

Plugin skills override default behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority
