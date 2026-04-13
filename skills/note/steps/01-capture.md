---
name: Capture
order: 1
description: Extract note text, infer source/tags, write the note entry, and offer enrichment
---

## Goal

Capture a single product signal into the monthly notes log with enough metadata to be useful later.

## How

1. **Extract note text** from the user's message or argument.
   - If no text is provided, ask: "What did you observe?"
   - Wait for the response before continuing.

2. **Parse source type** from the message:
   - If user says `--source "sales call"` or similar, use that value.
   - If user says "sales call:", "support thread:", "user interview:", or "from a customer" — infer the source type.
   - Default source: `observation`.

3. **Generate timestamp** as `YYYY-MM-DD HH:MM` in local time.

4. **Infer tags** from note content:
   - Competitor names mentioned → `competitor`
   - Performance/speed/timeout keywords → `performance`
   - Integration/API/plugin keywords → `integration`
   - Pricing/cost keywords → `pricing`
   - Churn/cancel/leave keywords → `churn`
   - Feature request patterns → `feature-request`
   - User can override tags with `--tags "tag1, tag2"`.

5. **Write the note** using the shared helper:
   - Call `writeNote(pmDir, text, source, tags)` from `${CLAUDE_PLUGIN_ROOT}/scripts/note-helpers.js`.
   - This creates/appends to `{pm_dir}/evidence/notes/YYYY-MM.md` with correct frontmatter.

6. **Confirm** to the user:
   > "Note saved to `{pm_dir}/evidence/notes/YYYY-MM.md`. Want to add more context?"
   - If user says no or ignores, the flow ends here.
   - If user says yes, continue to Step 2 (Enrich).

## Done-when

The note has been written to `{pm_dir}/evidence/notes/YYYY-MM.md`, source and tags are set, and the user has been offered enrichment.
