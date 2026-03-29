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

These are the skills you invoke directly. Most other capabilities are built into these as phases or references.

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Any development work (feature, bug, refactor, epic, batch bugs) | `pm:dev` | Auto-detects scope: single issue lifecycle, epic orchestration, or batch bug triage |
| Groom backlog issues / product discovery / generate ideas | `pm:groom` | Convert ideas into sprint-ready issues. Use `pm:groom ideate` for idea generation |
| Research a topic, competitor, or market | `pm:research` | Landscape, competitors, topic, or quick inline questions |
| Product strategy or strategy deck | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| Ready to push / create PR / merge | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |

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
| `pm:qa` | dev (UI changes) | QA ship gate — test charter, Playwright/Maestro testing, health score verdict |

## Utilities

| Trigger | Skill | What it does |
|---------|-------|--------------|
| Import customer evidence | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| Audit research freshness | `pm:refresh` | Check for staleness, patch without losing content |
| Open dashboard | `pm:view` | Launch PM knowledge base dashboard |
| Sync source to cache | `pm:sync` | Dev loop without publish cycle |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## Shared References (consulted by skills, never invoked)

| Reference | What it covers |
|-----------|---------------|
| `references/writing.md` | Prose quality, document structure, HTML generation, slide rules |
| `references/review-gate.md` | Dispatch-collect-fix-loop pattern for all review gates |
| `references/visual.md` | Dashboard-first UI invocation standard |
| `references/templates/` | Strategy deck and proposal HTML templates |

## The Rule

**Invoke relevant skills BEFORE any response or action.** If there's even a chance a skill applies, invoke it. If it turns out to be wrong for the situation, you don't need to follow it.

## Quick Decision Guide

| User says | Invoke |
|-----------|--------|
| "I have an idea" / "spec this" / "write a PRD" / "break this down" | `pm:groom` → then `pm:dev` for implementation |
| "What should we build?" / "create tickets" | `pm:groom ideate` |
| "Research Y" / "look into" / "analyze market" | `pm:research` (use `quick` mode for fast inline questions) |
| "Should we do X?" | `pm:research quick` |
| "Build X" | `pm:dev` (triggers design exploration internally for M/L/XL) |
| "Fix this bug" / "debug this" / "not working" / "help me debug" | `pm:dev` (triggers debugging internally) |
| "Ship it" / "Push this" / "deploy" / "create PR" / "ready for review" | `pm:ship` |
| "Merge this PR" / "land this" | `pm:ship` (invoke with `/merge` for manual merge without polling) |
| "Fix the PR comments" / "Resolve CI" / "Get this PR merged" | `pm:ship` (detects existing PR, enters gate monitoring) |
| "Handle PR #123" / "Fix review feedback on PR" | `pm:ship` (with PR number if provided) |
| "Show dashboard" / "open pm" / "view research" | `pm:view` |
| "Import feedback" / "add evidence" / "customer data" | `pm:ingest` |
| "What's outdated?" / "update research" / "stale data" | `pm:refresh` |

## Red Flags

These thoughts mean STOP — you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /ship runs review gates before push |
| "I'll skip the design phase, it's obvious" | Obvious features have unexamined assumptions |

## Activity Analytics (opt-in)

When the project has `.claude/pm.local.md` with `analytics: true` in YAML frontmatter, log significant actions during skill flows.

**Check at session start:**
```bash
# Read analytics flag — silent if file doesn't exist
PM_ANALYTICS=$(sed -n 's/^analytics: *//p' .claude/pm.local.md 2>/dev/null | head -1)
```

If `PM_ANALYTICS` is `true`, log events at every significant step using:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh <skill> <event> [detail]
```

**When to log (all skills):**

| Event | When | Example |
|-------|------|---------|
| `started` | Skill invoked | `pm-log.sh dev started` |
| `completed` | Skill finished | `pm-log.sh dev completed "duration=1200s"` |
| `blocked` | Cannot proceed | `pm-log.sh dev blocked "no test framework"` |

**dev-specific events:**

| Event | When | Detail |
|-------|------|--------|
| `size_classified` | After sizing | `size=M` |
| `tdd_started` | TDD phase begins | `test_count=4` |
| `tdd_completed` | Tests written + passing | |
| `design_system_discovered` | Design tokens found | `tailwind=true,tokens=true` |
| `existing_page_captured` | Screenshot taken | `page=/settings` |
| `implementation_started` | Coding begins | |
| `implementation_completed` | Code done | |
| `review_dispatched` | Code review launched | `agents=3` |
| `review_passed` | Review gate passed | `score=B+` |
| `review_skipped` | Review not run | `reason=XS_size` |
| `design_critique_dispatched` | Design critique launched | |
| `design_critique_passed` | Design gate passed | `score=A` |
| `design_critique_skipped` | No UI changes | `reason=no_ui` |
| `qa_dispatched` | QA gate launched | |
| `qa_passed` | QA gate passed | `health=92` |
| `qa_skipped` | QA not run | `reason=no_ui` |
| `debugging_started` | Root cause investigation | |
| `debugging_completed` | Fix verified | `hypotheses=2` |

**groom-specific events:**

| Event | When | Detail |
|-------|------|--------|
| `phase_entered` | Each groom phase | `phase=3.5-design` |
| `strategy_check_passed` | Strategy exists | |
| `strategy_check_missing` | No strategy.md | |
| `research_dispatched` | Research sub-agent | `mode=landscape` |
| `visual_companion_started` | Browser mockups active | `port=52341` |
| `visual_companion_declined` | User said no | |
| `design_system_discovered` | Tokens extracted | `tailwind=true` |
| `existing_page_captured` | Live screenshot taken | `page=/settings` |
| `mockup_generated` | High-fidelity mockup | `file=layout-v2.html` |
| `design_review_passed` | Mockup review done | |
| `spec_written` | Design doc saved | `path=docs/specs/...` |
| `spec_review_passed` | Spec reviewer approved | `iterations=2` |
| `scope_completed` | Issues created | `issue_count=5` |

**ship-specific events:**

| Event | When | Detail |
|-------|------|--------|
| `review_dispatched` | Code review launched | `agents=3` |
| `review_passed` | Review approved | |
| `pr_created` | PR opened | `pr=#42` |
| `ci_passed` | CI green | |
| `ci_failed` | CI red | `failures=2` |
| `ci_fixed` | Auto-fix applied | `attempt=1` |
| `auto_merge_triggered` | Merge initiated | |
| `merged` | PR merged | |

**research/strategy events:**

| Event | When | Detail |
|-------|------|--------|
| `mode_selected` | Research mode chosen | `mode=competitors` |
| `competitors_profiled` | Profiling done | `count=5` |
| `strategy_written` | Strategy doc saved | |
| `deck_generated` | Presentation created | |

**Log output goes to:** `.pm/analytics/activity.jsonl` in the project root. Add `.pm/analytics/` to `.gitignore`.

**When analytics is off:** Skip all logging. No overhead, no side effects.

## Instruction Priority

Plugin skills override default behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority
