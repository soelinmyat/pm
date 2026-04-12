---
name: Synthesize
order: 5
description: Produce a thinking artifact and offer to promote to pm:groom
---

## Synthesize

When the thinking reaches a natural conclusion, synthesize the conversation into a **thinking artifact**. This is the artifact.

```markdown
---
type: thinking
topic: "{topic}"
slug: "{kebab-case-slug}"
created: YYYY-MM-DD
status: active | parked | promoted
promoted_to: "{groom-session-slug}" | null
---

# {Topic}

## Problem
{1-2 sentences: what's the real problem or opportunity}

## Direction
{The approach that emerged from the conversation}

## Key tradeoffs
- {Tradeoff 1}
- {Tradeoff 2}

## Open questions
- {Question 1}
- {Question 2}

## Next step
{What should happen next — groom it, research more, park it, etc.}
```

Save to `{pm_dir}/thinking/{slug}.md`. Create the `{pm_dir}/thinking/` directory if it doesn't exist.

After saving, ask ONE question:

> "Want to groom this into a proposal? (This runs a lightweight scoping flow — typically 5-10 minutes.)"

- **Yes** → Invoke `pm:groom` with `groom_tier: quick` and the thinking summary as context. The groom skill will pick up from here — it can skip or shorten intake since the thinking is already captured. Always default to quick tier when promoting from think, since the user just had a lightweight conversation and shouldn't be surprised by heavy ceremony.
- **No** → Done. The thinking is saved and can be revisited later.
