---
name: ideate
description: "Use when the user wants to discover what to build next, generate feature ideas from the knowledge base, or mine gaps and opportunities. Use when the user says 'what should we build', 'generate ideas', 'what's missing', 'find opportunities', 'brainstorm features', or wants evidence-backed feature candidates ranked by strategic fit."
---

# pm:ideate

## Purpose

Surface what to build next. Mines the entire knowledge base — strategy, landscape, competitor gaps, customer evidence, and existing backlog — to generate ranked feature ideas grounded in evidence, not gut feeling.

Ideas are early-stage backlog items. They live in `{pm_dir}/backlog/` with `status: idea` and get promoted to `drafted` when groomed via `pm:groom`.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**EVERY IDEA MUST CITE AT LEAST ONE SIGNAL SOURCE WITH A FILE PATH.** No signal, no idea. Unsourced ideas are opinions dressed as features — they bypass the evidence layer the entire KB exists to provide.

**When NOT to use:** When the user already knows what to build and wants to scope it — use `pm:groom`. When they want to explore a single idea — use `pm:think`. Ideate is for discovery across the full KB, not deep-diving one idea.

**Workflow:** `ideate` | **Telemetry steps:** `audit`, `mine`, `filter`, `shape`, `rank`, `present`, `write`.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I already know this product well enough to skip the audit."** The audit catches capabilities you'd otherwise duplicate. Read strategy, feature matrix, and codebase. Every time.
- **"This idea doesn't have a clear signal source, but it's a good idea."** That's the Iron Law violation. Drop it or find the signal.
- **"The user probably wants more ideas, let me add a few extras."** Quality over quantity. 5 well-sourced ideas beat 15 thin ones. Cut the weakest.
- **"These filters are too strict, I'm dropping too many ideas."** The filters are the value. Show what was filtered out and why — the user can override, but you don't skip.
- **"Let me scope this idea in detail while I'm here."** Ideate shapes ideas, it doesn't scope them. If the user wants depth, hand off to `pm:think` or `pm:groom`.

## Escalation Paths

- **KB too thin to generate ideas:** "Not enough data to mine. Run `/pm:research` and `/pm:strategy` first to build the knowledge base."
- **User wants to deep-dive one idea:** "Want to explore '{idea}' further? I can run `/pm:think` to challenge the framing, or `/pm:groom` to scope it into a proposal."
- **User wants to groom an idea immediately:** Invoke `pm:groom` with the idea context pre-loaded. Groom intake recognizes `status: idea` backlog items and pre-fills from them.

## Prerequisite Check

1. Check if `{pm_dir}/strategy.md` exists. If not:
   > "No strategy doc found. Ideation without strategy is just brainstorming. Run /pm:strategy first?"
   Wait for response. Do not block — proceed if the user insists.

2. Check if `{pm_dir}/insights/business/landscape.md` exists. Note its presence for signal mining. Not required.

3. Check if `{pm_dir}/evidence/competitors/index.md` exists. Note profiled competitors. Not required.

## Signal Sources

Read all available sources before generating ideas. Each idea must trace back to at least one signal.

| Source | Path | What to extract |
|---|---|---|
| Strategy priorities | `{pm_dir}/strategy.md` § 6 | Top 3 priorities — ideas should advance these |
| Strategy non-goals | `{pm_dir}/strategy.md` § 7 | Filter out ideas that conflict |
| Market gaps | `{pm_dir}/evidence/competitors/index.md` § Market Gaps | Capabilities absent across competitors |
| Feature matrix | `{pm_dir}/evidence/competitors/index.md` | Cells where the product shows "No" or "Planned" |
| Competitor weaknesses | `{pm_dir}/evidence/competitors/*/profile.md` § Weaknesses | Problems competitors have that we could solve better |
| Landscape observations | `{pm_dir}/insights/business/landscape.md` § Initial Observations | Whitespace and macro trends |
| Keyword opportunities | `{pm_dir}/insights/business/landscape.md` § Keyword Landscape | Low-competition, high-intent keywords |
| Customer evidence | `{pm_dir}/evidence/research/index.md` | Internal/mixed topics with high evidence counts |
| Topic research | `{pm_dir}/evidence/research/*.md` | Open questions and implications |
| Existing backlog | `{pm_dir}/backlog/*.md` | Avoid duplicating what's already there |

## Flow

### Step 1: Audit what exists

<HARD-GATE>
Auditing existing capabilities is required before generating ideas. Do NOT skip because "I know the product."
Read strategy, feature matrix, and codebase (if present). Without this step, ideation produces duplicates.
</HARD-GATE>

1. **Read strategy context** — `{pm_dir}/strategy.md` describes the product identity, ICP, and what's in/out of scope.
2. **Read the feature matrix** — `{pm_dir}/evidence/competitors/index.md` shows what the product already does.
3. **Explore the project codebase (if one exists)** — scan source code to catalog existing capabilities. If no codebase exists, rely on strategy and the feature matrix.

**Comprehension check:** Before proceeding, state: (a) the top 3 priorities, (b) the 3 most relevant competitive gaps, and (c) 1 customer evidence signal if available.

### Step 2: Mine signals

Read every available signal source. For each, extract:
- **Gaps**: Things that should exist but don't
- **Pains**: Problems users or competitors have
- **Trends**: Macro forces creating new demand
- **Evidence**: Customer signals pointing to unmet needs

### Step 3: Generate and filter ideas

<HARD-GATE>
All 5 filters must be applied to every candidate idea. Do NOT skip filters.
</HARD-GATE>

#### Filter 1: Already built?
Check against Step 1 inventory. Drop if capability already exists.

#### Filter 2: Is this a discrete, groomable feature?
Each idea must be specific and shippable. Drop vague themes, process changes, and ongoing efforts.
**Test:** Can you write acceptance criteria? If not, it's not a feature.

#### Filter 3: Are dependencies met?
Flag ideas requiring unbuilt features. Deprioritize those with 2+ unbuilt dependencies.

#### Filter 4: Is this needed now?
Drop ideas solving hypothetical future problems or optimizing non-bottlenecks.

#### Filter 5: Non-goal conflict?
Check against `{pm_dir}/strategy.md` § 7. Flag conflicts explicitly — don't silently drop.

### Step 4: Shape surviving ideas

For each idea that passes all filters:

- **Name**: Short, descriptive (3-5 words)
- **One-liner**: What it does for the user (outcome, not implementation)
- **Signal sources**: Which source(s) with file paths
- **Strategic fit**: Which priority it advances
- **Competitor gap**: `unique` / `partial` / `parity`
- **Dependencies**: Other unbuilt features required, or "none"
- **Scope signal**: `small` (< 1 day) / `medium` (1-3 days) / `large` (1+ week)
- **Evidence strength**: `strong` (3+ signals) / `moderate` (1-2) / `hypothesis`

**Target: 5-10 ideas.** Cut the weakest if over 10.

### Step 5: Rank

Sort by: strategic alignment > evidence strength > competitor gap > dependency count > scope efficiency.

### Step 6: Present

> **Feature ideas from your knowledge base ({N} ideas, {M} filtered out):**
>
> | # | Idea | One-liner | Supports | Gap | Evidence | Deps | Scope |
> |---|---|---|---|---|---|---|---|
> | 1 | {name} | {one-liner} | Priority 1 | Unique | Strong | None | Small |
>
> **Quick wins (small scope, no deps, strong evidence):** #1, #4
> **Big bets (large scope, high potential):** #3
> **Filtered out:** {brief list with reasons}

Then ask:
> "Which ideas interest you? I can:
> (a) Groom one now — pick a number
> (b) Add your own ideas to the list
> (c) Go deeper on a specific idea
> (d) Save all to backlog as ideas"

### Step 7: Write to backlog

On user confirmation, write each idea to `{pm_dir}/backlog/{idea-slug}.md`.

**ID rule:** If a Linear issue is created for this idea, use the Linear identifier as `id`. Otherwise fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1).

```markdown
---
type: backlog
id: "{linear_id or PM-NNN}"
title: "{Idea Name}"
outcome: "{One-liner}"
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
{What the user can do after this ships.}

## Signal Sources
- {source path}: {what it revealed}

## Competitor Context
{Who has this, who doesn't, how ours would differ.}

## Dependencies
{What needs to exist first, or "None."}

## Open Questions
{What to validate before building.}
```

After writing:
> "Wrote {N} ideas to {pm_dir}/backlog/. Run /pm:groom {slug} to promote any idea to a fully scoped proposal."

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I know the product, skip the audit" | The audit catches duplicates. You miss things every time you skip it. |
| "This idea is obviously good, it doesn't need a signal" | Obvious to whom? Signal sources make ideas defensible, not just plausible. |
| "The filters are too aggressive, I'm losing good ideas" | Show the filtered-out list. The user can override — but unsourced, undifferentiated ideas waste groom cycles. |
| "Let me flesh out the top idea in detail" | Ideate shapes, it doesn't scope. Hand off to think or groom for depth. |

## Before Marking Done

- [ ] All ideas cite at least one signal source with file path
- [ ] All 5 filters applied to every candidate
- [ ] No duplicate of existing backlog items
- [ ] Ideas written to `{pm_dir}/backlog/` with `status: idea` and valid frontmatter
- [ ] User confirmed the ideas list (or selected which to save)
