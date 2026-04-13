---
name: Note Digest
order: 1
description: Digest pending quick-capture notes before research to surface internal signals
---

## Note Digest (intake pre-step)

**Goal:** Ensure internal signals from quick-capture notes are synthesized into research themes before any research mode runs, so research has the latest context.

**How:** Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/note/digest.md`. This synthesizes any un-digested quick-capture notes from the last 30 days into research themes.

**Done-when:** Digest completes (notes synthesized) or completes silently (no un-digested notes exist). Proceed to mode routing either way.
