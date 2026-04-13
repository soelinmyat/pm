---
name: Synthesize
order: 6
description: Confirm the summary with the user, save the thinking artifact, and offer to promote to pm:groom
---

## Synthesize

**Goal:** Turn the conversation into a reusable thinking artifact and close the loop cleanly.

**How:**

1. **Draft the summary.** Synthesize the conversation into the thinking artifact format below.

2. **Confirm with the user.** Present the draft and ask:
   > "Here's the summary. Did I capture it correctly?"
   Revise until the user confirms. This is the only question in this sub-step.

3. **Save the artifact.** Write to `{pm_dir}/thinking/{slug}.md`. Create the `{pm_dir}/thinking/` directory if it doesn't exist.

4. **Update the thinking index.** Update `{pm_dir}/thinking/index.md` following the index maintenance rules in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md`. Add or update a row with the slug, topic, 2-4 tags (inferred from the thinking content), today's date, and status. Create the index if it doesn't exist.

5. **Offer promotion.** Ask ONE question:
   > "Want to groom this into a proposal? (This runs a lightweight scoping flow — typically 5-10 minutes.)"

   - **Yes** → Update the artifact: set `status: promoted` and `promoted_to: {groom-session-slug}`. Update the index row's status to `promoted`. Then invoke `pm:groom` with `groom_tier: quick` and the thinking summary as context. Always default to quick tier when promoting from think.
   - **No** → Done. The thinking is saved and can be revisited later.

### Thinking artifact format

```markdown
---
type: thinking
topic: "{topic}"
slug: "{kebab-case-slug}"
created: YYYY-MM-DD
updated: YYYY-MM-DD
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

**Done-when:** The artifact is saved, the index is updated, the user confirmed the summary, and promotion was either completed or explicitly declined.
