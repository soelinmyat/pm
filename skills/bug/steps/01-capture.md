---
name: Capture
order: 1
description: Parse title and write the backlog file with kind=bug + observed/expected/reproduction body
---

## Goal

Write a single bug report to `{pm_dir}/backlog/{slug}.md` with `kind: bug` and a body that includes observed/expected/reproduction sections (stubs allowed).

## How

1. **Extract title** from `$ARGUMENTS`.
   - If no title is provided, ask: "What's broken? (one-line title)"
   - Wait for the response before continuing.

2. **Resolve outcome.**
   - If the user hints at what the fix looks like (e.g., "expected it to X"), use that. Otherwise, derive a one-sentence outcome like `"{Subject} behaves correctly again"`.
   - You may ask once: "One-sentence outcome (what 'fixed' looks like)?" — accept a short answer or fall back to the derived outcome.

3. **Prompt for body sections** (all optional — use stubs when missing):
   - "What did you observe?" → `## Observed`
   - "What did you expect instead?" → `## Expected`
   - "How can it be reproduced?" → `## Reproduction`

   If the user skips any, write a stub like `_Pending — add before /pm:dev._` under that heading.

4. **Compose the body** as three markdown sections in order: `## Observed`, `## Expected`, `## Reproduction`. Keep it terse.

5. **Resolve `{pm_dir}`** per `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md`.

6. **Write the backlog item** using the capture helper. Pass the body via a temporary file so markdown escaping stays out of the shell:

   ```bash
   BODY_FILE=$(mktemp)
   cat > "$BODY_FILE" <<'EOF'
   ## Observed
   <observed or stub>

   ## Expected
   <expected or stub>

   ## Reproduction
   <reproduction or stub>
   EOF
   node ${CLAUDE_PLUGIN_ROOT}/scripts/capture-backlog.js \
     --pm-dir {pm_dir} \
     --kind bug \
     --title "<title>" \
     --outcome "<outcome>" \
     --priority high \
     --labels bug \
     --body-file "$BODY_FILE"
   rm -f "$BODY_FILE"
   ```

   The helper sets `type: backlog`, `kind: bug`, `status: proposed`, `priority: high` (bugs urgent by default — user can downgrade in enrich), `labels: [bug]`, and `created`/`updated` to today.

7. **Confirm** in one line:
   > `Captured: {pm_dir}/backlog/{slug}.md ({id}, kind=bug). Run /pm:dev {slug} when ready to fix.`

8. **Offer enrichment.** If the user wants to refine priority/labels or fill in missing reproduction details, continue to Step 2 (Enrich). Otherwise end.

## Done-when

The backlog file exists at `{pm_dir}/backlog/{slug}.md`, contains the three body sections, passes `npm run validate`, and the user has seen the one-line confirmation.
