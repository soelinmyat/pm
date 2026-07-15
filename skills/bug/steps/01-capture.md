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

6. **Write the backlog item** through the request-file contract in `${CLAUDE_PLUGIN_ROOT}/references/capture.md`. Use the Write tool to create a private JSON object with `action: "create"`, `kind: "bug"`, title, outcome, and the complete body. Omit priority and labels unless supplied so the helper owns Bug defaults (`high`, `[bug]`). Pass only `{pm_dir}` and the request-file path through the shell, and guarantee removal on success or failure. Never interpolate user-controlled values into shell syntax.

   The helper sets `type: backlog`, `kind: bug`, `status: proposed`, `priority: high` (bugs urgent by default — user can downgrade in enrich), `labels: [bug]`, and `created`/`updated` to today.

7. Parse the JSON receipt and retain `slug` plus `content_sha256` for Step 2. Confirm only after the exact published file passes the project validator.

8. **Confirm** in one line:
> `Captured: {filePath} ({id}, kind=bug). Run /pm:dev {slug} when ready to fix.`

9. **Offer enrichment.** If the user wants to refine priority/labels or fill in missing reproduction details, continue to Step 2 (Enrich). Otherwise end.

## Done-when

The exclusive-create receipt identifies one validated Bug artifact, the user has received its ID and fix hint, and any desired enrichment is known.

**Advance:** proceed to Step 2 (Enrich) when requested; otherwise summarize the capture and stop.
