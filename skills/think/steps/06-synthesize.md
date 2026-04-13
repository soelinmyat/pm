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

3. **Save and validate the artifact.**
   1. Write to `{pm_dir}/thinking/{slug}.md`. Create the `{pm_dir}/thinking/` directory if it doesn't exist.
   2. Set `updated` to today's date (`YYYY-MM-DD`).
   3. Validate frontmatter against the thinking schema in `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md`. All required fields must be present and valid. Fix any violations before proceeding.

4. **Update the thinking index.**
   1. If `{pm_dir}/thinking/index.md` does not exist, rebuild it first using the index rebuild procedure in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` (scan all `*.md` in the directory, extract frontmatter, write the index table).
   2. Add or update a row with the slug, topic, 2-4 tags (inferred from the thinking content), today's date, and status.
   3. Follow the index maintenance rules in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md`.

5. **Offer promotion.** Ask ONE question:
   > "Want to groom this into a proposal? (This runs a lightweight scoping flow — typically 5-10 minutes.)"

   - **Yes** → Invoke `pm:groom` with `groom_tier: quick`, the thinking summary as context, and the slug. Always default to quick tier when promoting from think. **Only after** the groom session file is confirmed created (`.pm/groom-sessions/{slug}.md` exists):
     - Set `status: promoted` and `promoted_to: {slug}` in the thinking artifact.
     - Set `updated` to today's date.
     - Update the index row's status to `promoted`.
     - If groom fails or the user abandons it, leave the thinking artifact as `status: active` — do not mark as promoted.
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
