---
name: Note Digest
order: 1
description: Digest pending quick-capture notes before research to surface internal signals
---

## Note Digest (intake pre-step)

Read `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` for the KB search protocol — use it for dedup checks before writing any research artifact.

## Goal

Ensure internal signals from quick-capture notes are synthesized into research themes before any research mode runs, so research has the latest context.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/note/digest.md`. This synthesizes any un-digested quick-capture notes from the last 30 days into research themes.

Whether notes were synthesized or none existed, proceed to mode routing.

## Done-when

Pending notes from the bounded digest window are synthesized or explicitly absent, and KB dedup context is ready.

**Advance:** proceed to Step 2 (Mode Routing).
