---
name: pm-ideate
description: "Use when generating feature ideas from the product knowledge base. Scans strategy, landscape, competitors, research, customer evidence, and backlog to surface ranked opportunities. Triggers on 'ideate,' 'feature ideas,' 'what should we build,' 'opportunities,' 'brainstorm features.'"
---

# pm:ideate

## Purpose

Surface what to build next. Ideate mines the entire knowledge base — strategy, landscape, competitor gaps, customer evidence, and existing backlog — to generate ranked feature ideas grounded in evidence, not guesswork.

Ideas are early-stage backlog items. They live in `pm/backlog/` with `status: idea` and get promoted to `drafted` when groomed. One place, one flow:
**setup → research → strategy → ideate → groom**

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

---

## Prerequisite Check

1. Check if `pm/strategy.md` exists. If not:
   > "No strategy doc found. Ideation without strategy is just brainstorming. Run $pm-strategy first?"
   Wait for response. Do not block — proceed if the user insists.

2. Check if `pm/landscape.md` exists. Note its presence for signal mining. Not required.

3. Check if `pm/competitors/index.md` exists. Note profiled competitors. Not required.

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Signal Sources

Read all available sources before generating ideas. Each idea must trace back to at least one signal.

| Source | Path | What to extract |
|---|---|---|
| Strategy priorities | `pm/strategy.md` § 6 | Top 3 priorities — ideas should advance these |
| Strategy non-goals | `pm/strategy.md` § 7 | Filter out ideas that conflict |
| Market gaps | `pm/competitors/index.md` § Market Gaps | Capabilities absent across competitors |
| Feature matrix | `pm/competitors/matrix.md` | Cells where the product shows "No" or "Planned" |
| Competitor weaknesses | `pm/competitors/*/profile.md` § Weaknesses | Problems competitors have that we could solve better |
| Landscape observations | `pm/landscape.md` § Initial Observations | Whitespace and macro trends |
| Keyword opportunities | `pm/landscape.md` § Keyword Landscape | Low-competition, high-intent keywords |
| Customer evidence | `pm/research/index.md` | Internal/mixed topics with high evidence counts |
| Topic research | `pm/research/*/findings.md` | Open questions and implications |
| Existing backlog | `pm/backlog/*.md` | Avoid duplicating what's already there |

---

## Flow

### Step 1: Audit what exists

Before generating ideas, understand what's already built. This prevents suggesting features that already exist.

1. **Read strategy context** — `pm/strategy.md` describes the product identity, ICP, and what's in/out of scope.
2. **Read the feature matrix** — `pm/competitors/matrix.md` shows what the product already does. Trust the "Yes" cells.
3. **Explore the project codebase (if one exists)** — scan the project's source code structure to catalog existing capabilities. Look at top-level directories, key source files, and any documentation that describes current features. If no codebase exists (greenfield product, standalone knowledge base, or pre-development planning), skip this step — rely on strategy and the feature matrix instead.

Build a mental inventory: "The product already does X, Y, Z." Every idea generated in Step 2 must be checked against this inventory.

### Step 2: Mine signals

Read every available signal source listed above. For each, extract:
- **Gaps**: Things that should exist but don't (verified against Step 1 inventory)
- **Pains**: Problems users or competitors have
- **Trends**: Macro forces creating new demand
- **Evidence**: Customer signals pointing to unmet needs

### Step 3: Generate and filter ideas

Produce candidate ideas, then apply these filters **before presenting**. Be ruthless — fewer, stronger ideas are better than a long list of weak ones.

#### Filter 1: Already built?
Check each idea against the Step 1 inventory. If the capability already exists in any form (skill, hook, dashboard feature, server endpoint), drop it. Do not suggest it.

#### Filter 2: Is this a discrete, groomable feature?
Each idea must be a specific, shippable thing — not an ongoing effort, process improvement, or engineering principle. Drop ideas that are:
- Continuous engineering work ("improve cross-platform compatibility")
- Process changes ("adopt TDD", "add code review")
- Vague themes ("better UX", "more integrations")

**Test:** Can you write acceptance criteria for this? If not, it's not a feature.

#### Filter 3: Are dependencies met?
If an idea requires another unbuilt feature to be useful, flag the dependency explicitly. Ideas that require 2+ unbuilt dependencies should be deprioritized or bundled with their dependencies.

**Example:** "Assumption tracker" requires analytics ingestion to validate assumptions → flag dependency, deprioritize unless the ingestion is also on the list.

#### Filter 4: Is this needed now?
Check if the idea solves a problem that exists today, or a hypothetical future problem. Drop ideas that:
- Solve problems for users or scales you don't have yet
- Optimize things that aren't bottlenecks
- Add infrastructure for speculative future requirements

#### Filter 5: Non-goal conflict?
Check against `pm/strategy.md` § 7. If a compelling idea touches a non-goal, don't silently drop it — flag the conflict explicitly and let the user decide.

### Step 4: Shape surviving ideas

For each idea that passes all filters, produce:

- **Name**: Short, descriptive (3-5 words)
- **One-liner**: What it does for the user (outcome, not implementation)
- **Signal sources**: Which source(s) surfaced this idea (with file path references)
- **Strategic fit**: Which priority from `pm/strategy.md` § 6 it advances
- **Competitor gap**: `unique` (no competitor has it), `partial` (some have parts), `parity` (catching up)
- **Dependencies**: Other unbuilt features this requires, or "none"
- **Scope signal**: `small` (< 1 day), `medium` (1-3 days), `large` (1+ week)
- **Evidence strength**: `strong` (3+ signals from different sources), `moderate` (1-2 signals), `hypothesis` (inferred)

**Target: 5-10 ideas.** If you have more than 10 after filtering, cut the weakest. If fewer than 5, that's fine — don't pad the list.

### Step 5: Rank

Sort by:
1. Strategic alignment (advances top-3 priority > adjacent > new direction)
2. Evidence strength (strong > moderate > hypothesis)
3. Competitor gap (unique > partial > parity)
4. Dependency count (0 deps > 1 dep > 2+ deps)
5. Scope efficiency (small wins before large bets, unless evidence is overwhelming)

### Step 6: Present

Show the ranked list:

> **Feature ideas from your knowledge base ({N} ideas, {M} filtered out):**
>
> | # | Idea | One-liner | Supports | Gap | Evidence | Deps | Scope |
> |---|---|---|---|---|---|---|---|
> | 1 | {name} | {one-liner} | Priority 1 | Unique | Strong | None | Small |
> | 2 | {name} | {one-liner} | Priority 1 | Partial | Moderate | None | Medium |
>
> **Quick wins (small scope, no deps, strong evidence):** #1, #4
> **Big bets (large scope, high potential):** #3
> **Filtered out:** {brief list of dropped ideas with reason — e.g., "Linear integration (already built)", "cross-platform compat (not a discrete feature)"}

Then ask:
> "Which ideas interest you? I can:
> (a) Groom one now — pick a number
> (b) Add your own ideas to the list
> (c) Go deeper on a specific idea before committing
> (d) Save all to backlog as ideas"

### Step 7: Write to backlog

On user confirmation (or if they select (d)), write each idea to `pm/backlog/{idea-slug}.md` using the backlog issue format with `status: idea`.

**ID assignment:** Each backlog issue gets a sequential `id` in the format `PM-{NNN}`. Before creating new issues, scan all existing `pm/backlog/*.md` files for the highest `id` value and increment by 1. The first issue is `PM-001`. IDs are zero-padded to 3 digits.

```markdown
---
type: backlog-issue
id: "PM-{NNN}"
title: "{Idea Name}"
outcome: "{One-liner: what changes for the user}"
status: idea
parent: null
children: []
labels:
  - "ideate"
priority: {critical|high|medium|low}
evidence_strength: {strong|moderate|hypothesis}
scope_signal: {small|medium|large}
strategic_fit: "{which priority}"
competitor_gap: {unique|partial|parity}
dependencies: [] | ["{dependency}"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome

{What the user can do after this ships that they couldn't before.}

## Signal Sources

- {source path}: {what it revealed}
- {source path}: {what it revealed}

## Competitor Context

{Who has this, who doesn't, how ours would differ.}

## Dependencies

{What needs to exist before this is useful, or "None."}

## Open Questions

{What we'd need to validate before building.}
```

After writing, report:
> "Wrote {N} ideas to pm/backlog/. Run $pm-groom {slug} to promote any idea to a fully scoped issue."

---

## Update Flow

When `pm/backlog/` already contains `status: idea` items:

1. Read existing idea-status items. Note their slugs.
2. Re-run Steps 1-3 (audit + mine + filter) with current knowledge base state.
3. Generate only **net-new ideas** not already captured.
4. Present: "Found {N} new ideas since last ideation. {M} existing ideas in backlog."
5. Write only new ideas. Do not overwrite existing ones.

---

## Handoff to Groom

When the user picks an idea to groom:

1. Say:
   > "Starting grooming for '{idea name}'. Running $pm-groom {idea-slug}."
2. Invoke `$pm-groom` with the idea context pre-loaded — the groom skill's Phase 1 (Intake) can be partially pre-filled from the idea's outcome, signal sources, and competitor context.
3. The groom skill promotes the status from `idea` to `drafted` during Phase 5, and to `created` or `linked` in Phase 6.

---

## Rules

1. Every idea must cite at least one signal source with a file path. No unsourced ideas.
2. Every idea must pass all 5 filters. No exceptions.
3. Do not suggest features that already exist. When in doubt, check the codebase or feature matrix.
4. Do not duplicate ideas already in `pm/backlog/`. Reference existing backlog items instead.
5. Scope signals are rough estimates, not commitments. Groom refines scope.
6. If no knowledge base exists (no strategy, no landscape, no competitors), say:
   > "Not enough data to generate evidence-based ideas. Run $pm-research and $pm-strategy first to build the knowledge base."
   Do not generate ideas from thin air.
7. Show what was filtered out and why. Transparency builds trust in the remaining ideas.
