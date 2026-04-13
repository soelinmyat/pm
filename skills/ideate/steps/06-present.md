---
name: Present
order: 6
description: Present the ranked ideas, filtered-out list, and next-action options to the user
---

## Goal

Show the user a concise, ranked opportunity set and make the next decision obvious.

## How

Present the ideas in this format:

```markdown
> **Feature ideas from your knowledge base ({N} ideas, {M} filtered out):**
>
> | # | Idea | One-liner | Supports | Gap | Evidence | Deps | Scope |
> |---|---|---|---|---|---|---|---|
> | 1 | {name} | {one-liner} | Priority 1 | Unique | Strong | None | Small |
>
> **Quick wins (small scope, no deps, strong evidence):** #1, #4
> **Big bets (large scope, high potential):** #3
> **Filtered out:** {brief list with reasons}
```

Then ask:

> "Which ideas interest you? I can:
> (a) Groom one now — pick a number
> (b) Add your own ideas to the list
> (c) Go deeper on a specific idea
> (d) Save all to backlog as ideas"

## Done-when

The ranked ideas and filtered-out list have been presented, and the user has been asked how they want to proceed.
