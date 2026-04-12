---
name: Detect Existing Strategy
order: 2
description: Search for existing strategy documents and offer to adopt or start fresh
---

## Existing Strategy Detection

Search for any of the following:
- `{pm_dir}/strategy.md`
- `STRATEGY.md`
- `PRODUCT.md`
- `PRD.md`
- Any `.md` file inside `docs/product/` or `docs/strategy/`

If found, say:

> "Found existing strategy doc at {path}. Want to adopt it into {pm_dir}/strategy.md
> (I'll restructure it to the standard format) or start fresh?"

If adopting: extract existing answers and skip re-asking questions already answered.
If starting fresh: proceed with the full interview.

## Update Flow

When `{pm_dir}/strategy.md` already exists and the user invokes `$pm-strategy` again:

1. Ask: "What changed? (e.g., pivoted ICP, new competitors, revised priorities)"
2. Re-interview only the affected sections.
3. Update `{pm_dir}/strategy.md` in place. Bump `updated:` in frontmatter.

Not a full re-interview. Surgical updates only.
