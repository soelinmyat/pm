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

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Default to invoking the relevant skill before acting** — but user instructions always take precedence.

## Entry Points (start here)

These are the skills you invoke directly. Most other capabilities are built into these as phases or references.

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Let's think about X" / "What if we" / "Brainstorm" / "I'm wondering" | `pm:think` | Structured product thinking — challenge assumptions, explore approaches, weigh tradeoffs. Promotes to groom when ready |
| "Build X" / "Fix this bug" / "Debug this" / "Not working" | `pm:dev` | Auto-detects scope. Checks for RFC; generates one if missing. Then implements. Auto-grooms ungroomed work. |
| "I have an idea" / "Spec this" / "Write a PRD" / "Break this down" | `pm:groom` | Product discovery → proposal (PRD). 3 tiers: quick, standard, full. No issue splitting — that's dev's job via RFC. `pm:groom ideate` for idea generation |
| "Research Y" / "Look into" / "Analyze market" / "Should we do X?" | `pm:research` | Landscape, competitors, topic. Use `quick` mode for fast inline questions |
| "Strategy" / "Positioning" / "ICP" / "Product direction" | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| "Ship it" / "Push this" / "Create PR" / "Ready for review" | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |
| "Deploy" / "Release" / "Push to production" | `pm:deploy` | Create PR from main to production, self-heal CI/threads/conflicts, auto-merge |
| "Merge this PR" / "Land this" / "Fix PR comments" / "Resolve CI" | Merge workflow | Self-healing merge loop — fix CI, resolve review comments, handle conflicts, merge |

## Sub-Skills (called by orchestrators)

Rarely invoked directly — called by `dev`, `ship`, or `groom` at the right stage.

| Skill | Called by | Purpose |
|-------|----------|---------|
| `pm:simplify` | dev (pre-review/pre-design gate) | Single simplify entrypoint; routes by runtime and normalizes PM-required fields |
| `pm:tdd` | dev (all sizes) | Test-first discipline |
| `pm:subagent-dev` | dev (all sizes) | Dispatches parallel agents for plan execution |
| `pm:debugging` | dev (when tests fail) | Root cause investigation before any fix |
| `pm:review` | ship | Multi-perspective code review (code + PM + design + edge-cases) |
| `pm:review` (handling-feedback ref) | dev, ship | Verify feedback before implementing suggestions |
| `pm:design-critique` | dev (UI changes) | Multi-agent visual critique with screenshots |
| `pm:qa` | dev (UI changes) | QA ship gate — assertion-driven testing via Playwright MCP, health score verdict |

## Utilities

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Import feedback" / "Add evidence" / "Customer data" | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| "What's outdated?" / "Update research" / "Stale data" | `pm:refresh` | Check for staleness, patch without losing content |
| "Show dashboard" / "Open pm" / "View research" | `pm:start` | Project pulse, dashboard launch, onboarding |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## Shared References (consulted by skills, never invoked)

| Reference | What it covers |
|-----------|---------------|
| `references/writing.md` | Prose quality, document structure, HTML generation, slide rules |
| `references/merge-loop.md` | Self-healing merge loop — shared by the merge compatibility alias and ship skill |
| `references/review-gate.md` | Dispatch-collect-fix-loop pattern for all review gates |
| `references/visual.md` | Dashboard-first UI invocation standard |
| `references/templates/` | Strategy deck and proposal HTML templates |

## Instruction Priority

User instructions always take precedence over plugin skills:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority

If the user asks a direct question or wants a quick answer, give them one. Don't force a skill flow when the user doesn't want one.

## The Rule

**Default to invoking relevant skills before acting.** If there's a clear skill match for what the user is doing, invoke it. If it turns out to be wrong for the situation, you don't need to follow it. But if the user's request is straightforward or they've given explicit instructions, follow those first.

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

Keep it to 3-6 steps. Use plain language. Name the gates that will run (TDD, review, design critique, etc.) so the user knows what to expect. If the skill has optional phases (e.g., design system discovery, dashboard session view), mention them as conditional: "If your project has a design system, I'll use it for mockups."

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

## Red Flags

When the user is starting a workflow (building, shipping, grooming), these thoughts mean you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /ship runs review gates before push |
| "I'll skip the design phase, it's obvious" | Obvious features have unexamined assumptions |

These do NOT apply when the user is asking a direct question, requesting a quick answer, or giving explicit instructions that override the default flow.

## Activity Analytics (opt-in)

Analytics are opt-in per project. See `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md` for the full contract (enabling, CLI surface, file formats, state-file fields).
