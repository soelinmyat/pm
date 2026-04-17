---
name: Capture
order: 1
description: Parse title and outcome, write the backlog file with kind=task
---

## Goal

Write a single lightweight task entry to `{pm_dir}/backlog/{slug}.md` with `kind: task`. One pass — no grooming, no ceremony.

## How

1. **Extract title** from `$ARGUMENTS`.
   - If no title is provided, ask: "What task would you like to capture? (one-line title)"
   - Wait for the response before continuing.

2. **Resolve outcome.**
   - If the user's message contains an outcome hint (e.g., `-- outcome "..."`, or a sentence after the title describing what changes), use it.
   - Otherwise ask once: "What changes when this ships? (one sentence)"
   - If the user declines or says "just use the title," pass the title as the outcome.

3. **Resolve `{pm_dir}`** per `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` (usually `pm/`).

4. **Write the backlog item** using the capture helper. Run via Bash:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/capture-backlog.js \
     --pm-dir {pm_dir} \
     --kind task \
     --title "<title>" \
     --outcome "<outcome>"
   ```

   The helper:
   - Generates the next `PM-NNN` id by scanning `{pm_dir}/backlog/*.md`.
   - Slugifies the title into a safe filename.
   - Writes the file with validated frontmatter: `type: backlog`, `kind: task`, `status: proposed`, `priority: medium`, `labels: [chore]`, `created`/`updated` set to today.
   - Prints a one-line JSON result: `{"filePath": "...", "id": "PM-NNN", "slug": "..."}`.

5. **Confirm** to the user in one line:
   > `Captured: {pm_dir}/backlog/{slug}.md ({id}, kind=task). Run /pm:dev {slug} when ready, or add priority/labels with /pm:task enrich.`

6. **Offer enrichment.** If the user wants to refine priority/labels, continue to Step 2 (Enrich). Otherwise end the flow.

## Done-when

The backlog file exists at `{pm_dir}/backlog/{slug}.md`, passes `npm run validate`, and the user has seen the one-line confirmation.
