---
name: Note Digest
order: 1
description: Digest pending quick-capture notes before research to surface internal signals
---

## Note Digest (intake pre-step)

Read `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` for the KB search protocol — use it for dedup checks before writing any research artifact.

## Goal

Preserve pending quick-capture signals as research context so the current investigation can interpret them without assuming they establish demand.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/note/digest.md`. This retains any un-digested quick-capture notes from the last 30 days as source context. A `needs-synthesis` or stale insight remains provisional: read the analyst body and all-findings digest, including contrary observations, before treating it as support for a material claim.

Whether notes were retained or none existed, proceed to mode routing; routing is not independent demand verification.

## Done-when

Pending notes from the bounded digest window are retained as provisional context or explicitly absent, and KB dedup context is ready.

**Advance:** proceed to Step 2 (Mode Routing).
