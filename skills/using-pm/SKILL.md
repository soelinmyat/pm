---
name: using-pm
description: Use at session start — establishes how to find and use all plugin skills, requiring Skill tool invocation before implementation
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Purpose

Route session-start behavior and teach the runtime how to use PM skills without forcing PM ceremony onto direct questions or explicit user instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER FORCE A PM WORKFLOW ON A DIRECT USER REQUEST.** `using-pm` exists to route or orient, not to hijack straightforward tasks into ceremony.

**Workflow:** `using-pm` | **Telemetry steps:** `session-start`, `route`.

## When NOT to use

Do not lean on this skill once a concrete PM workflow is already active. If the user is already in `pm:groom`, `pm:dev`, `pm:research`, or another explicit lane, stay in that lane.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/using-pm/steps/` in numeric filename order. If `.pm/workflows/using-pm/` exists, same-named files there override defaults. Execute each step in order — the first handles session-start routing, the second handles skill routing discipline.

## Session Start

When this skill loads at the beginning of a new session:

1. Check the user's first message.
2. **If it's a direct question or a concrete task** — answer or route directly. Do **not** invoke `pm:start` just because `.pm/config.json` exists.
3. **If it's a session-opening request** ("start PM", "open PM", "show research", "what should I do next", or similarly general session kickoff) — check whether `.pm/config.json` exists in the project root.
4. **If `.pm/config.json` exists** — invoke `pm:start` before responding (Resume/Pulse path).
5. **If `.pm/config.json` does not exist** — print: "PM not initialized. Run /pm:start to set up." Do not invoke `pm:start`.

# Using Plugin Skills

This plugin provides structured workflows for the product engineer — from discovery and strategy through implementation and merge. **Default to invoking the relevant skill before acting** — but user instructions always take precedence.

## Entry Points (start here)

These are the skills you invoke directly. Most other capabilities are built into these as phases or references.

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Let's think about X" / "What if we" / "Brainstorm" / "I'm wondering" | `pm:think` | Structured product thinking — challenge assumptions, explore approaches, weigh tradeoffs. Promotes to groom when ready |
| "Build X" / "Fix this bug" / "Debug this" / "Not working" | `pm:dev` | Implements from an approved RFC. Prompts to run /rfc first for M+ work without one. Auto-grooms ungroomed work. |
| "I have an idea" / "Spec this" / "Write a PRD" / "Break this down" | `pm:groom` | Product discovery → proposal (PRD). 3 tiers: quick, standard, full. No issue splitting — that's dev's job via RFC. `pm:groom ideate` for idea generation |
| "Design this" / "Write an RFC" / "Technical plan" | `pm:rfc` | Technical design (RFC) for M+ work. Generates architecture, issue breakdown, and review. Outputs an RFC. |
| "Research Y" / "Look into" / "Analyze market" / "Should we do X?" | `pm:research` | Landscape, competitors, or a saved topic deep dive. For quick factual questions, answer directly instead of creating research artifacts |
| "Strategy" / "Positioning" / "ICP" / "Product direction" | `pm:strategy` | Positioning, ICP, competitive positioning, priorities |
| "Ship it" / "Push this" / "Create PR" / "Ready for review" | `pm:ship` | Review, push, PR, CI monitor, gate polling, auto-merge |
| "Merge this PR" / "Land this" / "Fix PR comments" / "Resolve CI" | Merge workflow | Self-healing merge loop — fix CI, resolve review comments, handle conflicts, merge |

## Sub-Skills (called by orchestrators)

Rarely invoked directly — called by `dev`, `ship`, or `groom` at the right stage.

| Skill | Called by | Purpose |
|-------|----------|---------|
| `dev/references/simplify.md` | dev (pre-review/pre-design gate) | Single simplify entrypoint; routes by runtime and normalizes PM-required fields |
| `dev/references/tdd.md` | dev (all sizes) | Test-first discipline |
| `dev/references/subagent-dev.md` | dev (all sizes) | Dispatches parallel agents for plan execution |
| `dev/references/debugging.md` | dev (when tests fail) | Root cause investigation before any fix |
| `pm:review` | ship | Multi-perspective code review (code + PM + design + edge-cases) |
| `pm:review` (handling-feedback ref) | dev, ship | Verify feedback before implementing suggestions |
| `rfc/references/spec-reviewers.md` | rfc (generation step) | Specialist reviewers for raw sub-issue specs before RFC |
| `rfc/references/cross-cutting-reviewers.md` | rfc (review step) | Cross-cutting concern reviewers (security, perf, ops) |
| `dev/references/design-critique.md` | dev (UI changes) | Design review with screenshots, a11y snapshots, consistency audit |
| `dev/references/qa.md` | dev (UI changes) | QA ship gate — assertion-driven testing via Playwright MCP, health score verdict |

## Utilities

| User says | Skill | What it does |
|-----------|-------|--------------|
| "Import feedback" / "Add evidence" / "Customer data" | `pm:ingest` | Import files, transcripts, feedback into pm/ |
| "What's outdated?" / "Update research" / "Stale data" | `pm:refresh` | Check for staleness, patch without losing content |
| "Open pm" / "View research" / "Show knowledge base" | `pm:start` | Project pulse, onboarding |
| First-time setup | `pm:setup` | Bootstrap knowledge base and integrations |

## Shared References (consulted by skills, never invoked)

| Reference | What it covers |
|-----------|---------------|
| `references/writing.md` | Prose quality, document structure, output format, frontmatter compliance |
| `references/merge-loop.md` | Self-healing merge loop — used by the ship skill |
| `references/review-gate.md` | Dispatch-collect-fix-loop pattern for all review gates |
| `references/templates/` | RFC HTML template and wireframe references |

## Instruction Priority

User instructions always take precedence over plugin skills:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **Plugin skills** — override defaults where they conflict
3. **Default system prompt** — lowest priority

If the user asks a direct question or wants a quick answer, give them one. Don't force a skill flow when the user doesn't want one.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"PM is installed, so I should always invoke `pm:start` first."** Wrong. Direct questions and concrete tasks should be answered or routed directly.
- **"The user probably wants ceremony even though they asked for a simple answer."** `using-pm` should reduce friction, not create it.
- **"I can skip explaining the available lanes because I know the right one."** Part of this skill is making the routing surface legible to the user.
- **"Default skill usage overrides explicit user instructions."** It does not. User instructions still win.

## Escalation Paths

- **User wants general orientation, not a specific task:** "Want to open PM with `/pm:start`, or should I route you directly to the lane that matches what you want to do?"
- **PM is not initialized in this project:** "PM isn’t initialized here yet. Want to run `/pm:start` to set it up, or continue without PM?"
- **A concrete PM lane is clearly a better fit:** "This looks like `{skill}` work rather than session routing. I’ll switch there directly unless you want a broader PM overview first."

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

Keep it to 3-6 steps. Use plain language. Name the gates that will run (TDD, review, design critique, etc.) so the user knows what to expect. If the skill has optional phases (e.g., design system discovery), mention them as conditional: "If your project has a design system, I'll use it for mockups."

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

## Common Rationalizations

When the user is starting a workflow (building, shipping, grooming), these thoughts mean you're skipping discipline:

| Thought | Reality |
|---------|---------|
| "This is too simple for /dev" | XS tasks still get TDD + auto-merge gates |
| "I'll just write the code first" | TDD means test first. Always. |
| "I know the fix already" | Debugging skill exists to prevent wrong fixes |
| "Let me just push this" | /ship runs review gates before push |
| "I'll just create a branch and PR manually" | /ship handles branch, push, PR, CI, and merge as one flow |
| "I'll skip the design phase, it's obvious" | Obvious features have unexamined assumptions |

These do NOT apply when the user is asking a direct question, requesting a quick answer, or giving explicit instructions that override the default flow.

## Before Marking Done

- [ ] Session-start routing respected the user's actual intent
- [ ] `pm:start` was only invoked when the request was genuinely a kickoff/open-PM action
- [ ] The user was either routed into the right PM skill or allowed to continue without forced PM ceremony

## Activity Analytics (opt-in)

Analytics are opt-in per project. See `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md` for the full contract (enabling, CLI surface, file formats, state-file fields).
