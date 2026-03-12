---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose
The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

## Prerequisite Check

Check if `pm/landscape.md` exists.

If it does NOT exist, say:

> "Consider running /pm:research landscape first. Strategy interviews are more
> productive with landscape context — knowing the key players and market segments
> sharpens your positioning answers. This is a recommendation, not a requirement."

Then ask: "Continue with strategy now, or run landscape research first?"
Respect the user's answer. Do not block.

## Existing Strategy Detection

Search for any of the following:
- `pm/strategy.md`
- `STRATEGY.md`
- `PRODUCT.md`
- `PRD.md`
- Any `.md` file inside `docs/product/` or `docs/strategy/`

If found, say:

> "Found existing strategy doc at {path}. Want to adopt it into pm/strategy.md
> (I'll restructure it to the standard format) or start fresh?"

If adopting: extract existing answers and skip re-asking questions already answered.
If starting fresh: proceed with the full interview.

## Update Flow

When `pm/strategy.md` already exists and the user invokes /pm:strategy again:

1. Ask: "What changed? (e.g., pivoted ICP, new competitors, revised priorities)"
2. Re-interview only the affected sections.
3. Update `pm/strategy.md` in place. Bump `updated:` in frontmatter.

Not a full re-interview. Surgical updates only.

## Interview Process

Follow the interview guide in `interview-guide.md` (same directory).

Rules:
- One question at a time. Do not front-load multiple questions.
- Prefer multiple-choice when there is a natural set of options.
- Start with Essentials. Move to Depth only if the user's answers are expansive.
- If the user gives a short answer, accept it and move on — do not interrogate.
- If `pm/landscape.md` exists, read it first. Use named competitors and market
  segments from it to make questions more specific (e.g., "How do you differ
  from [Competitor A] and [Competitor B]?" instead of "Who are your competitors?").
- If `pm/research/` contains internal or mixed topic findings from `/pm:ingest`,
  use them to sharpen ICP, segmentation, priorities, and non-goals. Customer
  evidence should influence strategy when available.
- After Essentials are complete, ask: "Want to go deeper on any area, or is
  this enough to write the strategy doc?"

## Strategy Document

Write to `pm/strategy.md` with this structure:

```markdown
---
type: strategy
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Product Strategy

## 1. Product Identity
What it is, who it's for, and why it exists.

## 2. ICP and Segmentation
Ideal customer profile: industry, company size, role, pain level.
Secondary segments (if applicable) and why they are secondary.

## 3. Core Value Prop and Differentiation
The one-sentence value prop.
What makes this meaningfully different from alternatives.

## 4. Competitive Positioning
Where this product sits relative to key players.
How we win (and where we intentionally don't compete).

## 5. Go-to-Market
Geographic focus and reasoning.
Acquisition motion: product-led, sales-led, partnership-led, or a combination.
Initial beachhead market and expansion path.

## 6. Current Phase and Priorities
Stage of the product (0-to-1, growth, optimization, etc.).
Top 3 priorities for this phase and the reasoning behind each.

## 7. Explicit Non-Goals
What this product is NOT doing, and why.
At least 3 items. These are decisions, not omissions.

## 8. Success Metrics
How we know the strategy is working.
Leading indicators preferred over lagging.
```

After writing, say:

> "Strategy doc written to pm/strategy.md. Recommended next steps:
> /pm:research competitors -> /pm:groom [feature idea]
> If you have un-ingested customer evidence, run /pm:ingest <path> before making bigger prioritization calls."

## Visual Companion

If the user has `visual_companion: true` in `.pm/config.json`, offer:

> "Want a positioning map? I can plot key competitors on two axes you choose
> (e.g., price vs. breadth, SMB vs. enterprise)."

Generate using the positioning-map template if accepted.
