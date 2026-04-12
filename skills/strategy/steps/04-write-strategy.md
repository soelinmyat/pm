---
name: Write Strategy
order: 4
description: Write the strategy document to strategy.md with the standard structure
---

## Strategy Document

Write to `{pm_dir}/strategy.md` with this structure:

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

> "Strategy doc written to {pm_dir}/strategy.md. Recommended next steps:
> $pm-research competitors -> $pm-ideate -> $pm-groom [feature idea]
> If you have un-ingested customer evidence, run $pm-ingest <path> before making bigger prioritization calls."
