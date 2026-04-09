### Ideate Mode

Surface what to build next. Mines the entire knowledge base — strategy, landscape, competitor gaps, customer evidence, and existing backlog — to generate ranked feature ideas grounded in evidence.

Ideas are early-stage backlog items. They live in `pm/backlog/` with `status: idea` and get promoted to `drafted` when groomed via the normal lifecycle.

**Output formatting:** Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating output.

---

## Prerequisite Check

1. Check if `pm/strategy.md` exists. If not:
   > "No strategy doc found. Ideation without strategy is just brainstorming. Run /pm:strategy first?"
   Wait for response. Do not block — proceed if the user insists.

2. Check if `pm/insights/business/landscape.md` exists. Note its presence for signal mining. Not required.

3. Check if `pm/insights/competitors/index.md` exists. Note profiled competitors. Not required.

---

## Signal Sources

Read all available sources before generating ideas. Each idea must trace back to at least one signal.

| Source | Path | What to extract |
|---|---|---|
| Strategy priorities | `pm/strategy.md` § 6 | Top 3 priorities — ideas should advance these |
| Strategy non-goals | `pm/strategy.md` § 7 | Filter out ideas that conflict |
| Market gaps | `pm/insights/competitors/index.md` § Market Gaps | Capabilities absent across competitors |
| Feature matrix | `pm/insights/competitors/index.md` | Cells where the product shows "No" or "Planned" |
| Competitor weaknesses | `pm/insights/competitors/*/profile.md` § Weaknesses | Problems competitors have that we could solve better |
| Landscape observations | `pm/insights/business/landscape.md` § Initial Observations | Whitespace and macro trends |
| Keyword opportunities | `pm/insights/business/landscape.md` § Keyword Landscape | Low-competition, high-intent keywords |
| Customer evidence | `pm/evidence/research/index.md` | Internal/mixed topics with high evidence counts |
| Topic research | `pm/evidence/research/*.md` | Open questions and implications |
| Existing backlog | `pm/backlog/*.md` | Avoid duplicating what's already there |

---

## Flow

### Step 1: Audit what exists

<HARD-GATE>
Auditing existing capabilities is required before generating ideas. Do NOT skip because "I know the product."
Read strategy, feature matrix, and codebase (if present). Without this step, ideation produces duplicates.
</HARD-GATE>

1. **Read strategy context** — `pm/strategy.md` describes the product identity, ICP, and what's in/out of scope.
2. **Read the feature matrix** — `pm/insights/competitors/index.md` shows what the product already does.
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
Check against `pm/strategy.md` § 7. Flag conflicts explicitly — don't silently drop.

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

On user confirmation, write each idea to `pm/backlog/{idea-slug}.md`.

**ID rule:** If a Linear issue is created for this idea, use the Linear identifier as `id`. Otherwise fall back to the local `PM-{NNN}` sequence (scan `pm/backlog/*.md` for highest `id`, increment by 1).

```markdown
---
type: backlog-issue
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

**ID assignment:** Scan existing `pm/backlog/*.md` for highest `id` and increment. First issue is `PM-001`.

After writing:
> "Wrote {N} ideas to pm/backlog/. Run /pm:groom {slug} to promote any idea to a fully scoped issue."

---

## Handoff to Groom

When the user picks an idea to groom:
1. Invoke the normal groom lifecycle with the idea context pre-loaded
2. Phase 1 (Intake) is partially pre-filled from the idea's outcome, signal sources, and competitor context
3. Status promotes from `idea` → `drafted` in Phase 5, then `created`/`linked` in Phase 6

---

## Rules

1. Every idea must cite at least one signal source with a file path.
2. Every idea must pass all 5 filters.
3. Do not suggest features that already exist.
4. Do not duplicate ideas already in `pm/backlog/`.
5. Show what was filtered out and why.
6. If no knowledge base exists, say: "Not enough data. Run /pm:research and /pm:strategy first."
