---
name: Discover
order: 1
description: Invoke the data layer, capture the ListRowsPayload JSON, cache it for the render step
---

## Goal

Run `scripts/start-status.js --format list-rows` against the current project directory and capture the resulting `ListRowsPayload` as the single source of truth for this conversation.

## How

1. **Locate the project directory.** Resolve from shell `$PWD` (or the runtime-provided project root). Do not hand-wave — the script's path resolution depends on it.

2. **Invoke the emitter:**

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/start-status.js --project-dir "$PWD" --format list-rows
   ```

   Parse stdout as a single JSON object. The shape is `ListRowsPayload`:

   ```jsonc
   {
     "active":    [ /* Row */ ],  // groom, rfc, dev, think sessions
     "proposals": [ /* Row */ ],  // backlog, not yet RFC'd
     "rfcs":      [ /* Row */ ],  // backlog with rfc: set, awaiting /pm:dev
     "shipped":   [ /* Row */ ],  // last 3 with status: shipped
     "meta": {
       "pmDir": "...",
       "pmStateDir": "...",
       "sourceDir": "...",
       "generatedAt": "ISO string"
     }
   }
   ```

   Each `Row` has: `shortId`, `topic`, `kind`, `phase`, `phaseLabel`, `updatedEpoch`, `ageRelative`, `staleness`, `resumeHint`, optional `linkage`, `sourcePath`.

3. **Cache the payload in memory** for the remainder of the conversation. When the user asks a follow-up ("expand proposals", "just the RFCs", "show me PM-45"), re-use the cached payload — do **not** re-invoke the script unless the user explicitly says "refresh" or "re-scan."

4. **Session-file locations reference** (copied from `skills/start/steps/03-resume.md` for cross-reference; the emitter already applies these rules — do not duplicate the scan):

   All session state lives source-side in `{source_dir}/.pm/`:

   | Session type | Location |
   |---|---|
   | Groom sessions | `{source_dir}/.pm/groom-sessions/*.md` |
   | RFC sessions   | `{source_dir}/.pm/rfc-sessions/*.md` |
   | Dev sessions   | `{source_dir}/.pm/dev-sessions/*.md` |
   | Think sessions | `{source_dir}/.pm/think-sessions/*.md` |

   Backlog artefacts (proposals, RFCs, shipped) live in the PM repo under `{pm_dir}/backlog/`. In separate-repo mode `pm_dir` and `source_dir` differ; in same-repo mode they collapse. The emitter's `meta.pmDir` / `meta.sourceDir` reflect the resolved paths.

5. **Empty-payload shortcut.** If every section is empty, skip step 02's full render and emit the single line:

   ```text
   No in-flight work found at {meta.pmDir}. Try /pm:start.
   ```

   Otherwise continue to step 02 (Render).

## Before marking done

- The node script ran to completion with exit code 0.
- stdout parsed as valid JSON matching the `ListRowsPayload` shape.
- The parsed payload is held in conversation state for the render step.
